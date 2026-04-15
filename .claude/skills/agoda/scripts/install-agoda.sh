#!/usr/bin/env bash

set -euo pipefail

echo "==> Installing Agoda skill dependencies ..."

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$SKILL_DIR"
npm install --no-fund --no-audit

echo "==> Agoda skill dependencies installed."
