#!/bin/bash
# ADB 自动化配置脚本
# 用法：./scripts/adb-autoconfig.sh <server_ip> [port] [token]

set -e

# 默认值
SERVER_IP=$1
PORT=${2:-3100}
TOKEN=${3:-demo-test-token}

# 设备 ID（支持多设备）
DEVICE_ID=${4:-}

echo "=== ADB 自动配置 Pi Agent Chat ==="
echo "服务器: $SERVER_IP:$PORT"
echo "Token: $TOKEN"

# Deep Link URL
DEEP_LINK="piagentchat://server/${SERVER_IP}:${PORT}?token=${TOKEN}"
echo "Deep Link: $DEEP_LINK"

# 通过 ADB 发送 Deep Link
if [ -n "$DEVICE_ID" ]; then
  echo "发送到设备: $DEVICE_ID"
  adb -s "$DEVICE_ID" shell am start -a "$DEEP_LINK"
else
  echo "发送到默认设备"
  adb shell am start -a "$DEEP_LINK"
fi

# 等待 App 启动
sleep 2

# 检查 App 是否在前台
adb shell dumpsys activity top | grep "com.piagent.chat" | head -3

echo ""
echo "=== 配置完成 ==="
echo "请在平板上检查 App 是否已连接到服务器：$SERVER_IP:$PORT"
