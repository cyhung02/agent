#!/usr/bin/env bash

set -euo pipefail

echo "==> Installing Chrome for Testing..."
curl -fsSL https://raw.githubusercontent.com/cyhung02/agent/main/scripts/install-chrome.sh | bash

echo "==> Installing agent-browser CLI..."
npm install -g agent-browser

echo "==> Installing agent-browser skill..."
npx skills add vercel-labs/agent-browser --yes

echo "==> Init complete."