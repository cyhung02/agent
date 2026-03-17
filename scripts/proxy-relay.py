#!/usr/bin/env python3
"""
Local proxy relay: reads $HTTP_PROXY on each request and injects auth.
Chrome -> localhost:18080 -> $HTTP_PROXY (with Proxy-Authorization)
"""

import base64, os, select, signal, socket, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


PIDFILE = "/tmp/proxy-relay.pid"
LOGFILE = "/tmp/proxy-relay.log"

_proxy_lock = threading.Lock()
_proxy_cache: dict = {"url": "", "ts": 0.0}
_CACHE_TTL = 30.0  # seconds


def _scan_env_manager_proxy() -> str:
    """Scan /proc for the most recently started environment-manager process and return its HTTP_PROXY."""
    best_starttime = -1
    best_url = ""
    try:
        for pid_str in os.listdir("/proc"):
            if not pid_str.isdigit():
                continue
            pid = int(pid_str)
            try:
                cmdline = open(f"/proc/{pid}/cmdline").read()
                if "environment-manager" not in cmdline:
                    continue
                # Field 22 (index 21) of /proc/{pid}/stat is starttime in clock ticks since boot
                starttime = int(open(f"/proc/{pid}/stat").read().split()[21])
                for var in open(f"/proc/{pid}/environ").read().split("\0"):
                    if var.startswith("HTTP_PROXY="):
                        if starttime > best_starttime:
                            best_starttime = starttime
                            best_url = var[11:]
                        break
            except OSError:
                continue
    except OSError:
        pass
    return best_url


def kill_existing():
    import time
    try:
        pid = int(open(PIDFILE).read().strip())
        try:
            os.kill(pid, 0)  # POSIX-standard: check process existence (works on Linux & macOS)
        except (ProcessLookupError, PermissionError) as e:
            if isinstance(e, ProcessLookupError):
                return  # process already gone
        os.kill(pid, signal.SIGTERM)
        for _ in range(20):
            time.sleep(0.1)
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                return
        os.kill(pid, signal.SIGKILL)
    except Exception:
        pass


def get_upstream():
    """Return (host, port, auth) for the upstream proxy, re-resolved up to every 30 s.

    Resolution order:
      1. /proc scan for the live environment-manager process (picks up new session tokens)
      2. $HTTP_PROXY / $http_proxy captured at daemon launch (last-resort fallback)
    """
    now = time.monotonic()
    with _proxy_lock:
        if now - _proxy_cache["ts"] >= _CACHE_TTL:
            url = _scan_env_manager_proxy()
            if not url:
                url = os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy", "")
            _proxy_cache["url"] = url
            _proxy_cache["ts"] = now
        url = _proxy_cache["url"]
    p = urlparse(url)
    auth = base64.b64encode(f"{p.username}:{p.password}".encode()).decode() if p.username else None
    return p.hostname, p.port or 8080, auth


class Handler(BaseHTTPRequestHandler):
    log_message = lambda self, *a: None

    def do_CONNECT(self):
        host, port, auth = get_upstream()
        try:
            sock = socket.create_connection((host, port), timeout=15)
            req = f"CONNECT {self.path} HTTP/1.1\r\nHost: {self.path}\r\n"
            if auth:
                req += f"Proxy-Authorization: Basic {auth}\r\n"
            sock.sendall((req + "\r\n").encode())

            resp = b""
            while b"\r\n\r\n" not in resp:
                resp += sock.recv(4096)

            if b"200" not in resp.split(b"\r\n")[0]:
                self.send_error(502, resp.split(b"\r\n")[0].decode())
                return

            self.send_response(200, "Connection Established")
            self.end_headers()

            def relay(a, b):
                try:
                    while True:
                        r, _, _ = select.select([a], [], [], 10)
                        if not r:
                            break
                        data = a.recv(65536)
                        if not data:
                            break
                        b.sendall(data)
                except Exception:
                    pass

            t = threading.Thread(target=relay, args=(sock, self.connection), daemon=True)
            t.start()
            relay(self.connection, sock)
        except Exception as e:
            self.send_error(502, str(e))

    def do_GET(self):
        self._forward_plain()

    def do_POST(self):
        self._forward_plain()

    def do_PUT(self):
        self._forward_plain()

    def do_DELETE(self):
        self._forward_plain()

    def do_HEAD(self):
        self._forward_plain()

    def do_OPTIONS(self):
        self._forward_plain()

    def _forward_plain(self):
        """Forward plain HTTP requests through the upstream proxy."""
        host, port, auth = get_upstream()
        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length) if content_length else b""

            sock = socket.create_connection((host, port), timeout=15)

            # Rebuild the request line, preserving the full URL for the upstream proxy
            req_line = f"{self.command} {self.path} {self.request_version}\r\n"
            headers = str(self.headers)
            if auth:
                headers += f"Proxy-Authorization: Basic {auth}\r\n"
            sock.sendall((req_line + headers + "\r\n").encode() + body)

            # Stream the response back to the client
            def relay_response(src, dst_wfile):
                try:
                    while True:
                        r, _, _ = select.select([src], [], [], 30)
                        if not r:
                            break
                        data = src.recv(65536)
                        if not data:
                            break
                        dst_wfile.write(data)
                        dst_wfile.flush()
                except Exception:
                    pass

            relay_response(sock, self.wfile)
            sock.close()
        except Exception as e:
            self.send_error(502, str(e))


if __name__ == "__main__":
    import sys
    kill_existing()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18080

    # Daemonize: fork and let parent exit so shell doesn't block
    if os.fork() > 0:
        os._exit(0)
    os.setsid()

    # Redirect stdout/stderr to log file to avoid polluting the parent terminal
    log_fd = os.open(LOGFILE, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    os.dup2(log_fd, sys.stdout.fileno())
    os.dup2(log_fd, sys.stderr.fileno())
    os.close(log_fd)

    open(PIDFILE, "w").write(str(os.getpid()))
    print(f"Proxy relay listening on localhost:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
