#!/usr/bin/env bash

set -euo pipefail

echo "==> Configuring Playwright CLI..."

python3 - <<'PYEOF'
import json, os
from urllib.parse import urlparse

# playwright-cli reads config from .playwright/cli.config.json relative to CWD
cwd = os.environ.get("INIT_CWD", os.getcwd())
dst = os.path.join(cwd, ".playwright", "cli.config.json")
os.makedirs(os.path.dirname(dst), exist_ok=True)

# Initialize default config if not present
if not os.path.exists(dst):
    default_config = {
        "browser": {
            "browserName": "chromium",
            "launchOptions": {
                "channel": "chrome",
                "headless": True
            },
            "contextOptions": {
                "viewport": None
            },
            "isolated": False
        }
    }
    with open(dst, "w") as f:
        json.dump(default_config, f, indent=2)

with open(dst) as f:
    config = json.load(f)

launch = config.setdefault("browser", {}).setdefault("launchOptions", {})
launch["chromiumSandbox"] = False
config["browser"].setdefault("contextOptions", {})["ignoreHTTPSErrors"] = True

proxy_url = os.environ.get("HTTP_PROXY", "")
if proxy_url:
    parsed = urlparse(proxy_url)
    proxy_server = f"{parsed.scheme}://{parsed.hostname}:{parsed.port}"
    launch["proxy"] = {
        "server": proxy_server,
        "username": parsed.username or "",
        "password": parsed.password or ""
    }

with open(dst, "w") as f:
    json.dump(config, f, indent=2)

print(f"    Config written at {dst}")
PYEOF

echo "==> Playwright CLI configured successfully."
