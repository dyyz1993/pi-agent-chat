#!/bin/bash
# =============================================================================
# PiAgentChat - Linux launcher
#
# 这个脚本同时被用作：
#   1. CI 构建产物中的入口脚本（附在 Release 附件中）
#   2. 用户手动解压后的启动入口
#
# 用法: ./pi-agent-chat-linux-launcher.sh
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(dirname "$SCRIPT_DIR")/PiAgentChat"

# Detect if running from extracted location or from build directory
if [ -d "$SCRIPT_DIR/../Resources" ]; then
  # Running from inside the app directory structure
  APP_BASE="$SCRIPT_DIR/.."
elif [ -d "$APP_DIR/bin" ]; then
  APP_BASE="$APP_DIR"
else
  echo "Error: Cannot find app directory."
  echo "Expected to find 'bin/launcher' in the app directory."
  echo ""
  echo "Try: curl -sL https://github.com/dyyz1993/pi-agent-chat/releases/latest/download/stable-linux-x64-PiAgentChat.tar.zst | zstd -d | tar xf -"
  exit 1
fi

LAUNCHER="$APP_BASE/bin/launcher"
if [ ! -x "$LAUNCHER" ]; then
  chmod +x "$LAUNCHER" 2>/dev/null || true
fi

if [ -x "$LAUNCHER" ]; then
  exec "$LAUNCHER" "$@"
else
  echo "Error: launcher binary not found at $LAUNCHER"
  exit 1
fi
