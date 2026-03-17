#!/usr/bin/env python3
"""Test fork + serve_forever in hook environment."""
import os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG = "/tmp/test-serve.log"

if os.fork() > 0:
    os._exit(0)

os.setsid()
log_fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
os.dup2(log_fd, sys.stdout.fileno())
os.dup2(log_fd, sys.stderr.fileno())
os.close(log_fd)

print("serving", flush=True)
ThreadingHTTPServer(("127.0.0.1", 18081), BaseHTTPRequestHandler).serve_forever()
