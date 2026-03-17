#!/usr/bin/env python3
"""Test _scan_env_manager_proxy() in hook environment."""
import os

LOG = "/tmp/test-scan.log"

def scan():
    best_starttime = -1.0
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
                mtime = os.stat(f"/proc/{pid}").st_mtime
                for var in open(f"/proc/{pid}/environ").read().split("\0"):
                    if var.startswith("HTTP_PROXY="):
                        if mtime > best_starttime:
                            best_starttime = mtime
                            best_url = var[11:]
                        break
            except OSError:
                continue
    except OSError:
        pass
    return best_url

open(LOG, "a").write("start scan\n")
url = scan()
open(LOG, "a").write(f"done, found={'yes' if url else 'no'}\n")
