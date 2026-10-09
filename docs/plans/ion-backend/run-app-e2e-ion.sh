#!/usr/bin/env bash
# run-app-e2e-ion.sh —— app 级 E2E 一键 runner
#
# 拉起完全隔离的栈：ion host（faux）+ app server（PI_BACKEND=ion，独立端口 3199，
# 独立 PI_APP_CONFIG_DIR / PI_CODING_AGENT_DIR / LOG_DIR），跑 e2e-app-ion.mjs，
# 结束只清理自己启动的 PID。
#
# 用法：bash docs/plans/ion-backend/run-app-e2e-ion.sh

set -uo pipefail

REAL_ION="${ION_BIN:-$HOME/Project/study-rust/ion/target/debug/ion}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
TEST_DIR="$(mktemp -d /tmp/ion-app-e2e-XXXXXX)"
PORT="${E2E_PORT:-3197}"
TOKEN="ion-e2e-token"

export HOME_SAVED="$HOME"
mkdir -p "$TEST_DIR/home/.ion" "$TEST_DIR/proj" "$TEST_DIR/appconfig" "$TEST_DIR/agentdir" "$TEST_DIR/logs"
# 启用 file-snapshot（连带 file-approval），channel 面（change-review.*）才能走通
printf '{"default_model":"faux-test","default_provider":"faux","tier_models":{"fast":"faux/faux-test","pro":"faux/faux-test","max":"faux/faux-test"},"extensions":{"file-snapshot":{"enabled":true},"global-memory":{"enabled":false}}}' > "$TEST_DIR/home/.ion/config.json"
printf '# e2e\n' > "$TEST_DIR/proj/README.md"

# ── 1. 隔离 ion host（faux，零 token）──
ION_HOST_SOCKET="$TEST_DIR/host.sock" \
ION_SESSION_DIR="$TEST_DIR/ion-sessions" \
ION_FAUX_REPLY="ion app e2e faux reply" \
ION_FAUX_REPEAT=1 \
HOME="$TEST_DIR/home" \
  "$REAL_ION" serve > "$TEST_DIR/ion-host.log" 2>&1 &
HOST_PID=$!

cleanup() {
    [ -n "${SERVER_PID:-}" ] && kill "$SERVER_PID" 2>/dev/null
    [ -n "${HOST_PID:-}" ] && kill "$HOST_PID" 2>/dev/null
    sleep 1
    if [ "${KEEP:-0}" = "1" ]; then
        echo "KEEP=1 → 现场保留: $TEST_DIR"
    else
        rm -rf "$TEST_DIR"
    fi
}
trap cleanup EXIT

HOST_READY=0
for _ in $(seq 1 20); do
    sleep 1
    if ION_HOST_SOCKET="$TEST_DIR/host.sock" HOME="$TEST_DIR/home" "$REAL_ION" rpc --method list_sessions 2>/dev/null | grep -q sessions; then
        HOST_READY=1; break
    fi
done
[ "$HOST_READY" = 1 ] || { echo "ion host not ready"; tail -5 "$TEST_DIR/ion-host.log"; exit 1; }
echo "=== ion host ready (sock=$TEST_DIR/host.sock) ==="

# ── 2. app server（PI_BACKEND=ion，全隔离状态目录）──
PORT="$PORT" \
AUTH_TOKEN="$TOKEN" \
PI_BACKEND=ion \
PI_WARM_POOL=off \
ION_HOST_SOCKET="$TEST_DIR/host.sock" \
ION_AUTO_SPAWN=off \
PI_APP_CONFIG_DIR="$TEST_DIR/appconfig" \
PI_CODING_AGENT_DIR="$TEST_DIR/agentdir" \
LOG_DIR="$TEST_DIR/logs" \
  bun "$REPO/src/server.ts" > "$TEST_DIR/server.log" 2>&1 &
SERVER_PID=$!

SERVER_READY=0
for _ in $(seq 1 30); do
    sleep 1
    if grep -q "listening\|server started\|WebSocket" "$TEST_DIR/server.log" 2>/dev/null || nc -z 127.0.0.1 "$PORT" 2>/dev/null; then
        SERVER_READY=1; break
    fi
done
if [ "$SERVER_READY" != 1 ]; then
    echo "server not ready; log tail:"
    tail -20 "$TEST_DIR/server.log"
    exit 1
fi
echo "=== app server ready (port $PORT, PI_BACKEND=ion) ==="

# ── 3. E2E ──
E2E_WS_URL="ws://127.0.0.1:$PORT/ws?token=$TOKEN" \
E2E_CWD="$TEST_DIR/proj" \
  node "$REPO/docs/plans/ion-backend/e2e-app-ion.mjs"
RC=$?

echo "=== server.log tail (for debugging) ==="
tail -10 "$TEST_DIR/server.log"
exit $RC
