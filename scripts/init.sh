#!/usr/bin/env bash

set -euo pipefail

echo "==> Installing Chrome for Testing ..."
bash scripts/install-chrome.sh

bash .claude/skills/playwright-cli/scripts/install-playwright-cli.sh

echo "==> Installing Agent Configurations ..."
mkdir -p $HOME/.claude
cp -r .claude/skills $HOME/.claude
cp .mcp.json $HOME/.
cp CLAUDE.md $HOME/.

echo "==> Init complete."
