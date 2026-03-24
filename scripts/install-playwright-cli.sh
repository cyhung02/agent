#!/usr/bin/env bash

set -euo pipefail

echo "==> Installing Playwright CLI ..."
npm install -g @playwright/cli

echo "==> Installing playwright-cli home-directory wrapper ..."
PLAYWRIGHT_BIN="$(which playwright-cli)"
REAL_TARGET="$(readlink -f "$PLAYWRIGHT_BIN")"
rm "$PLAYWRIGHT_BIN"
cat > "$PLAYWRIGHT_BIN" << EOF
#!/bin/bash
cd ~ && exec "$REAL_TARGET" "\$@"
EOF
chmod +x "$PLAYWRIGHT_BIN"

echo "==> Playwright CLI installed."
