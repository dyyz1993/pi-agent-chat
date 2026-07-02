#!/bin/bash
# =============================================================================
# pi-agent-chat 部署验证脚本
# 部署完成后运行此脚本，确保所有链路通顺
# 用法: bash deploy-check.sh
# =============================================================================

set -e

PASS=0
FAIL=0

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

check() {
  local desc="$1"
  local cmd="$2"
  echo -n "[...] $desc ... "
  if eval "$cmd" > /dev/null 2>&1; then
    echo -e "${GREEN}✅ PASS${NC}"
    PASS=$((PASS + 1))
  else
    echo -e "${RED}❌ FAIL${NC}"
    FAIL=$((FAIL + 1))
  fi
}

echo ""
echo "═══════════════════════════════════════════"
echo "    pi-agent-chat Deployment Check"
echo "═══════════════════════════════════════════"
echo ""

# ── 环境变量 ──
echo "── 1. 环境变量 ──"
check "PORT 已设置"                 'test -n "$PORT"'
check "AUTH_TOKEN 已设置"           'test -n "$AUTH_TOKEN"'
check "PI_CLI_PATH 已设置"          'test -n "$PI_CLI_PATH"'
check "LOG_DIR 已设置"              'test -n "$LOG_DIR"'
check ".env 文件存在"               'test -f /opt/pi-agent-chat/.env'

# ── pi CLI ──
echo ""
echo "── 2. pi CLI ──"
check "pi CLI 可执行"               'test -x "$PI_CLI_PATH"'
check "pi --version 正常"           '/usr/bin/pi --version'
check "pi 可列出模型"               '/usr/bin/pi --list-models 2>&1 | grep -q deepseek'

# ── API Key ──
echo ""
echo "── 3. API Key 配置 ──"
check "auth.json 非空"              'test -s /root/.pi/agent/auth.json && grep -q api_key /root/.pi/agent/auth.json'
check "models.json 有 opencode-go"  'grep -q "opencode-go" /root/.pi/agent/models.json'
check "models.json 有 zhipuai"      'grep -q "zhipuai" /root/.pi/agent/models.json'

# ── 服务进程 ──
echo ""
echo "── 4. 服务进程 ──"
check "pm2 进程运行中"              'pm2 status pi-agent-chat 2>/dev/null | grep -q online'
check "端口 3100 监听中"            'ss -tlnp | grep -q :3100'

# ── HTTP / API ──
echo ""
echo "── 5. HTTP API ──"
check "health endpoint 返回 200"    'curl -sf http://127.0.0.1:3100/health > /dev/null'
check "index.html 可访问"           'curl -sf http://127.0.0.1:3100/ | grep -q "html"'

# ── WebSocket ──
echo ""
echo "── 6. WebSocket + RPC ──"
check "WebSocket 连接成功"          '
  node -e "
    const { WebSocket } = require(\"ws\");
    const ws = new WebSocket(\"ws://127.0.0.1:3100/ws?token=${AUTH_TOKEN}\");
    ws.on(\"open\", () => { ws.close(); process.exit(0); });
    ws.on(\"error\", () => process.exit(1));
    setTimeout(() => process.exit(1), 5000);
  " 2>/dev/null
'
check "RPC system.ping 正常"        '
  node -e "
    const { WebSocket } = require(\"ws\");
    const ws = new WebSocket(\"ws://127.0.0.1:3100/ws?token=${AUTH_TOKEN}\");
    ws.on(\"open\", () => ws.send(JSON.stringify({type:\"request\",id:\"c\",method:\"system.ping\",params:{}})));
    ws.on(\"message\", (d) => { const r=JSON.parse(d); process.exit(r.result?.pong?0:1); });
    setTimeout(() => process.exit(1), 5000);
  " 2>/dev/null
'
check "public WebSocket 通"         '
  node -e "
    const { WebSocket } = require(\"ws\");
    const ws = new WebSocket(\"wss://chat.shanbox.19930810.xyz:8443/ws?token=${AUTH_TOKEN}\");
    ws.on(\"open\", () => { ws.close(); process.exit(0); });
    ws.on(\"error\", () => process.exit(1));
    setTimeout(() => process.exit(1), 5000);
  " 2>/dev/null
'

# ── 汇总 ──
echo ""
echo "═══════════════════════════════════════════"
echo -e "   ${GREEN}✅ $PASS passed${NC}  ${RED}❌ $FAIL failed${NC}"
echo "═══════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo -e "${YELLOW}⚠ 部分检查未通过，请排查失败项${NC}"
  exit 1
else
  echo -e "${GREEN}🎉 全部通过！部署完整可用${NC}"
  exit 0
fi
