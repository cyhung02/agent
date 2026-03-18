#!/usr/bin/env bash

set -euo pipefail

echo "==> Installing Chrome for Testing..."
curl -fsSL https://raw.githubusercontent.com/cyhung02/agent/main/scripts/install-chrome.sh | bash

echo "==> Installing Playwright CLI..."
npm install -g @playwright/cli

echo "==> Init complete."
