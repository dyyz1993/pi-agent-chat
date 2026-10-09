#!/usr/bin/env bash
# run-browser-e2e-ion.sh —— 浏览器级 E2E 一键 runner
#
# 拉起完全隔离栈：ion host（faux）+ app server（PI_BACKEND=ion，3198）+
# Vite dev（5175，代理 3198）+ 预种子项目配置，跑 browser-e2e-ion.mjs。
# 绝不占用/复用现有 3100/5173 dev 栈与正式 ~/.ion。
#
# 用法：bash docs/plans/ion-backend/run-browser-e2e-ion.sh

set -uo pipefail

REAL_ION="${ION_BIN:-$HOME/Project/study-rust/ion/target/debug/ion}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
TEST_DIR="$(mktemp -d /tmp/ion-browser-e2e-XXXXXX)"
APP_PORT="${E2E_APP_PORT:-3198}"
VITE_PORT="${E2E_VITE_PORT:-5175}"
TOKEN="ion-e2e-token"
PROJ="$TEST_DIR/proj"
mkdir -p "$TEST_DIR/home/.ion" "$PROJ" "$TEST_DIR/appconfig" "$TEST_DIR/agentdir" "$TEST_DIR/logs" "${BROWSER_E2E_SHOTS:-/tmp/ion-browser-e2e}"
# 启用 file-snapshot（连带 file-approval）：壳模式能力发现才会把审核面板判为可用
printf '{"extensions":{"file-snapshot":{"enabled":true}}}' > "$TEST_DIR/home/.ion/config.json"
printf '# browser e2e\n' > "$PROJ/README.md"

# 预种子 app 配置：activeProject 指向临时项目，跳过项目选择器
PROJ_NAME="$(basename "$PROJ")"
cat > "$TEST_DIR/appconfig/config.json" <<EOF
{
  "recentProjects": [
    { "path": "$PROJ", "name": "$PROJ_NAME", "lastOpened": $(date +%s000), "pinned": false, "sessionCount": 0 }
  ],
  "activeProject": "$PROJ",
  "openTabs": [],
  "activeTabId": null,
  "pinnedSessionIds": [],
  "favoriteFolders": [],
  "disabledSkills": [],
  "disabledPlugins": {},
  "agentFavorites": [],
  "modelFavorites": []
}
EOF

SERVER_PID=""
VITE_PID=""
HOST_PID=""
cleanup() {
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
    [ -n "$VITE_PID" ] && kill "$VITE_PID" 2>/dev/null
    [ -n "$HOST_PID" ] && kill "$HOST_PID" 2>/dev/null
    sleep 1
    if [ "${KEEP:-0}" = "1" ]; then
        echo "KEEP=1 → 现场保留: $TEST_DIR"
    else
        rm -rf "$TEST_DIR"
    fi
}
trap cleanup EXIT

# ── 1. 隔离 ion host ──
ION_HOST_SOCKET="$TEST_DIR/host.sock" \
ION_SESSION_DIR="$TEST_DIR/ion-sessions" \
ION_FAUX_REPLY="ion browser faux reply for ui validation" \
HOME="$TEST_DIR/home" \
  "$REAL_ION" serve > "$TEST_DIR/ion-host.log" 2>&1 &
HOST_PID=$!
for _ in $(seq 1 20); do
    sleep 1
    if ION_HOST_SOCKET="$TEST_DIR/host.sock" HOME="$TEST_DIR/home" "$REAL_ION" rpc --method list_sessions 2>/dev/null | grep -q sessions; then
        echo "=== ion host ready ==="; break
    fi
done

# ── 2. app server ──
PORT="$APP_PORT" \
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
for _ in $(seq 1 30); do
    sleep 1
    if curl -sf "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1 || nc -z 127.0.0.1 "$APP_PORT" 2>/dev/null; then
        echo "=== app server ready ($APP_PORT) ==="; break
    fi
done

# ── 3. Vite dev ──
(cd "$REPO" && VITE_PORT="$VITE_PORT" VITE_API_TARGET="http://127.0.0.1:$APP_PORT" \
  bunx --bun vite > "$TEST_DIR/vite.log" 2>&1) &
VITE_PID=$!
for _ in $(seq 1 60); do
    sleep 1
    if curl -sf "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1; then
        echo "=== vite ready ($VITE_PORT) ==="; break
    fi
done
if ! curl -sf "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1; then
    echo "vite not ready; log tail:"; tail -15 "$TEST_DIR/vite.log"; exit 1
fi

# ── 4. 浏览器 E2E ──
BROWSER_E2E_URL="http://127.0.0.1:$VITE_PORT/?token=$TOKEN" \
BROWSER_E2E_FAUX="ion browser faux" \
  node "$REPO/docs/plans/ion-backend/browser-e2e-ion.mjs"
RC=$?

echo "=== server.log tail ==="
tail -8 "$TEST_DIR/server.log"
exit $RC
