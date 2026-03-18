#!/usr/bin/env bash

set -euo pipefail

echo "==> Updating Playwright proxy config..."

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CWD="${INIT_CWD:-$(pwd)}"
DST="$CWD/.playwright/cli.config.json"

mkdir -p "$(dirname "$DST")"
cp "$SCRIPT_DIR/playwright.cli.config.json" "$DST"

python3 - <<PYEOF
import json, os
from urllib.parse import urlparse

dst = "$DST"

with open(dst) as f:
    config = json.load(f)

proxy_url = os.environ.get("HTTP_PROXY", "")
if proxy_url:
    parsed = urlparse(proxy_url)
    proxy_server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
    config["browser"]["launchOptions"]["proxy"] = {
        "server": proxy_server,
        "username": parsed.username or "",
        "password": parsed.password or ""
    }

with open(dst, "w") as f:
    json.dump(config, f, indent=2)

print(f"    Config written at {dst}")
PYEOF

echo "==> Playwright proxy config updated."
