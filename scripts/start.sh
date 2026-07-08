#!/bin/bash
# =============================================================================
# PiAgentChat 一键启动脚本
#
# 用法:
#   bash scripts/start.sh              # 启动桌面端（自动识别平台）
#   bash scripts/start.sh --web        # 启动 Web 服务器模式
#   bash scripts/start.sh --help       # 查看帮助
# =============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# 颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'
info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

show_help() {
  cat << HELP
PiAgentChat 启动脚本

用法:
  bash scripts/start.sh              桌面端（自动检测平台）
  bash scripts/start.sh --web        Web 服务器模式
  bash scripts/start.sh --dev:web    Web 开发模式（Vite HMR + server）
  bash scripts/start.sh --help       查看帮助

环境变量:
  PORT              Web 服务器端口（默认: 3100）
  AUTH_TOKEN        API 认证令牌（Web 模式必需）
  PI_CLI_PATH       pi CLI 二进制路径（Web 模式必需）
  PI_CODING_AGENT_DIR  Agent 配置目录

桌面端:
  macOS: 自动查找 /Applications/PiAgentChat.app
  Linux: 自动查找 ~/.pi-agent-chat/ 或 \$INSTALL_DIR
HELP
}

# ── 检测平台 ──
OS="$(uname -s)"
ARCH="$(uname -m)"

# ── 启动桌面端 ──
start_desktop() {
  case "$OS" in
    Darwin)
      # macOS
      if [ -d "/Applications/PiAgentChat.app" ]; then
        ok "启动 PiAgentChat.app..."
        open -a PiAgentChat
      elif [ -d "$PROJECT_ROOT/build" ]; then
        APP_BUNDLE=$(find "$PROJECT_ROOT/build" -name "*.app" -type d | head -1)
        if [ -n "$APP_BUNDLE" ]; then
          ok "启动开发构建版: $APP_BUNDLE"
          open "$APP_BUNDLE"
        else
          err "未找到 PiAgentChat.app。请先安装或构建。"
        fi
      else
        err "未找到 PiAgentChat.app。"
        echo "  安装: curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/scripts/install.sh | bash"
      fi
      ;;
    Linux)
      # Linux
      INSTALL_DIR="${INSTALL_DIR:-$HOME/.pi-agent-chat}"
      LAUNCHER=$(find "$INSTALL_DIR" -name "launcher" -type f 2>/dev/null | head -1)

      if [ -n "$LAUNCHER" ]; then
        ok "启动 PiAgentChat (来自 $INSTALL_DIR)..."
        exec "$LAUNCHER"
      elif [ -d "$PROJECT_ROOT/build" ]; then
        BUILD_LAUNCHER=$(find "$PROJECT_ROOT/build" -name "launcher" -type f 2>/dev/null | head -1)
        if [ -n "$BUILD_LAUNCHER" ]; then
          ok "启动开发构建版: $BUILD_LAUNCHER"
          exec "$BUILD_LAUNCHER"
        else
          err "未找到 launcher 二进制文件。请先安装或构建。"
        fi
      else
        err "未找到 PiAgentChat。请先安装。"
        echo "  安装: curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/scripts/install.sh | bash"
      fi
      ;;
    *)
      err "不支持的操作系统: $OS"
      ;;
  esac
}

# ── 启动 Web 服务器 ──
start_web() {
  info "启动 PiAgentChat Web 服务器..."

  # 检查 .env
  if [ ! -f "$PROJECT_ROOT/.env" ]; then
    warn "未找到 .env 文件，使用环境变量"
  fi

  # 检查必要环境变量
  if [ -z "${AUTH_TOKEN:-}" ]; then
    warn "AUTH_TOKEN 未设置。Web 模式需要 AUTH_TOKEN 进行 API 认证。"
    echo "  设置: export AUTH_TOKEN=your-token-here"
    echo "  或:  在 .env 文件中添加 AUTH_TOKEN=your-token-here"
  fi

  # 启动服务器
  cd "$PROJECT_ROOT"
  exec bun src/server.ts
}

# ── 参数解析 ──
case "${1:-}" in
  --help|-h)
    show_help
    ;;
  --web|-w)
    start_web
    ;;
  --dev:web)
    info "启动 Web 开发模式（Vite HMR + Server）..."
    cd "$PROJECT_ROOT"
    exec bun run dev:web
    ;;
  *)
    start_desktop
    ;;
esac
