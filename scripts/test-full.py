#!/usr/bin/env python3
"""Test full proxy-relay flow in hook environment."""
import os, signal, sys, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PIDFILE = "/tmp/test-full.pid"
LOG = "/tmp/test-full.log"

def kill_existing():
    try:
        pid = int(open(PIDFILE).read().strip())
        try:
            os.kill(pid, 0)
        except (ProcessLookupError, PermissionError) as e:
            if isinstance(e, ProcessLookupError):
                return
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

kill_existing()

if os.fork() > 0:
    os._exit(0)

os.setsid()
log_fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
os.dup2(log_fd, sys.stdout.fileno())
os.dup2(log_fd, sys.stderr.fileno())
os.close(log_fd)

open(PIDFILE, "w").write(str(os.getpid()))
print(f"serving pid={os.getpid()}", flush=True)
ThreadingHTTPServer(("127.0.0.1", 18082), BaseHTTPRequestHandler).serve_forever()
