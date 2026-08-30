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
#   SKIP_DAEMON       设为 1 跳过守护进程配置(用 nohup)
#
# 守护进程:
#   macOS  → launchd (~/Library/LaunchAgents/com.pi-agent-chat.web.plist)
#   Linux  → systemd (/etc/systemd/system/pi-agent-chat.service, 需要 sudo)
#   容器*  → daemon.sh 崩溃重启循环 + cron @reboot 开机自启
#            (* PID 1 不是 systemd 的容器环境)
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
DAEMON_SCRIPT="$INSTALL_DIR/daemon.sh"

# node 最低版本(pi-coding-agent 的 undici@8 要求 node >= 22)
NODE_MIN_MAJOR=22

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
info "Step 1/7: 检查/安装 bun..."

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

# 确保 bun 在 PATH 里(launchd/systemd 需要完整路径)
BUN_BIN="$(command -v bun)"
if [ -z "$BUN_BIN" ]; then
  BUN_BIN="$HOME/.bun/bin/bun"
fi
info "bun 路径: $BUN_BIN"

# ═══════════════════════════════════════════════
# Step 2: 安装/升级 node（CLI 子进程运行时,需要 >= v22）
# ═══════════════════════════════════════════════
info "Step 2/7: 检查/安装 node (需要 >= v${NODE_MIN_MAJOR})..."

# 获取当前 node 主版本号(没有 node 则为 0)
get_node_major_version() {
  command -v node &>/dev/null && node -e "process.stdout.write(process.versions.node.split('.')[0])" 2>/dev/null || echo "0"
}

CURRENT_NODE_VER=$(get_node_major_version)

if [ "$CURRENT_NODE_VER" -ge "$NODE_MIN_MAJOR" ]; then
  ok "node 版本满足要求: $(node --version)"
else
  if [ "$CURRENT_NODE_VER" -gt 0 ]; then
    warn "node $(node --version) 版本过低 (需要 >= v${NODE_MIN_MAJOR}),undici@8 不兼容旧版 node"
  else
    warn "node 未安装"
  fi
  info "通过 n 安装 node LTS..."

  # 判断 sudo 可用性
  SUDO=""
  if [ "$(id -u)" != "0" ] && command -v sudo &>/dev/null; then
    SUDO="sudo"
  fi

  # 下载 n 版本管理器
  N_SCRIPT="/tmp/n-install-$$"
  curl -fsSL https://raw.githubusercontent.com/tj/n/master/bin/n -o "$N_SCRIPT"
  chmod +x "$N_SCRIPT"

  if [ "$OS" = "Darwin" ]; then
    # macOS: 装到用户目录(不污染系统)
    export N_PREFIX="${N_PREFIX:-$HOME/.n}"
    mkdir -p "$N_PREFIX/bin"
    N_PREFIX="$N_PREFIX" "$N_SCRIPT" lts
    # 确保 ~/.n/bin 在 PATH
    grep -q '.n/bin' "$HOME/.zshrc" 2>/dev/null || echo 'export PATH="$HOME/.n/bin:$PATH"' >> "$HOME/.zshrc"
    grep -q '.n/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.n/bin:$PATH"' >> "$HOME/.bashrc"
    export PATH="$HOME/.n/bin:$PATH"
  else
    # Linux: root 直接装到 /usr/local; 非 root 先试 sudo,失败则装到用户目录
    if [ -n "$SUDO" ]; then
      $SUDO env "PATH=$PATH" "$N_SCRIPT" lts
    else
      export N_PREFIX="${N_PREFIX:-$HOME/.n}"
      mkdir -p "$N_PREFIX/bin"
      N_PREFIX="$N_PREFIX" "$N_SCRIPT" lts
      grep -q '.n/bin' "$HOME/.bashrc" 2>/dev/null || echo 'export PATH="$HOME/.n/bin:$PATH"' >> "$HOME/.bashrc"
      export PATH="$HOME/.n/bin:$PATH"
    fi
  fi
  rm -f "$N_SCRIPT"

  # 验证
  NEW_NODE_VER=$(get_node_major_version)
  if [ "$NEW_NODE_VER" -ge "$NODE_MIN_MAJOR" ]; then
    ok "node 已升级到 $(node --version) ✅"
  else
    err "node 升级失败(当前: $(node --version 2>/dev/null || echo '无'))\n  请手动安装 node >= v${NODE_MIN_MAJOR}: https://nodejs.org/"
  fi
fi

NODE_BIN="$(command -v node 2>/dev/null || echo "/usr/local/bin/node")"
info "node 路径: $NODE_BIN"

# ═══════════════════════════════════════════════
# Step 2.5: 服务器运行时选择（bun 优先, 不可用回退 node）
# bun 在老 glibc 系统（如 CentOS 7, glibc 2.17）会静默崩溃零输出,
# 探测失败则用 node 跑并在解压后给 server.js 打 __require 补丁。
# ═══════════════════════════════════════════════
SERVER_BIN="$BUN_BIN"
SERVER_RUNTIME="bun"
if ! "$BUN_BIN" -e 'process.stdout.write("bun-ok")' 2>/dev/null | grep -q "bun-ok"; then
  warn "bun 无法在本机运行(老 glibc?) — 回退到 node 运行时"
  if [ "$(get_node_major_version)" -lt "$NODE_MIN_MAJOR" ]; then
    err "bun 不可用且 node >= v${NODE_MIN_MAJOR} 未安装,无法继续"
  fi
  SERVER_BIN="$NODE_BIN"
  SERVER_RUNTIME="node"
  ok "服务器运行时: node ($(node --version))"
else
  ok "服务器运行时: bun ($("$BUN_BIN" --version 2>/dev/null))"
fi

# ═══════════════════════════════════════════════
# Step 3: 下载并解压 Web 服务器包
# ═══════════════════════════════════════════════
info "Step 3/7: 下载 Web 服务器包..."

# 解析 latest 版本号(GitHub API)
if [ "$VERSION" = "latest" ]; then
  LATEST_TAG=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" 2>/dev/null \
    | grep '"tag_name"' | head -1 | sed -E 's/.*"tag_name":\s*"([^"]+)".*/\1/')
  if [ -z "$LATEST_TAG" ]; then
    err "无法获取最新 Release tag,请指定版本号: bash install-web.sh v1.0.2"
  fi
  info "最新版本: $LATEST_TAG"
  TARBALL_URL="https://github.com/$REPO/releases/download/$LATEST_TAG/pi-chat-web.tar.gz"
else
  TARBALL_URL="https://github.com/$REPO/releases/download/$VERSION/pi-chat-web.tar.gz"
fi

# 离线/慢网络安装: LOCAL_TARBALL 指向已下载的 pi-chat-web.tar.gz
if [ -n "$LOCAL_TARBALL" ] && [ -f "$LOCAL_TARBALL" ]; then
  TARBALL="$LOCAL_TARBALL"
  ok "使用本地包: $TARBALL ($(du -h "$TARBALL" | cut -f1))"
else
  TARBALL="/tmp/pi-chat-web-$$.tar.gz"
  info "下载: $TARBALL_URL"
  curl -fsSL "$TARBALL_URL" -o "$TARBALL" || err "下载失败!请检查版本号或网络连接(或设 LOCAL_TARBALL= 离线安装)"

  TARBALL_SIZE=$(du -h "$TARBALL" | cut -f1)
  ok "下载完成 ($TARBALL_SIZE)"
fi

info "解压到 $INSTALL_DIR ..."
mkdir -p "$INSTALL_DIR"

# 如果已有旧版本,先停止服务再替换
if [ "$OS" = "Darwin" ] && [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
elif [ "$OS" = "Linux" ] && [ -f "$SYSTEMD_SERVICE" ]; then
  systemctl stop "$SERVICE_NAME" 2>/dev/null || true
fi
pkill -f "${INSTALL_DIR}/server.js" 2>/dev/null || true

# 清理旧文件(保留 .env 和 logs)
rm -rf "$INSTALL_DIR/server.js" "$INSTALL_DIR/sandbox-agent.js" "$INSTALL_DIR/dist" "$INSTALL_DIR/node_modules"

tar xzf "$TARBALL" -C "$(dirname "$INSTALL_DIR")"
# tar 解出 pi-chat-web/,需要移动内容
if [ -d "$(dirname "$INSTALL_DIR")/pi-chat-web" ] && [ "$(dirname "$INSTALL_DIR")/pi-chat-web" != "$INSTALL_DIR" ]; then
  cp -R "$(dirname "$INSTALL_DIR")/pi-chat-web/"* "$INSTALL_DIR/" 2>/dev/null || true
  rm -rf "$(dirname "$INSTALL_DIR")/pi-chat-web"
fi
# 只清理自行下载的临时包,LOCAL_TARBALL 提供的离线包保留
if [ -z "$LOCAL_TARBALL" ] || [ "$TARBALL" != "$LOCAL_TARBALL" ]; then
  rm -f "$TARBALL"
fi

# node 运行时: bun-target 产物含 `import.meta.require`(node 不支持),
# 替换为 createRequire(与 replay 手动部署的补丁一致)。
if [ "$SERVER_RUNTIME" = "node" ] && grep -q "var __require = import.meta.require;" "$INSTALL_DIR/server.js"; then
  sed -i.bak \
    's|var __require = import.meta.require;|import { createRequire as __cr } from "module"; var __require = __cr(import.meta.url);|' \
    "$INSTALL_DIR/server.js"
  rm -f "$INSTALL_DIR/server.js.bak"
  ok "已为 node 运行时应用 __require 补丁"
fi

ok "解压完成"
info "安装目录内容:"
ls -la "$INSTALL_DIR/" | head -10

# ═══════════════════════════════════════════════
# Step 4: 生成 .env 配置 + 授权文件检查
# ═══════════════════════════════════════════════
info "Step 4/7: 生成配置文件..."

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

# 授权文件检查(Agent 调 LLM 需要)
AGENT_DIR="$HOME/.pi/agent"
AUTH_MISSING=false
for f in auth.json models.json; do
  if [ ! -f "$AGENT_DIR/$f" ]; then
    AUTH_MISSING=true
  fi
done
if [ "$AUTH_MISSING" = true ]; then
  echo ""
  warn "⚠  授权文件不完整! Agent 将无法调用 LLM"
  echo -e "  ${YELLOW}缺少 ~/.pi/agent/ 下的 auth.json 或 models.json${NC}"
  echo ""
  echo "  从已有机器拷贝(在源机器上执行):"
  echo "    mkdir -p 新服务器:~/.pi/agent"
  echo "    scp ~/.pi/agent/auth.json    新服务器:~/.pi/agent/"
  echo "    scp ~/.pi/agent/models.json  新服务器:~/.pi/agent/"
  echo "    scp ~/.pi/agent/settings.json 新服务器:~/.pi/agent/"
  echo ""
  echo "  服务可以先启动,但发消息时 Agent 会报错。"
  echo ""
fi

# ═══════════════════════════════════════════════
# Step 5: 配置守护进程（macOS=launchd / Linux=systemd / 容器=daemon.sh）
# ═══════════════════════════════════════════════
# 检测是否有真正的 systemd(PID 1 是 systemd)
HAS_SYSTEMD=false
if [ "$OS" = "Linux" ]; then
  if [ "$(cat /proc/1/comm 2>/dev/null)" = "systemd" ] && command -v systemctl &>/dev/null; then
    HAS_SYSTEMD=true
  fi
fi

setup_launchd() {
  info "Step 5/7: 配置 launchd 开机自启 (macOS)..."

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
        <string>${SERVER_BIN}</string>
        <string>${INSTALL_DIR}/server.js</string>
    </array>
    <key>WorkingDirectory</key>
    <string>${INSTALL_DIR}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin:${HOME}/.bun/bin:${HOME}/.n/bin</string>
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
  info "Step 5/7: 配置 systemd 开机自启 (Linux)..."

  SUDO=""
  if [ "$(id -u)" != "0" ] && command -v sudo &>/dev/null; then
    SUDO="sudo"
  fi

  if [ -f "$SYSTEMD_SERVICE" ]; then
    $SUDO systemctl stop "$SERVICE_NAME" 2>/dev/null || true
    $SUDO systemctl disable "$SERVICE_NAME" 2>/dev/null || true
  fi

  cat > "/tmp/${SERVICE_NAME}.service" << SVCEOF
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
ExecStart=${SERVER_BIN} ${INSTALL_DIR}/server.js
Restart=always
RestartSec=10
StandardOutput=append:${INSTALL_DIR}/logs/out.log
StandardError=append:${INSTALL_DIR}/logs/err.log

[Install]
WantedBy=multi-user.target
SVCEOF

  $SUDO cp "/tmp/${SERVICE_NAME}.service" "$SYSTEMD_SERVICE"
  rm -f "/tmp/${SERVICE_NAME}.service"
  $SUDO systemctl daemon-reload
  ok "systemd service 已生成: $SYSTEMD_SERVICE"
}

# 容器环境(dumb-init / 非 systemd PID 1)的守护方案
setup_daemon_script() {
  info "Step 5/7: 配置 daemon.sh 崩溃重启循环 (容器环境)..."

  cat > "$DAEMON_SCRIPT" << 'DAEMONEOF'
#!/bin/bash
# PiAgentChat 守护进程 — 崩溃自动重启 + cron 开机自启
# 由 install-web.sh 自动生成,请勿手动编辑

INSTALL_DIR="INSTALL_DIR_PLACEHOLDER"
AUTH_TOKEN="AUTH_TOKEN_PLACEHOLDER"
PORT="PORT_PLACEHOLDER"
CLI_PATH="CLI_PATH_PLACEHOLDER"
HOME_DIR="HOME_PLACEHOLDER"
RUNTIME_BIN="RUNTIME_BIN_PLACEHOLDER"

export PATH="$HOME_DIR/.bun/bin:/usr/local/bin:/usr/bin:/bin:$HOME_DIR/.n/bin"
export HOME="$HOME_DIR"
cd "$INSTALL_DIR"

LOG="$INSTALL_DIR/logs/daemon.log"
echo "$(date '+%Y-%m-%dT%H:%M:%S') [daemon] 启动守护循环" >> "$LOG"

while true; do
  echo "$(date '+%Y-%m-%dT%H:%M:%S') [daemon] 启动 server..." >> "$LOG"
  PORT="$PORT" AUTH_TOKEN="$AUTH_TOKEN" PI_CLI_PATH="$CLI_PATH" \
    LOG_DIR="$INSTALL_DIR/logs" NODE_ENV=production \
    "$RUNTIME_BIN" "$INSTALL_DIR/server.js" >> "$INSTALL_DIR/logs/out.log" 2>&1
  EXIT_CODE=$?
  echo "$(date '+%Y-%m-%dT%H:%M:%S') [daemon] server 退出 code=$EXIT_CODE,3秒后重启" >> "$LOG"
  sleep 3
done
DAEMONEOF

  # 替换占位符
  sed -i.bak \
    -e "s|INSTALL_DIR_PLACEHOLDER|$INSTALL_DIR|g" \
    -e "s|AUTH_TOKEN_PLACEHOLDER|$AUTH_TOKEN|g" \
    -e "s|PORT_PLACEHOLDER|$PORT|g" \
    -e "s|CLI_PATH_PLACEHOLDER|$CLI_PATH|g" \
    -e "s|HOME_PLACEHOLDER|$HOME|g" \
    -e "s|RUNTIME_BIN_PLACEHOLDER|$SERVER_BIN|g" \
    "$DAEMON_SCRIPT"
  rm -f "$DAEMON_SCRIPT.bak"
  chmod +x "$DAEMON_SCRIPT"
  ok "daemon.sh 已生成: $DAEMON_SCRIPT"

  # 配置 cron @reboot 开机自启
  if ! command -v crontab &>/dev/null; then
    info "安装 cron..."
    if command -v apt-get &>/dev/null; then
      apt-get install -y cron 2>/dev/null && service cron start 2>/dev/null || true
    elif command -v yum &>/dev/null; then
      yum install -y cronie 2>/dev/null && service crond start 2>/dev/null || true
    fi
  fi

  if command -v crontab &>/dev/null; then
    ( crontab -l 2>/dev/null | grep -v "pi-agent-chat-web/daemon.sh" \
      ; echo "@reboot $DAEMON_SCRIPT >> $INSTALL_DIR/logs/daemon.log 2>&1" \
    ) | crontab -
    ok "cron @reboot 已配置(容器重启后自动启动)"
  else
    warn "cron 不可用,开机自启未配置(服务仍会在本次运行中崩溃自动重启)"
  fi
}

if [ "${SKIP_DAEMON:-0}" = "1" ]; then
  info "Step 5/7: 跳过守护进程配置(SKIP_DAEMON=1)"
elif [ "$OS" = "Darwin" ]; then
  setup_launchd
elif [ "$HAS_SYSTEMD" = true ]; then
  setup_systemd
elif [ "$OS" = "Linux" ]; then
  # 容器环境(dumb-init 等非 systemd PID 1)
  setup_daemon_script
fi

# ═══════════════════════════════════════════════
# Step 6: 启动服务
# ═══════════════════════════════════════════════
info "Step 6/7: 启动服务..."

# 先杀掉可能存在的旧进程/旧 daemon
pkill -f "${INSTALL_DIR}/daemon.sh" 2>/dev/null || true
pkill -f "${INSTALL_DIR}/server.js" 2>/dev/null || true
sleep 1

# 判断 sudo
SUDO=""
if [ "$(id -u)" != "0" ] && command -v sudo &>/dev/null; then
  SUDO="sudo"
fi

if [ "${SKIP_DAEMON:-0}" = "1" ]; then
  cd "$INSTALL_DIR"
  PORT="$PORT" AUTH_TOKEN="$AUTH_TOKEN" PI_CLI_PATH="$CLI_PATH" LOG_DIR="$INSTALL_DIR/logs" \
    nohup "$SERVER_BIN" server.js > "$INSTALL_DIR/logs/out.log" 2>&1 &
  ok "服务已启动 nohup (PID: $!)"
elif [ "$OS" = "Darwin" ] && [ -f "$PLIST_PATH" ]; then
  launchctl unload "$PLIST_PATH" 2>/dev/null || true
  launchctl load "$PLIST_PATH" 2>/dev/null || err "launchctl load 失败"
  ok "launchd 服务已启动(开机自启 + 崩溃自动重启)"
elif [ "$HAS_SYSTEMD" = true ] && [ -f "$SYSTEMD_SERVICE" ]; then
  $SUDO systemctl enable "$SERVICE_NAME" 2>/dev/null || true
  $SUDO systemctl start "$SERVICE_NAME" || err "systemctl start 失败"
  ok "systemd 服务已启动(开机自启 + 崩溃自动重启)"
elif [ -f "$DAEMON_SCRIPT" ]; then
  # 容器环境:用 setsid 启动 daemon(脱离 SSH 会话)
  setsid nohup bash "$DAEMON_SCRIPT" >> "$INSTALL_DIR/logs/daemon.log" 2>&1 < /dev/null &
  disown 2>/dev/null || true
  ok "daemon.sh 已启动(崩溃自动重启 + cron 开机自启)"
else
  cd "$INSTALL_DIR"
  PORT="$PORT" AUTH_TOKEN="$AUTH_TOKEN" PI_CLI_PATH="$CLI_PATH" LOG_DIR="$INSTALL_DIR/logs" \
    nohup "$SERVER_BIN" server.js > "$INSTALL_DIR/logs/out.log" 2>&1 &
  ok "服务已启动 nohup (PID: $!)"
fi

# ═══════════════════════════════════════════════
# Step 7: 健康检查
# ═══════════════════════════════════════════════
info "Step 7/7: 健康检查..."
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
  info "查看日志: tail -50 $INSTALL_DIR/logs/out.log"
  info "手动检查: curl http://localhost:${PORT}/health"
fi

# ═══════════════════════════════════════════════
# 完成总结
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
elif [ "$HAS_SYSTEMD" = true ] && [ "${SKIP_DAEMON:-0}" != "1" ]; then
  echo "     查看状态: systemctl status ${SERVICE_NAME}"
  echo "     查看日志: journalctl -u ${SERVICE_NAME} -f"
  echo "     重启服务: ${SUDO:-sudo} systemctl restart ${SERVICE_NAME}"
  echo "     停止服务: ${SUDO:-sudo} systemctl stop ${SERVICE_NAME}"
elif [ -f "$DAEMON_SCRIPT" ]; then
  echo "     查看进程: ps aux | grep server.js | grep -v grep"
  echo "     查看日志: tail -f ${INSTALL_DIR}/logs/out.log"
  echo "     守护日志: tail -f ${INSTALL_DIR}/logs/daemon.log"
  echo "     重启服务: pkill -f '${INSTALL_DIR}/server.js' (daemon 会自动拉起)"
  echo "     完全停止: pkill -f '${INSTALL_DIR}/daemon.sh'; pkill -f '${INSTALL_DIR}/server.js'"
else
  echo "     查看日志: tail -f ${INSTALL_DIR}/logs/out.log"
  echo "     停止服务: pkill -f ${INSTALL_DIR}/server.js"
fi
echo ""
echo "  📁 安装目录: ${INSTALL_DIR}"
echo "  📋 配置文件: ${INSTALL_DIR}/.env"
echo ""
if [ "$AUTH_MISSING" = true ]; then
  echo -e "  ${RED}⚠  授权文件不完整!请按上方提示从已有机器拷贝 ~/.pi/agent/${NC}"
  echo ""
fi
echo "  💡 完整文档: https://github.com/${REPO}/blob/master/DEPLOYMENT.md"
echo ""
