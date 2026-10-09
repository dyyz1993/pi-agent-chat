#!/usr/bin/env bash
# try-ion-local.sh —— ion 后端本地体验栈（一键启动/停止）
#
# 独立栈：私有 ion host（复用真实 ~/.ion 的模型/密钥配置，但不碰正式 host 与
# 正式 session）、app server（3199，PI_BACKEND=ion）、Vite（5175）。
# 状态目录固定在 ~/.pi/ion-trial/，跨次启动保留体验会话。
#
# 用法：
#   bash docs/plans/ion-backend/try-ion-local.sh start   # 启动并打开浏览器
#   bash docs/plans/ion-backend/try-ion-local.sh stop    # 停止（只杀本栈 PID）
#   bash docs/plans/ion-backend/try-ion-local.sh status  # 查看运行状态

set -uo pipefail

REAL_ION="${ION_BIN:-$HOME/Project/study-rust/ion/target/debug/ion}"
REPO="$(cd "$(dirname "$0")/../../.." && pwd)"
TRIAL_DIR="$HOME/.pi/ion-trial"
APP_PORT=3199
VITE_PORT=5175
TOKEN="ion-trial"
PID_FILE="$TRIAL_DIR/pids"

mkdir -p "$TRIAL_DIR/home/.ion" "$TRIAL_DIR/appconfig" "$TRIAL_DIR/agentdir" "$TRIAL_DIR/ion-sessions" "$TRIAL_DIR/logs"

is_alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }

stop_stack() {
    for f in "$TRIAL_DIR/pid-vite" "$TRIAL_DIR/pid-server" "$TRIAL_DIR/pid-host"; do
        if is_alive "$f"; then
            kill "$(cat "$f")" 2>/dev/null
            echo "stopped $(basename "$f" | sed 's/pid-//') (pid $(cat "$f"))"
        fi
        rm -f "$f"
    done
    rm -f "$PID_FILE" "$TRIAL_DIR/host.sock"
}

case "${1:-start}" in
stop)
    stop_stack
    exit 0
    ;;
status)
    for name in host server vite; do
        if is_alive "$TRIAL_DIR/pid-$name"; then
            echo "$name: running (pid $(cat "$TRIAL_DIR/pid-$name"))"
        else
            echo "$name: stopped"
        fi
    done
    exit 0
    ;;
esac

# ── 幂等：已在跑就不重复起 ──
if is_alive "$TRIAL_DIR/pid-host" && is_alive "$TRIAL_DIR/pid-server" && is_alive "$TRIAL_DIR/pid-vite"; then
    echo "体验栈已在运行：http://localhost:$VITE_PORT/?token=$TOKEN"
    open "http://localhost:$VITE_PORT/?token=$TOKEN"
    exit 0
fi
stop_stack >/dev/null 2>&1

# ── 1. ion host（私有 socket；复制真实密钥/模型配置，绝不读写正式 ~/.ion）──
if [ -f "$HOME/.ion/auth.json" ]; then cp "$HOME/.ion/auth.json" "$TRIAL_DIR/home/.ion/auth.json"; fi
if [ -f "$HOME/.ion/config.json" ]; then
    jq '. + {extensions:{"file-snapshot":{"enabled":true}}}' "$HOME/.ion/config.json" > "$TRIAL_DIR/home/.ion/config.json"
fi

ION_HOST_SOCKET="$TRIAL_DIR/host.sock" \
ION_SESSION_DIR="$TRIAL_DIR/ion-sessions" \
HOME="$TRIAL_DIR/home" \
    "$REAL_ION" serve > "$TRIAL_DIR/logs/ion-host.log" 2>&1 &
echo $! > "$TRIAL_DIR/pid-host"
for _ in $(seq 1 20); do
    sleep 1
    if ION_HOST_SOCKET="$TRIAL_DIR/host.sock" HOME="$TRIAL_DIR/home" "$REAL_ION" rpc --method list_sessions 2>/dev/null | grep -q sessions; then
        echo "✓ ion host 就绪（$TRIAL_DIR/host.sock，模型走你真实配置）"
        break
    fi
done
is_alive "$TRIAL_DIR/pid-host" || { echo "✗ ion host 启动失败，看 $TRIAL_DIR/logs/ion-host.log"; exit 1; }

# ── 2. app server ──
PORT=$APP_PORT \
AUTH_TOKEN=$TOKEN \
PI_BACKEND=ion \
ION_HOST_SOCKET="$TRIAL_DIR/host.sock" \
ION_AUTO_SPAWN=off \
PI_APP_CONFIG_DIR="$TRIAL_DIR/appconfig" \
PI_CODING_AGENT_DIR="$TRIAL_DIR/agentdir" \
LOG_DIR="$TRIAL_DIR/logs" \
    bun "$REPO/src/server.ts" > "$TRIAL_DIR/logs/server.log" 2>&1 &
echo $! > "$TRIAL_DIR/pid-server"
for _ in $(seq 1 20); do
    sleep 1
    if curl -sf "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1 || nc -z 127.0.0.1 "$APP_PORT" 2>/dev/null; then
        echo "✓ app server 就绪（:${APP_PORT}，PI_BACKEND=ion）"
        break
    fi
done
is_alive "$TRIAL_DIR/pid-server" || { echo "✗ server 启动失败，看 $TRIAL_DIR/logs/server.log"; exit 1; }

# ── 3. Vite ──
# exec：让子壳直接成为 vite 进程，$! 即 vite 本体 pid（否则 stop 只能杀到包装壳）
(cd "$REPO" && exec env VITE_PORT=$VITE_PORT VITE_API_TARGET="http://127.0.0.1:$APP_PORT" \
    bunx --bun vite > "$TRIAL_DIR/logs/vite.log" 2>&1) &
echo $! > "$TRIAL_DIR/pid-vite"
for _ in $(seq 1 60); do
    sleep 1
    if curl -sf "http://127.0.0.1:$VITE_PORT/" >/dev/null 2>&1; then
        echo "✓ 前端就绪（:${VITE_PORT}）"
        break
    fi
done
is_alive "$TRIAL_DIR/pid-vite" || { echo "✗ vite 启动失败，看 $TRIAL_DIR/logs/vite.log"; exit 1; }

cat "$TRIAL_DIR/pid-host" "$TRIAL_DIR/pid-server" "$TRIAL_DIR/pid-vite" > "$PID_FILE"
URL="http://localhost:$VITE_PORT/?token=$TOKEN"
echo ""
echo "══════════════════════════════════════════════════"
echo " ion 体验栈已启动：$URL"
echo " 停止：bash docs/plans/ion-backend/try-ion-local.sh stop"
echo " 日志：$TRIAL_DIR/logs/（host/server/vite 各一份）"
echo " 说明：真模型（走你 ~/.ion 的密钥与模型配置，正常计费）；"
echo "       与正式 5173/3100（pi 后端）和正式 ~/.ion 互不影响。"
echo "══════════════════════════════════════════════════"
open "$URL"
