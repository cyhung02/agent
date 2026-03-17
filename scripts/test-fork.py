#!/usr/bin/env python3
"""Test whether fork-based daemonization works in this hook environment."""
import os, sys, time

LOG = "/tmp/test-fork.log"

if os.fork() > 0:
    os._exit(0)

os.setsid()
log_fd = os.open(LOG, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
os.dup2(log_fd, sys.stdout.fileno())
os.dup2(log_fd, sys.stderr.fileno())
os.close(log_fd)

print(f"daemon alive pid={os.getpid()}", flush=True)
time.sleep(5)
print("daemon done", flush=True)
