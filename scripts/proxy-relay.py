#!/usr/bin/env python3
"""
Local proxy relay that dynamically reads HTTP_PROXY on every request.

Chrome → localhost:18080 (no auth)
       → upstream proxy from $HTTP_PROXY (with auth injected)
"""

import base64
import os
import select
import socket
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse


def get_upstream():
    """Read and parse HTTP_PROXY from environment at call time."""
    proxy_url = os.environ.get("HTTP_PROXY") or os.environ.get("http_proxy", "")
    if not proxy_url:
        return None
    parsed = urlparse(proxy_url)
    auth = None
    if parsed.username:
        credentials = f"{parsed.username}:{parsed.password or ''}"
        auth = base64.b64encode(credentials.encode()).decode()
    return {
        "host": parsed.hostname,
        "port": parsed.port or 8080,
        "auth": auth,
    }


def relay(src, dst):
    """Bidirectional relay between two sockets."""
    try:
        while True:
            r, _, _ = select.select([src, dst], [], [], 10)
            if not r:
                break
            for s in r:
                data = s.recv(65536)
                if not data:
                    return
                (dst if s is src else src).sendall(data)
    except Exception:
        pass
    finally:
        for s in (src, dst):
            try:
                s.close()
            except Exception:
                pass


class RelayHandler(BaseHTTPRequestHandler):
    log_message = lambda self, *a: None  # silence default logs

    def do_CONNECT(self):
        """Handle HTTPS tunnel requests."""
        upstream = get_upstream()
        target_host, target_port = self.path.split(":", 1)
        target_port = int(target_port)

        try:
            if upstream:
                # Connect to upstream proxy
                sock = socket.create_connection((upstream["host"], upstream["port"]), timeout=15)
                # Send CONNECT to upstream with auth
                connect_req = f"CONNECT {self.path} HTTP/1.1\r\nHost: {self.path}\r\n"
                if upstream["auth"]:
                    connect_req += f"Proxy-Authorization: Basic {upstream['auth']}\r\n"
                connect_req += "\r\n"
                sock.sendall(connect_req.encode())
                # Read upstream response
                resp = b""
                while b"\r\n\r\n" not in resp:
                    chunk = sock.recv(4096)
                    if not chunk:
                        break
                    resp += chunk
                status_line = resp.split(b"\r\n")[0]
                if b"200" not in status_line:
                    self.send_error(502, f"Upstream proxy error: {status_line}")
                    sock.close()
                    return
            else:
                # Direct connection
                sock = socket.create_connection((target_host, target_port), timeout=15)

            # Tell Chrome the tunnel is ready
            self.send_response(200, "Connection Established")
            self.end_headers()

            # Relay bytes between Chrome and upstream
            client_sock = self.connection
            t = threading.Thread(target=relay, args=(client_sock, sock), daemon=True)
            t.start()
            relay(sock, client_sock)

        except Exception as e:
            self.send_error(502, str(e))

    def do_GET(self):
        self._forward()

    def do_POST(self):
        self._forward()

    def _forward(self):
        """Forward plain HTTP requests to upstream proxy."""
        import http.client

        upstream = get_upstream()
        parsed = urlparse(self.path)

        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length) if content_length else None

        headers = {k: v for k, v in self.headers.items()
                   if k.lower() not in ("proxy-authorization", "proxy-connection")}

        try:
            if upstream:
                conn = http.client.HTTPConnection(upstream["host"], upstream["port"], timeout=15)
                if upstream["auth"]:
                    headers["Proxy-Authorization"] = f"Basic {upstream['auth']}"
                conn.request(self.command, self.path, body, headers)
            else:
                host = parsed.hostname
                port = parsed.port or 80
                conn = http.client.HTTPConnection(host, port, timeout=15)
                path = parsed.path or "/"
                if parsed.query:
                    path += "?" + parsed.query
                conn.request(self.command, path, body, headers)

            resp = conn.getresponse()
            self.send_response(resp.status)
            for k, v in resp.getheaders():
                if k.lower() not in ("transfer-encoding",):
                    self.send_header(k, v)
            self.end_headers()
            self.wfile.write(resp.read())
        except Exception as e:
            self.send_error(502, str(e))


if __name__ == "__main__":
    import sys

    port = int(sys.argv[1]) if len(sys.argv) > 1 else 18080
    server = ThreadingHTTPServer(("127.0.0.1", port), RelayHandler)
    print(f"Proxy relay listening on localhost:{port}", flush=True)
    print(f"Upstream: {os.environ.get('HTTP_PROXY', '(direct)')}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down.")
