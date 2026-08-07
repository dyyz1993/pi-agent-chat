#!/bin/bash
# =============================================================================
# PiAgentChat Web 服务器一键安装脚本
#
# 用法:
#   curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/scripts/install-web.sh | bash
#   或:
#   bash scripts/install-web.sh [版本号]
#
# 版本号可选: 不指定则安装最新版, 如 "v1.0.2" 安装指定版本
#
# 环境变量:
#   PORT              Web 服务器端口（默认: 3100）
#   AUTH_TOKEN        API 认证令牌（必填,用于 WebSocket 鉴权）
#   INSTALL_DIR       安装目录（默认: ~/.pi-agent-chat-web）
#   SKIP_DAEMON       设为 1 跳过 launchd/systemd 守护进程配置(用 nohup)
#
# 守护进程:
#   macOS → launchd (~/Library/LaunchAgents/com.pi-agent-chat.web.plist)
#   Linux → systemd (/etc/systemd/system/pi-agent-chat.service, 需要 sudo)
# =============================================================================
set -euo pipefail

REPO="dyyz1993/pi-agent-chat"
VERSION="${1:-latest}"
INSTALL_DIR="${INSTALL_DIR:-$HOME/.pi-agent-chat-web}"
PORT="${PORT:-3100}"
PLIST_LABEL="com.pi-agent-chat.web"
PLIST_PATH="$HOME/Library/LaunchAgents/${PLIST_LABEL}.plist"
SERVICE_NAME="pi-agent-chat"
SYSTEMD_SERVICE="/etc/systemd/system/${SERVICE_NAME}.service"

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

echo ""
echo "═══════════════════════════════════════════"
echo "  PiAgentChat Web Server Installer"
echo "  Version:  $VERSION"
echo "  Port:     $PORT"
echo "  Install:  $INSTALL_DIR"
echo "═══════════════════════════════════════════"
echo ""

# ── 平台检查 ──
OS="$(uname -s)"
ARCH="$(uname -m)"
case "$OS" in
  Darwin) info "平台: macOS ($ARCH)" ;;
  Linux)  info "平台: Linux ($ARCH)" ;;
  *)      err "不支持的操作系统: $OS (仅支持 macOS / Linux)" ;;
esac

# ── AUTH_TOKEN 检查 ──
if [ -z "${AUTH_TOKEN:-}" ]; then
  err "AUTH_TOKEN 未设置!\n  请通过环境变量提供:\n    AUTH_TOKEN=your-token bash install-web.sh\n  或:\n    curl ... | AUTH_TOKEN=your-token bash"
fi
info "AUTH_TOKEN: ${AUTH_TOKEN:0:4}****"

# ═══════════════════════════════════════════════
# Step 1: 安装 bun（服务器运行时）
# ═══════════════════════════════════════════════
info "Step 1/6: 检查/安装 bun..."

if command -v bun &>/dev/null; then
  ok "bun 已安装: $(bun --version)"
elif [ -f "$HOME/.bun/bin/bun" ]; then
  export PATH="$HOME/.bun/bin:$PATH"
  ok "bun 已安装(从 ~/.bun 加载): $(bun --version)"
else
  info "安装 bun (官方安装脚本)..."
  curl -fsSL https://bun.sh/install | bash
  export PATH="$HOME/.bun/bin:$PATH"
  if ! command -v bun &>/dev/null; then
    err "bun 安装失败,请手动安装: https://bun.sh"
  fi
  ok "bun 安装成功: $(bun --version)"
fi

# 确保 bun 在 PATH 里(launchd 需要完整路径)
BUN_BIN="$(command -v bun)"
if [ -z "$BUN_BIN" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi
info "bun 路径: $BUN_BIN"

# ═══════════════════════════════════════════════
# Step 2: 安装 node（CLI 子进程运行时）
# ═══════════════════════════════════════════════
info "Step 2/6: 检查/安装 node..."

if command -v node &>/dev/null; then
  ok "node 已安装: $(node --version)"
elif [ -f "/usr/local/bin/node" ] || [ -f "/opt/homebrew/bin/node" ]; then
  ok "node 已安装(系统路径)"
else
  warn "node 未安装!Agent CLI 需要 node 运行时。"
  info "安装 node (通过 bun)..."
  # bun 可以 shim node,但更可靠的是直接用 bun 提供的 node shim
  # 如果 bun --shim 存在就用,否则提示手动安装
  if [ "$OS" = "Darwin" ]; then
    info "请在另一终端安装 node: brew install node"
    info "或从 https://nodejs.org 下载安装包"
    warn "继续安装,但 Agent 功能在 node 安装前不可用"
  else
    info "请安装 node: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs"
    warn "继续安装,但 Agent 功能在 node 安装前不可用"
  fi
fi

NODE_BIN="$(command -v node 2>/dev/null || echo "/usr/local/bin/node")"

# ═══════════════════════════════════════════════
# Step 3: 下载并解压 Web 服务器包
# ═══════════════════════════════════════════════
info "Step 3/6: 下载 Web 服务器包..."

TARBALL_URL="https://github.com/$REPO/releases/download/v1.0.2/pi-chat-web.tar.gz"
if [ "$VERSION" != "latest" ]; then
  TARBALL_URL="https://github.com/$REPO/releases/download/$VERSION/pi-chat-web.tar.gz"
fi

TARBALL="/tmp/pi-chat-web-$$.tar.gz"
info "下载: $TARBALL_URL"
curl -fsSL "$TARBALL_URL" -o "$TARBALL" || err "下载失败!请检查版本号或网络连接"

TARBALL_SIZE=$(du -h "$TARBALL" | cut -f1)
ok "下载完成 ($TARBALL_SIZE)"

info "解压到 $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"

# 如果已有旧版本,先停止服务再替换
if [ "$OS" = "Darwin" ] && [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
elif [ "$OS" = "Linux" ] && [ -f "$SYSTEMD_SERVICE" ]; then
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
fi
pkill -f "${INSTALL_DIR}/server.js" 2>/dev/null || true

# 备份旧的 .env（保留用户的 AUTH_TOKEN 等配置）
OLD_ENV=""
if [ -f "$INSTALL_DIR/.env" ]; then
  OLD_ENV=$(cat "$INSTALL_DIR/.env")
fi

# 清理旧文件(保留 .env 和 logs)
rm -rf "$INSTALL_DIR/server.js" "$INSTALL_DIR/sandbox-agent.js" "$INSTALL_DIR/dist" "$INSTALL_DIR/node_modules"

tar xzf "$TARBALL" -C "$(dirname "$INSTALL_DIR")"
# tar 解出 pi-chat-web/,需要移动内容
if [ -d "$(dirname "$INSTALL_DIR")/pi-chat-web" ] && [ "$(dirname "$INSTALL_DIR")/pi-chat-web" != "$INSTALL_DIR" ]; then
  cp -R "$(dirname "$INSTALL_DIR")/pi-chat-web/"* "$INSTALL_DIR/" 2>/dev/null || true
  rm -rf "$(dirname "$INSTALL_DIR")/pi-chat-web"
fi
rm -f "$TARBALL"

ok "解压完成"
info "安装目录内容:"
ls -la "$INSTALL_DIR/" | head -10

# ═══════════════════════════════════════════════
# Step 4: 生成 .env 配置
# ═══════════════════════════════════════════════
info "Step 4/6: 生成配置文件..."

CLI_PATH="$INSTALL_DIR/node_modules/@dyyz1993/pi-coding-agent/dist/cli.js"

cat > "$INSTALL_DIR/.env" << EOF
# PiAgentChat Web Server 配置（自动生成）
# 生成时间: $(date '+%Y-%m-%d %H:%M:%S')

# 服务端口
PORT=$PORT

# API 认证令牌
AUTH_TOKEN=$AUTH_TOKEN

# pi CLI 路径（随包自带,无需修改）
PI_CLI_PATH=$CLI_PATH

# Agent 配置目录（默认 ~/.pi/agent,包含 auth.json/models.json）
# PI_CODING_AGENT_DIR=~/.pi/agent

# 日志目录
LOG_DIR=$INSTALL_DIR/logs

# 最大上传大小（字节,默认 50MB）
MAX_UPLOAD_SIZE=52428800
EOF

mkdir -p "$INSTALL_DIR/logs"
ok ".env 已生成"
info "PI_CLI_PATH=$CLI_PATH"

# ═══════════════════════════════════════════════
# Step 5: 配置开机自启守护进程（macOS=launchd / Linux=systemd）
# ═══════════════════════════════════════════════

setup_launchd() {
  info "Step 5/6: 配置 launchd 开机自启 (macOS)..."

  # 先卸载旧的(如果存在)
  if [ -f "$PLIST_PATH" ]; then
    launchctl unload "$PLIST_PATH" 2>/dev/null || true
  fi

  mkdir -p "$(dirname "$PLIST_PATH")"

  cat > "$PLIST_PATH" << PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${PLIST_LABEL}</string>
    <key>ProgramArguments</key>
    <array>
        <string>${BUN_BIN}</string>
        <string>${INSTALL_DIR}/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${HOME}/.bun/bin</string>
        <key>HOME</key>
        <string>${HOME}</string>
        <key>PORT</key>
        <string>${PORT}</string>
        <key>AUTH_TOKEN</key>
        <string>${AUTH_TOKEN}</string>
        <key>PI_CLI_PATH</key>
        <string>${CLI_PATH}</string>
        <key>LOG_DIR</key>
        <string>${INSTALL_DIR}/logs</string>
        <key>NODE_ENV</key>
        <string>production</string>
    </dict>
    <key>StandardOutPath</key>
    <string>${INSTALL_DIR}/logs/out.log</string>
    <key>StandardErrorPath</key>
    <string>${INSTALL_DIR}/logs/err.log</string>
    <key>KeepAlive</key>
    <true/>
    <key>RunAtLoad</key>
    <true/>
    <key>ThrottleInterval</key>
    <integer>10</integer>
</dict>
</plist>
PLISTEOF

  ok "plist 已生成: $PLIST_PATH"
}

setup_systemd() {
  info "Step 5/6: 配置 systemd 开机自启 (Linux)..."

  # 先停旧服务(如果存在)
  if [ -f "$SYSTEMD_SERVICE" ]; then
    systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  fi

  # 判断是否需要 sudo
  SUDO=""
  if [ "$(id -u)" != "0" ] && command -v sudo &>/dev/null; then
    SUDO="sudo"
  fi

  # systemd 需要 node 在系统 PATH 里(systemd 不会读 .bashrc)
  NODE_FOR_SYSTEMD="$(command -v node 2>/dev/null || echo "$HOME/.n/bin/node")"

  cat > /tmp/${SERVICE_NAME}.service << SVCEOF
[Unit]
Description=PiAgentChat Web Server
After=network.target

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=${INSTALL_DIR}
Environment="PATH=${HOME}/.bun/bin:/usr/local/bin:/usr/bin:/bin:${HOME}/.n/bin"
Environment="HOME=${HOME}"
Environment="PORT=${PORT}"
Environment="AUTH_TOKEN=${AUTH_TOKEN}"
Environment="PI_CLI_PATH=${CLI_PATH}"
Environment="LOG_DIR=${INSTALL_DIR}/logs"
Environment="NODE_ENV=production"
ExecStart=${BUN_BIN} ${INSTALL_DIR}/server.js
Restart=always
RestartSec=10
StandardOutput=append:${INSTALL_DIR}/logs/out.log
StandardError=append:${INSTALL_DIR}/logs/err.log

[Install]
WantedBy=multi-user.target
SVCEOF

  $SUDO cp /tmp/${SERVICE_NAME}.service "$SYSTEMD_SERVICE"
  rm -f /tmp/${SERVICE_NAME}.service

  $SUDO systemctl daemon-reload
  ok "systemd service 已生成: $SYSTEMD_SERVICE"
}

if [ "${SKIP_DAEMON:-0}" = "1" ]; then
  info "Step 5/6: 跳过守护进程配置(SKIP_DAEMON=1)"
elif [ "$OS" = "Darwin" ]; then
  setup_launchd
elif [ "$OS" = "Linux" ]; then
  if command -v systemctl &>/dev/null; then
    setup_systemd
  else
    warn "Linux 系统无 systemctl,跳过守护进程配置"
    info "请手动配置进程管理(pm2/supervisor/nohup)"
  fi
fi

# ═══════════════════════════════════════════════
# Step 6: 启动服务 + 健康检查
# ═══════════════════════════════════════════════
info "Step 6/6: 启动服务..."

# 先杀掉可能存在的旧进程
pkill -f "${INSTALL_DIR}/server.js" 2>/dev/null || true
sleep 1

# 判断启动方式
if [ "${SKIP_DAEMON:-0}" = "1" ]; then
  # 用户要求跳过守护进程,直接 nohup
  cd "$INSTALL_DIR"
  PORT="$PORT" AUTH_TOKEN="$AUTH_TOKEN" PI_CLI_PATH="$CLI_PATH" LOG_DIR="$INSTALL_DIR/logs" \
    nohup "$BUN_BIN" server.js > "$INSTALL_DIR/logs/out.log" 2>&1 &
  ok "服务已启动 nohup (PID: $!)"
elif [ "$OS" = "Darwin" ] && [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  launchctl load "$PLIST_PATH" 2>/dev/null || err "launchctl load 失败"
  ok "launchd 服务已启动(开机自启 + 崩溃自动重启)"
elif [ "$OS" = "Linux" ] && [ -f "$SYSTEMD_SERVICE" ]; then
  SUDO=""
  if [ "$(id -u)" != "0" ] && command -v sudo &>/dev/null; then
    SUDO="sudo"
  fi
  $SUDO systemctl enable "$SERVICE_NAME" 2>/dev/null || true
  $SUDO systemctl start "$SERVICE_NAME" || err "systemctl start 失败"
  ok "systemd 服务已启动(开机自启 + 崩溃自动重启)"
else
  # Fallback: 直接用 bun 启动(后台)
  cd "$INSTALL_DIR"
  PORT="$PORT" AUTH_TOKEN="$AUTH_TOKEN" PI_CLI_PATH="$CLI_PATH" LOG_DIR="$INSTALL_DIR/logs" \
    nohup "$BUN_BIN" server.js > "$INSTALL_DIR/logs/out.log" 2>&1 &
  ok "服务已启动 nohup (PID: $!)"
fi

# 健康检查
info "等待服务启动..."
HEALTH_OK=false
for i in 1 2 3 4 5 6 7 8 9 10; do
  sleep 2
  if curl -sf -m 3 "http://localhost:${PORT}/health" >/dev/null 2>&1; then
    HEALTH_OK=true
    break
  fi
  echo -n "."
done
echo ""

if [ "$HEALTH_OK" = true ]; then
  ok "健康检查通过 ✅ (HTTP 200)"
else
  warn "健康检查失败(服务可能还在启动中)"
  info "查看日志: tail -50 $INSTALL_DIR/logs/err.log"
  info "手动检查: curl http://localhost:${PORT}/health"
fi

# ═══════════════════════════════════════════════
# 完成
# ═══════════════════════════════════════════════
LOCAL_IP=""
if [ "$OS" = "Darwin" ]; then
  LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
else
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "")
fi

echo ""
echo "═══════════════════════════════════════════"
echo -e "  ${GREEN}✅ PiAgentChat Web Server 安装完成!${NC}"
echo "═══════════════════════════════════════════"
echo ""
echo "  📡 访问地址:"
echo "     本机:   http://localhost:${PORT}"
if [ -n "$LOCAL_IP" ]; then
  echo "     网络:   http://${LOCAL_IP}:${PORT}"
fi
echo ""
echo "  🔧 管理命令:"
if [ "$OS" = "Darwin" ] && [ "${SKIP_DAEMON:-0}" != "1" ]; then
  echo "     查看状态: launchctl list | grep ${PLIST_LABEL}"
  echo "     查看日志: tail -f ${INSTALL_DIR}/logs/out.log"
  echo "     重启服务: launchctl unload ${PLIST_PATH} && launchctl load ${PLIST_PATH}"
  echo "     停止服务: launchctl unload ${PLIST_PATH}"
elif [ "$OS" = "Linux" ] && [ "${SKIP_DAEMON:-0}" != "1" ] && [ -f "$SYSTEMD_SERVICE" ]; then
  echo "     查看状态: systemctl status ${SERVICE_NAME}"
  echo "     查看日志: journalctl -u ${SERVICE_NAME} -f  或  tail -f ${INSTALL_DIR}/logs/out.log"
  echo "     重启服务: sudo systemctl restart ${SERVICE_NAME}"
  echo "     停止服务: sudo systemctl stop ${SERVICE_NAME}"
else
  echo "     查看日志: tail -f ${INSTALL_DIR}/logs/out.log"
  echo "     停止服务: pkill -f ${INSTALL_DIR}/server.js"
fi
echo ""
echo "  📁 安装目录: ${INSTALL_DIR}"
echo "  📋 配置文件: ${INSTALL_DIR}/.env"
echo ""
if ! command -v node &>/dev/null; then
  echo -e "  ${YELLOW}⚠  注意: node 未安装,Agent 功能暂不可用${NC}"
  if [ "$OS" = "Darwin" ]; then
    echo "     安装 node: brew install node"
  else
    echo "     安装 node: curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt-get install -y nodejs"
  fi
  echo ""
fi
echo "  💡 授权配置(AUTH_TOKEN / API Key)在 ~/.pi/agent/ 目录下"
echo "     确保 auth.json / models.json 存在,否则 LLM 调用会失败"
echo ""
