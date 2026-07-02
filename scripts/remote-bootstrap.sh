#!/bin/bash
# =============================================================================
# pi remote-bootstrap — 一键接入远程机器
# 用法: bash scripts/remote-bootstrap.sh <host>
# 例子: bash scripts/remote-bootstrap.sh xyz-mac
# =============================================================================

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

HOST="${1:-}"
[ -z "$HOST" ] && { echo "用法: $0 <host>"; exit 1; }

# ── 配置 ──
REMOTE_PI_VERSION="0.74.61"      # 临时固定，等 npm pi-tui dist 修复后改为 latest
REMOTE_NODE_VERSION="v22.22.2"    # LTS
LOCAL_PI_DIR="$HOME/.pi/agent"
SERVER_ENV_DIR="/opt/pi-agent-chat"

# ── 辅助 ──
step()   { echo -e "\n${CYAN}═══════════════════════════════════════${NC}"; echo -e "${CYAN}  $1${NC}"; echo -e "${CYAN}═══════════════════════════════════════${NC}"; }
check() {
  local desc="$1" cmd="$2"
  echo -n "  [...] $desc ... "
  if eval "$cmd" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PASS${NC}"
    PASS=$((PASS + 1))
    return 0
  else
    echo -e "${RED}❌ FAIL${NC}"
    FAIL=$((FAIL + 1))
    return 1
  fi
}
info() { echo -e "  ${YELLOW}ℹ${NC} $1"; }
ok()   { echo -e "  ${GREEN}✅${NC} $1"; }
fail() { echo -e "  ${RED}❌${NC} $1"; WARN=$((WARN + 1)); }

SSH="ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new $HOST"
SCP="scp -o StrictHostKeyChecking=accept-new"

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║     pi remote-bootstrap                                 ║"
echo "║     Target: $HOST"
echo "╚══════════════════════════════════════════════════════════╝"

# ═══════════════════════════════════════════════════════════════
# Step 1: SSH 连通性
# ═══════════════════════════════════════════════════════════════
step "1. SSH 连通性"
check "SSH 连接"         "$SSH echo ok"
check "Hostname 解析"    "ping -c 1 -W 3 $HOST 2>/dev/null || $SSH hostname"

# ═══════════════════════════════════════════════════════════════
# Step 2: 远程平台检测
# ═══════════════════════════════════════════════════════════════
step "2. 平台检测"
REMOTE_PLATFORM=$($SSH "uname -s" 2>/dev/null | tr '[:upper:]' '[:lower:]')
REMOTE_ARCH=$($SSH "uname -m" 2>/dev/null | tr '[:upper:]' '[:lower:]')
info "平台: $REMOTE_PLATFORM"
info "架构: $REMOTE_ARCH"

case "$REMOTE_PLATFORM" in
  linux)  NODE_ARCH="linux-${REMOTE_ARCH/x86_64/x64}" ;;
  darwin) NODE_ARCH="darwin-${REMOTE_ARCH/x86_64/x64}" ;;
  *)      fail "不支持的平台: $REMOTE_PLATFORM (支持: linux/darwin)" ;;
esac

# ═══════════════════════════════════════════════════════════════
# Step 3: 环境检测 (node, pi)
# ═══════════════════════════════════════════════════════════════
step "3. 环境检测"

# 检测 node
REMOTE_NODE=$($SSH "export PATH=\"/usr/local/bin:/opt/homebrew/bin:\$PATH\" && which node 2>/dev/null" 2>/dev/null || echo "")
if [ -n "$REMOTE_NODE" ]; then
  NODE_VER=$($SSH "export PATH=\"/usr/local/bin:/opt/homebrew/bin:\$PATH\" && node --version" 2>/dev/null || echo "unknown")
  ok "Node: $REMOTE_NODE → $NODE_VER"
  INSTALL_NODE=false
else
  fail "Node: 未安装"
  INSTALL_NODE=true
fi

# 检测 pi
REMOTE_PI=$($SSH "export PATH=\"/usr/local/bin:/opt/homebrew/bin:\$HOME/.npm-global/bin:\$PATH\" && which pi 2>/dev/null" 2>/dev/null || echo "")
if [ -n "$REMOTE_PI" ]; then
  PI_VER=$($SSH "export PATH=\"/usr/local/bin:/opt/homebrew/bin:\$HOME/.npm-global/bin:\$PATH\" && pi --version" 2>/dev/null || echo "unknown")
  ok "pi: $REMOTE_PI → $PI_VER"
  INSTALL_PI=false
else
  fail "pi: 未安装"
  INSTALL_PI=true
fi

# ═══════════════════════════════════════════════════════════════
# Step 4: 安装缺失组件
# ═══════════════════════════════════════════════════════════════
step "4. 安装缺失组件"

if [ "$INSTALL_NODE" = true ]; then
  info "正在下载 Node.js $REMOTE_NODE_VERSION 到 $HOST ..."
  $SSH "cd /tmp && \
    curl -sL https://nodejs.org/dist/$REMOTE_NODE_VERSION/node-$REMOTE_NODE_VERSION-$NODE_ARCH.tar.gz -o node.tar.gz && \
    tar xzf node.tar.gz && \
    sudo mkdir -p /usr/local/bin && \
    sudo cp node-$REMOTE_NODE_VERSION-$NODE_ARCH/bin/node /usr/local/bin/node && \
    sudo cp node-$REMOTE_NODE_VERSION-$NODE_ARCH/bin/npm /usr/local/bin/npm && \
    sudo cp node-$REMOTE_NODE_VERSION-$NODE_ARCH/bin/npx /usr/local/bin/npx && \
    rm -rf node-$REMOTE_NODE_VERSION-$NODE_ARCH node.tar.gz" 2>&1 | tail -1
  ok "Node 安装完成"
fi

if [ "$INSTALL_PI" = true ]; then
  info "正在安装 pi v$REMOTE_PI_VERSION ..."
  $SSH "export PATH=\"/usr/local/bin:\$PATH\" && \
    npm install -g @dyyz1993/pi-coding-agent@$REMOTE_PI_VERSION" 2>&1 | tail -2
  ok "pi 安装完成"
fi

# ═══════════════════════════════════════════════════════════════
# Step 5: 配置同步 (auth, models, settings)
# ═══════════════════════════════════════════════════════════════
step "5. 配置同步"

$SSH "mkdir -p ~/.pi/agent" 2>/dev/null

for f in auth.json models.json settings.json; do
  if [ -f "$LOCAL_PI_DIR/$f" ]; then
    $SCP "$LOCAL_PI_DIR/$f" "$HOST:~/.pi/agent/$f" 2>/dev/null && ok "$f 已同步" || fail "$f 同步失败"
  else
    fail "本地 $LOCAL_PI_DIR/$f 不存在，跳过"
  fi
done

# ═══════════════════════════════════════════════════════════════
# Step 6: 验证
# ═══════════════════════════════════════════════════════════════
step "6. 远程验证"

PREFIX="export PATH=\"/usr/local/bin:/opt/homebrew/bin:\$HOME/.npm-global/bin:\$PATH\""

check "pi --version"   "$SSH \"$PREFIX && pi --version\""
check "pi 可列模型"    "$SSH \"$PREFIX && pi --list-models 2>&1 | grep -q deepseek\""
check "auth.json 非空" "$SSH \"test -s ~/.pi/agent/auth.json && grep -q api_key ~/.pi/agent/auth.json\""
check "models 有配置"   "$SSH \"grep -q opencode-go ~/.pi/agent/models.json\""

# ═══════════════════════════════════════════════════════════════
# Step 7: 本地注册
# ═══════════════════════════════════════════════════════════════
step "7. 本地注册"

if [ -f "$SERVER_ENV_DIR/.env" ]; then
  # 检查是否已注册
  if grep -q "$HOST" "$SERVER_ENV_DIR/.env" 2>/dev/null; then
    ok "$HOST 已在 .env 中注册"
  else
    # 获取远程 pi 路径
    REMOTE_PI_PATH=$($SSH "$PREFIX && which pi" 2>/dev/null || echo "/usr/local/bin/pi")
    REMOTE_NODE_PATH=$($SSH "export PATH=\"/usr/local/bin:\$PATH\" && which node" 2>/dev/null || echo "/usr/local/bin/node")

    cat >> "$SERVER_ENV_DIR/.env" << ENVEOF

# Remote: $HOST (自动注册)
REMOTE_CHILD_AUTO_UPLOAD=false
REMOTE_CHILD_NODE_PATH=$REMOTE_NODE_PATH
REMOTE_CHILD_PI_CLI_PATH=$REMOTE_PI_PATH
REMOTE_CHILD_SHELL=sh -lc
ENVEOF
    ok "已写入 $SERVER_ENV_DIR/.env"
    info "请重启服务: pm2 restart pi-agent-chat --update-env"
  fi
else
  fail "$SERVER_ENV_DIR/.env 不存在，跳过本地注册"
fi

# ═══════════════════════════════════════════════════════════════
# 汇总
# ═══════════════════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  ${GREEN}$PASS 通过${NC}  ${RED}$FAIL 失败${NC}  ${YELLOW}$WARN 警告${NC}"
echo "╚══════════════════════════════════════════════════════════╝"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}❌ 部分检测未通过，请查看上面的 FAIL 项${NC}"
  exit 1
else
  echo -e "${GREEN}🎉 全部通过！$HOST 已准备就绪${NC}"
  echo -e "   运行 deploy-check.sh 可验证完整链路"
  exit 0
fi
