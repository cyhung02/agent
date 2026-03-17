#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Configure proxy: AGENT_BROWSER_PROXY takes precedence over HTTP_PROXY
_PROXY="${AGENT_BROWSER_PROXY:-${HTTP_PROXY:-}}"
if [[ -n "$_PROXY" ]]; then
    export HTTP_PROXY="$_PROXY"
    export HTTPS_PROXY="$_PROXY"
    echo "==> Proxy configured: $HTTP_PROXY"
fi

echo "==> Installing Chrome for Testing..."
bash "$SCRIPT_DIR/install-chrome.sh"

echo "==> Installing agent-browser skill..."
npx skills add vercel-labs/agent-browser --yes

echo "==> Init complete."
