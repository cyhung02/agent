#!/usr/bin/env python3
"""Test kill_existing() in hook environment."""
import os, signal, sys, time

PIDFILE = "/tmp/proxy-relay.pid"
LOG = "/tmp/test-kill.log"

def kill_existing():
    try:
        pid = int(open(PIDFILE).read().strip())
        try:
            os.kill(pid, 0)
        except (ProcessLookupError, PermissionError) as e:
            if isinstance(e, ProcessLookupError):
                open(LOG, "a").write("no existing process\n")
                return
        open(LOG, "a").write(f"killing pid={pid}\n")
        os.kill(pid, signal.SIGTERM)
        for _ in range(20):
            time.sleep(0.1)
            try:
                os.kill(pid, 0)
            except ProcessLookupError:
                open(LOG, "a").write("killed\n")
                return
        os.kill(pid, signal.SIGKILL)
        open(LOG, "a").write("SIGKILLed\n")
    except Exception as e:
        open(LOG, "a").write(f"exception: {e}\n")

open(LOG, "a").write("start\n")
kill_existing()
open(LOG, "a").write("done\n")
