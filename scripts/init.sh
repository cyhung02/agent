#!/usr/bin/env bash

set -euo pipefail

# 取得 scripts 資料夾的絕對路徑
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "==> Installing Chrome for Testing..."
bash "$SCRIPT_DIR/install-chrome.sh"

echo "==> Installing Playwright CLI..."
npm install -g @playwright/cli

echo "==> Init complete."
