#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing Chrome for Testing..."
bash "$SCRIPT_DIR/install-chrome.sh"

echo "==> Installing agent-browser CLI..."
npm install -g agent-browser

echo "==> Installing agent-browser skill..."
npx skills add vercel-labs/agent-browser --yes

echo "==> Init complete."