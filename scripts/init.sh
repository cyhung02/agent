#!/usr/bin/env bash

set -euo pipefail

echo "==> Installing Chrome for Testing ..."
bash scripts/install-chrome.sh

echo "==> Installing Playwright CLI ..."
npm install -g @playwright/cli

echo "==> Installing Agent Configurations ..."
mkdir -p $HOME/.claude
cp -r .claude/skills $HOME/.claude
cp .mcp.json $HOME/.
cp CLAUDE.md $HOME/.

echo "==> Init complete."
