#!/usr/bin/env bash

# 1. 啟用嚴格模式
set -euo pipefail

# 設定安裝路徑與 Log 檔案
INSTALL_BASE="$HOME/.local/opt"
BIN_DIR="$HOME/.local/bin"
LOG_FILE="$HOME/chrome_install.log"

echo "==>[$(date +'%Y-%m-%dT%H:%M:%S')] Starting Chrome for Testing installation" | tee -a "$LOG_FILE"

# 2. 檢查必備工具
for cmd in curl jq unzip; do
  if ! command -v "$cmd" &> /dev/null; then
    echo "Error: 命令 '$cmd' 找不到，請先安裝。" | tee -a "$LOG_FILE" >&2
    exit 1
  fi
done

# 3. 建立暫存目錄並設定自動清理機制
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

echo "==> Fetching Chrome for Testing stable download URLs..." | tee -a "$LOG_FILE"

# 4. 取得最新 Stable 版本的下載網址
CHROME_JSON=$(curl -sSf https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions-with-downloads.json)
CHROME_URL=$(echo "$CHROME_JSON" | jq -r '.channels.Stable.downloads.chrome[] | select(.platform == "linux64") | .url')

if [[ -z "$CHROME_URL" || "$CHROME_URL" == "null" ]]; then
    echo "Error: 無法解析 Chrome 網址，JSON 結構可能已更改。" | tee -a "$LOG_FILE" >&2
    exit 1
fi

echo "    Chrome URL: $CHROME_URL" | tee -a "$LOG_FILE"

# 5. 下載檔案到暫存目錄
ZIP_PATH="$WORK_DIR/chrome-linux64.zip"
echo "==> Downloading Chrome for Testing..." | tee -a "$LOG_FILE"
curl -sSLo "$ZIP_PATH" "$CHROME_URL"

# 6. 準備安裝目錄
echo "==> Preparing installation directories..." | tee -a "$LOG_FILE"
mkdir -p "$INSTALL_BASE" "$BIN_DIR"

# 確保移除舊版本，避免檔案殘留衝突
rm -rf "$INSTALL_BASE/chrome-linux64"

# 7. 解壓縮到 ~/.local/opt/
echo "==> Extracting to $INSTALL_BASE..." | tee -a "$LOG_FILE"
unzip -oq "$ZIP_PATH" -d "$INSTALL_BASE"

# 8. 建立軟連結到 ~/.local/bin/chrome
echo "==> Creating symlink in $BIN_DIR..." | tee -a "$LOG_FILE"
ln -sf "$INSTALL_BASE/chrome-linux64/chrome" "$BIN_DIR/chrome"

# 9. 安裝系統依賴
echo "==> Installing system dependencies..." | tee -a "$LOG_FILE"
apt-get update -qq

# 從解壓縮後的目錄中讀取 deb.deps，過濾掉註解，並用逗號連接
DEPS=$(grep -v '^#' "$INSTALL_BASE/chrome-linux64/deb.deps" | paste -sd ',')

# 執行依賴安裝，並將日誌導入 $LOG_FILE 方便日後除錯
if apt-get satisfy -y --no-install-recommends "$DEPS" >> "$LOG_FILE" 2>&1; then
    echo "    Dependencies installed successfully." | tee -a "$LOG_FILE"
else
    echo "Error: Failed to install system dependencies. Check $LOG_FILE for details." | tee -a "$LOG_FILE" >&2
    exit 1
fi

echo "==> Installation completed successfully!" | tee -a "$LOG_FILE"
echo ""
echo "💡 您現在可以使用以下指令來測試："
echo "    chrome --version"
