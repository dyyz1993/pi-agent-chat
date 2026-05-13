#!/usr/bin/env bash
#
# Android Debug Toolbox
# 用法: ./scripts/debug-android.sh <command> [args]
#
# 命令:
#   status          - 检查设备连接 + 服务状态
#   logcat          - 实时查看 App 日志 (过滤 deep-link/notify/push 等)
#   deeplink <url>  - 发送 Deep Link (支持简写)
#   server          - 发送服务器连接深链
#   project [path]  - 打开项目
#   session <id>    - 打开指定会话
#   notify <title> <body> - 模拟推送通知
#   install         - 重新构建并安装 APK
#   restart         - 重启 App
#   stop            - 强制停止 App

set -euo pipefail

DEVICE="192.168.0.28:5555"
PACKAGE="com.piagent.chat"
SERVER_HOST="192.168.0.4"
SERVER_PORT="3100"
TOKEN="demo-test-token"

adb_exec() { adb -s "$DEVICE" "$@" 2>&1; }
app_pid() { adb_exec shell pidof "$PACKAGE" 2>/dev/null | tr -d '\r'; }

cmd_status() {
  echo "=== 设备状态 ==="
  adb_exec devices -l | grep "$DEVICE" || echo "❌ 设备未连接"
  echo ""
  echo "=== App 状态 ==="
  local pid=$(app_pid)
  if [ -n "$pid" ]; then
    echo "✅ App 运行中 (PID: $pid)"
  else
    echo "❌ App 未运行"
  fi
  echo ""
  echo "=== 后端服务 ==="
  curl -s "http://localhost:$SERVER_PORT/health" 2>/dev/null && echo "" || echo "❌ 后端未运行"
}

cmd_logcat() {
  local pid=$(app_pid)
  if [ -z "$pid" ]; then
    echo "App 未运行，先启动..."
    adb_exec shell am start -n "$PACKAGE/.MainActivity"
    sleep 3
    pid=$(app_pid)
  fi
  echo "=== 实时日志 (PID: $pid) ==="
  adb_exec logcat --pid="$pid" | grep -E "Capacitor/Console|Capacitor/AppPlugin|deep-link|notify|push|Error|FATAL" --line-buffered
}

cmd_deeplink() {
  local url="${1:?用法: deeplink <url>}"
  echo "发送 Deep Link: $url"
  adb_exec shell am start -a android.intent.action.VIEW -d "$url"
}

cmd_server() {
  local host="${1:-$SERVER_HOST}"
  local port="${2:-$SERVER_PORT}"
  local token="${3:-$TOKEN}"
  echo "连接服务器: $host:$port"
  cmd_deeplink "piagentchat://server/${host}:${port}?token=${token}"
}

cmd_project() {
  local project="${1:-/Users/xuyingzhou/Project/temporary/pi-agent-chat}"
  echo "打开项目: $project"
  cmd_deeplink "piagentchat://project/$(urlencode "$project")"
}

cmd_session() {
  local session_id="${1:?用法: session <session-id>}"
  local project="${2:-/Users/xuyingzhou/Project/temporary/pi-agent-chat}"
  echo "打开会话: $session_id (项目: $project)"
  cmd_deeplink "piagentchat://project/$(urlencode "$project")/session/${session_id}"
}

cmd_notify() {
  local title="${1:-🔔 Pi Agent Chat}"
  local body="${2:-这是一条测试推送通知}"
  local notif_id="${3:-$((RANDOM % 100000))}"
  echo "发送通知: $title - $body (id: $notif_id)"

  local pid=$(app_pid)
  if [ -z "$pid" ]; then
    echo "❌ App 未运行"
    return 1
  fi

  adb_exec forward tcp:9223 "localabstract:webview_devtools_remote_${pid}" 2>/dev/null
  sleep 1

  local ws_url=$(curl -s http://localhost:9223/json 2>/dev/null | python3 -c "
import sys,json
data=json.load(sys.stdin)
for t in data:
  if t.get('type')=='page':
    print(t.get('webSocketDebuggerUrl',''))
    break
" 2>/dev/null)

  if [ -z "$ws_url" ]; then
    echo "❌ 无法连接 WebView DevTools"
    return 1
  fi

  node -e "
const WebSocket = require('ws');
const ws = new WebSocket('${ws_url}');
ws.on('open', () => {
  ws.send(JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: {
      expression: \`(async () => {
        const LN = window.Capacitor.Plugins.LocalNotifications;
        const perm = await LN.requestPermissions();
        if (perm.display !== 'granted') return 'Permission denied: ' + JSON.stringify(perm);
        await LN.schedule({
          notifications: [{
            title: '${title}',
            body: '${body}',
            id: ${notif_id},
            extra: { type: 'test' }
          }]
        });
        return 'Notification sent!';
      })()\`,
      awaitPromise: true,
      returnByValue: true
    }
  }));
});
ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log(msg.result?.result?.value || JSON.stringify(msg));
  ws.close();
});
setTimeout(() => process.exit(0), 5000);
" 2>&1
}

cmd_install() {
  echo "=== 构建 + 安装 ==="
  cd "$(git rev-parse --show-toplevel)"
  unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY
  NO_PROXY=localhost,127.0.0.1 bun run build
  npx cap sync android
  export JAVA_HOME=/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
  export ANDROID_HOME=$HOME/Library/Android/sdk
  export http_proxy=http://127.0.0.1:7890
  export https_proxy=http://127.0.0.1:7890
  cd android && ./gradlew assembleDebug --no-daemon
  adb_exec install -r app/build/outputs/apk/debug/app-debug.apk
  echo "✅ 安装完成"
}

cmd_restart() {
  echo "重启 App..."
  adb_exec shell am force-stop "$PACKAGE"
  sleep 1
  adb_exec shell am start -n "$PACKAGE/.MainActivity"
}

cmd_stop() {
  echo "停止 App..."
  adb_exec shell am force-stop "$PACKAGE"
}

urlencode() {
  local string="$1"
  echo "$string" | sed 's/\//%2F/g' | sed 's/:/%3A/g'
}

case "${1:-help}" in
  status)   cmd_status ;;
  logcat)   cmd_logcat ;;
  deeplink) cmd_deeplink "${2:-}" ;;
  server)   cmd_server "${2:-}" "${3:-}" "${4:-}" ;;
  project)  cmd_project "${2:-}" ;;
  session)  cmd_session "${2:-}" "${3:-}" ;;
  notify)   cmd_notify "${2:-}" "${3:-}" ;;
  install)  cmd_install ;;
  restart)  cmd_restart ;;
  stop)     cmd_stop ;;
  *)
    echo "Pi Agent Chat - Android Debug Toolbox"
    echo ""
    echo "用法: $0 <command> [args]"
    echo ""
    echo "命令:"
    echo "  status              检查设备 + App + 后端状态"
    echo "  logcat              实时查看 App 日志"
    echo "  deeplink <url>      发送 Deep Link"
    echo "  server [host] [port] [token]  连接服务器"
    echo "  project [path]      打开项目"
    echo "  session <id> [path] 打开会话"
    echo "  notify [title] [body]  模拟推送通知"
    echo "  install             重新构建并安装 APK"
    echo "  restart             重启 App"
    echo "  stop                强制停止 App"
    ;;
esac
