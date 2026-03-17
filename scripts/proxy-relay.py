#!/usr/bin/env python3
"""
Local proxy relay: reads $HTTP_PROXY on every request and injects auth.
Chrome -> localhost:18080 -> $HTTP_PROXY (with Proxy-Authorization)
"""

import base64, os, select, signal, socket, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


PIDFILE = "/tmp/proxy-relay.pid"


def kill_existing():
    import time
    try:
        pid = int(open(PIDFILE).read().strip())
        if os.path.exists(f"/proc/{pid}"):
            os.kill(pid, signal.SIGTERM)
            for _ in range(20):
                time.sleep(0.1)
                if not os.path.exists(f"/proc/{pid}"):
                    break
            else:
                os.kill(pid, signal.SIGKILL)
    except Exception:
        pass


def get_upstream():
    p = urlparse(os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy", ""))
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


if __name__ == "__main__":
    import sys
    kill_existing()
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18080

    # Daemonize: fork and let parent exit so shell doesn't block
    if os.fork() > 0:
        os._exit(0)
    os.setsid()

    open(PIDFILE, "w").write(str(os.getpid()))
    print(f"Proxy relay listening on localhost:{port}", flush=True)
    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
