#!/bin/bash
# =============================================================================
# PiAgentChat 一键安装脚本
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/scripts/install.sh | bash
#   或:
#   bash scripts/install.sh [版本号]
#
# 版本号可选: 不指定则安装最新版, 如 "v1.0.0" 安装指定版本
# =============================================================================
set -euo pipefail

REPO="dyyz1993/pi-agent-chat"
VERSION="${1:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.pi-agent-chat}"

# ── 颜色 ──
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()  { echo -e "${BLUE}[INFO]${NC} $1"; }
ok()    { echo -e "${GREEN}[OK]${NC} $1"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $1"; }
err()   { echo -e "${RED}[ERR]${NC} $1"; exit 1; }

# ── 检测平台 ──
OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Darwin)
    case "$ARCH" in
      arm64)  PLATFORM="macos-arm64"; DMG_FILE="PiAgentChat-*-macos-arm64.dmg" ;;
      x86_64) PLATFORM="macos-x64";   DMG_FILE="PiAgentChat-*-macos-x64.dmg" ;;
      *)      err "不支持的架构: $ARCH (仅支持 arm64 / x86_64)" ;;
    esac
    ;;
  Linux)
    case "$ARCH" in
      x86_64)  PLATFORM="linux-x64";  TAR_FILE="stable-linux-x64-PiAgentChat.tar.zst" ;;
      aarch64) PLATFORM="linux-arm64"; TAR_FILE="stable-linux-arm64-PiAgentChat.tar.zst" ;;
      *)       err "不支持的架构: $ARCH (仅支持 x86_64 / aarch64)" ;;
    esac
    ;;
  *)
    err "不支持的操作系统: $OS (仅支持 macOS / Linux)"
    ;;
esac

echo ""
echo "═══════════════════════════════════════════"
echo "  PiAgentChat Installer"
echo "  Platform: $OS ($ARCH)"
echo "  Version:  $VERSION"
echo "═══════════════════════════════════════════"
echo ""

# ── 检查依赖 ──
check_deps() {
  local missing=false
  for cmd in curl; do
    if ! command -v "$cmd" &>/dev/null; then
      warn "缺少依赖: $cmd"
      missing=true
    fi
  done
  if [ "$missing" = true ]; then
    err "请先安装缺失的依赖后再试"
  fi
}
check_deps

# ── 下载函数 ──
download() {
  local url="$1"
  local output="$2"
  info "下载中: $url"
  if command -v gh &>/dev/null; then
    # 使用 GitHub CLI
    if [ "$VERSION" = "latest" ]; then
      gh release download --repo "$REPO" --pattern "$(basename "$output")" --output "$output" 2>/dev/null && return 0
    else
      gh release download "$VERSION" --repo "$REPO" --pattern "$(basename "$output")" --output "$output" 2>/dev/null && return 0
    fi
  fi
  # 回退到 curl
  local gh_url
  if [ "$VERSION" = "latest" ]; then
    gh_url="https://github.com/$REPO/releases/latest/download/$(basename "$output")"
  else
    gh_url="https://github.com/$REPO/releases/download/$VERSION/$(basename "$output")"
  fi
  curl -fsSL "$gh_url" -o "$output"
}

# ── macOS 安装 ──
install_macos() {
  local dmg_path="/tmp/pi-agent-chat-install.dmg"
  local vol_path="/Volumes/PiAgentChat"

  # 卸载已存在的卷
  if [ -d "$vol_path" ]; then
    hdiutil detach "$vol_path" -quiet 2>/dev/null || true
  fi

  download "$DMG_FILE" "$dmg_path"

  info "挂载 DMG..."
  hdiutil attach "$dmg_path" -quiet -nobrowse -mountpoint "$vol_path"

  info "安装到 /Applications..."
  if [ -d "/Applications/PiAgentChat.app" ]; then
    warn "发现已有的 PiAgentChat.app，正在覆盖..."
    rm -rf "/Applications/PiAgentChat.app"
  fi
  cp -R "$vol_path/PiAgentChat.app" /Applications/

  info "卸载 DMG..."
  hdiutil detach "$vol_path" -quiet 2>/dev/null || true

  # 移除隔离属性（因为没有付费签名）
  xattr -d com.apple.quarantine /Applications/PiAgentChat.app 2>/dev/null || true

  rm -f "$dmg_path"

  ok "安装完成！PiAgentChat.app 已安装到 /Applications/"
  echo ""
  echo "  启动方式: open -a PiAgentChat"
  echo "  或:        /Applications/PiAgentChat.app/Contents/MacOS/launcher"
  echo ""
  echo "  ⚠ 首次启动如果提示无法验证开发者，请在系统设置 → 隐私与安全性中允许"
}

# ── Linux 安装 ──
install_linux() {
  local tarball_path="/tmp/pi-agent-chat.tar.zst"

  mkdir -p "$INSTALL_DIR"

  download "$TAR_FILE" "$tarball_path"

  info "解压到 $INSTALL_DIR ..."
  # 先清理旧版本
  rm -rf "$INSTALL_DIR"/* 2>/dev/null || true
  zstd -d "$tarball_path" -o /tmp/pi-agent-chat.tar --no-progress 2>/dev/null
  tar xf /tmp/pi-agent-chat.tar -C "$INSTALL_DIR"
  rm -f /tmp/pi-agent-chat.tar "$tarball_path"

  # 查找 launcher
  LAUNCHER=$(find "$INSTALL_DIR" -name "launcher" -type f | head -1)
  if [ -n "$LAUNCHER" ]; then
    chmod +x "$LAUNCHER"
  fi

  # 创建 PATH 链接
  mkdir -p "$HOME/.local/bin"
  if [ -n "$LAUNCHER" ]; then
    ln -sf "$LAUNCHER" "$HOME/.local/bin/pi-agent-chat"
    ok "已创建命令: pi-agent-chat (位于 ~/.local/bin/)"
  fi

  ok "安装完成！PiAgentChat 已安装到 $INSTALL_DIR/"
  echo ""
  echo "  启动方式: $LAUNCHER"
  echo "  或:        ~/.local/bin/pi-agent-chat"
  echo ""
  echo "  ⚠ 请确保 ~/.local/bin 在 PATH 中: export PATH=\$HOME/.local/bin:\$PATH"
  echo "    你可以将上面这行加入 ~/.bashrc 或 ~/.zshrc"
}

# ── 配置文件引导 ──
show_config_guide() {
  echo ""
  echo "═══════════════════════════════════════════"
  echo "  下一步: 配置 PiAgentChat"
  echo "═══════════════════════════════════════════"
  echo ""
  echo "  PiAgentChat 需要以下配置才能运行:"
  echo ""
  echo "  1. AUTH_TOKEN（API 认证令牌）"
  echo "  2. PI_CLI_PATH（pi CLI 路径）"
  echo "  3. 模型 API Key（如 DeepSeek、OpenAI 等）"
  echo ""
  echo "  直接启动后，APP 内引导界面会指导你完成配置。"
  echo ""
}

# ── 执行 ──
case "$OS" in
  Darwin) install_macos ;;
  Linux)  install_linux ;;
esac

show_config_guide
