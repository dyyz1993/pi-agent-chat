#!/bin/bash
# =============================================================================
# pi-agent-chat 更新产物生成脚本
#
# 用法: bash scripts/ci-generate-update-artifacts.sh \
#   --app-path <path-to-app-bundle-or-dir> \
#   --platform <macos|linux|win> \
#   --arch <arm64|x64> \
#   --version <semver> \
#   --app-name <app-name> \
#   --channel <stable|release|canary|dev> \
#   --output-dir <output-directory>
#
# 功能:
#   1. 扫描 app bundle 内容，计算 content hash
#   2. 打补 version.json（注入 baseUrl 和 hash）
#   3. 生成 .tar.zst（供 Electrobun Updater 使用）
#   4. 生成 {platformPrefix}-update.json
#   5. 输出产物到 output-dir
# =============================================================================
set -euo pipefail

# ── 默认值 ──
APP_PATH=""
PLATFORM=""
ARCH=""
VERSION=""
APP_NAME="PiAgentChat"
CHANNEL="stable"
OUTPUT_DIR="."
BASE_URL="https://github.com/dyyz1993/pi-agent-chat/releases/latest/download"
IDENTIFIER="piagentchat.electrobun.dev"

# ── 解析参数 ──
while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-path)      APP_PATH="$2";     shift 2 ;;
    --platform)      PLATFORM="$2";     shift 2 ;;
    --arch)          ARCH="$2";         shift 2 ;;
    --version)       VERSION="$2";      shift 2 ;;
    --app-name)      APP_NAME="$2";     shift 2 ;;
    --channel)       CHANNEL="$2";      shift 2 ;;
    --output-dir)    OUTPUT_DIR="$2";   shift 2 ;;
    --base-url)      BASE_URL="$2";     shift 2 ;;
    *)               echo "Unknown arg: $1"; exit 1 ;;
  esac
done

# ── 验证 ──
if [ -z "$APP_PATH" ] || [ -z "$PLATFORM" ] || [ -z "$ARCH" ] || [ -z "$VERSION" ]; then
  echo "Usage: $0 --app-path <path> --platform <macos|linux|win> --arch <arm64|x64> --version <semver>"
  exit 1
fi

if [ ! -d "$APP_PATH" ] && [ ! -f "$APP_PATH" ]; then
  echo "Error: app-path '$APP_PATH' does not exist"
  exit 1
fi

mkdir -p "$OUTPUT_DIR"

echo "═══════════════════════════════════════════"
echo "  Generating update artifacts"
echo "  App:      $APP_PATH"
echo "  Platform: $PLATFORM/$ARCH"
echo "  Version:  $VERSION"
echo "  Channel:  $CHANNEL"
echo "═══════════════════════════════════════════"

# ── 1. 计算 content hash ──
# 对 app bundle 所有文件排序后做 SHA256，取前 16 字符
if [ "$PLATFORM" = "macos" ]; then
  # .app 是目录，对其内容做 hash
  CONTENT_HASH=$(find "$APP_PATH" -type f -exec sha256sum {} + | sort | sha256sum | cut -c1-16)
elif [ "$PLATFORM" = "linux" ] || [ "$PLATFORM" = "win" ]; then
  # 目录 bundle
  CONTENT_HASH=$(find "$APP_PATH" -type f -exec sha256sum {} + | sort | sha256sum | cut -c1-16)
else
  CONTENT_HASH="$(echo "$VERSION" | sha256sum | cut -c1-16)"
fi

echo "  Content hash: $CONTENT_HASH"

# ── 2. 定位 version.json 并打补丁 ──
if [ "$PLATFORM" = "macos" ]; then
  VERSION_JSON_PATH="$APP_PATH/Contents/Resources/version.json"
else
  VERSION_JSON_PATH="$APP_PATH/Resources/version.json"
fi

if [ -f "$VERSION_JSON_PATH" ]; then
  echo "  Patching version.json at $VERSION_JSON_PATH"
  # 用 Python3 或 node 写入 JSON（避免 shell JSON 转义问题）
  python3 -c "
import json
with open('$VERSION_JSON_PATH', 'r') as f:
    v = json.load(f)
v['version'] = '$VERSION'
v['hash'] = '$CONTENT_HASH'
v['channel'] = '$CHANNEL'
v['baseUrl'] = '$BASE_URL'
v['name'] = '$APP_NAME'
v['identifier'] = '$IDENTIFIER'
with open('$VERSION_JSON_PATH', 'w') as f:
    json.dump(v, f, separators=(',', ':'))
print('  version.json updated')
" 2>&1
  cat "$VERSION_JSON_PATH" | python3 -m json.tool 2>/dev/null || true
else
  echo "  WARNING: version.json not found at $VERSION_JSON_PATH, creating new one"
  cat > "$VERSION_JSON_PATH" << JSONEOF
{"version":"$VERSION","hash":"$CONTENT_HASH","channel":"$CHANNEL","baseUrl":"$BASE_URL","name":"$APP_NAME","identifier":"$IDENTIFIER"}
JSONEOF
fi

# ── 3. 生成 .tar.zst ──
PLATFORM_PREFIX="${CHANNEL}-${PLATFORM}-${ARCH}"

if [ "$PLATFORM" = "macos" ]; then
  # macOS: tar the .app bundle → PiAgentChat.app.tar.zst
  TARBALL_NAME="${APP_NAME}.app.tar.zst"
  echo "  Creating $TARBALL_NAME..."
  tar cf - -C "$(dirname "$APP_PATH")" "$(basename "$APP_PATH")" | zstd -o "${OUTPUT_DIR}/${PLATFORM_PREFIX}-${TARBALL_NAME}" -q
else
  # Linux/Windows: tar the directory → PiAgentChat.tar.zst
  TARBALL_NAME="${APP_NAME}.tar.zst"
  echo "  Creating $TARBALL_NAME..."
  tar cf - -C "$(dirname "$APP_PATH")" "$(basename "$APP_PATH")" | zstd -o "${OUTPUT_DIR}/${PLATFORM_PREFIX}-${TARBALL_NAME}" -q
fi

echo "  Tarball: $(ls -lh "${OUTPUT_DIR}/${PLATFORM_PREFIX}-${TARBALL_NAME}" | awk '{print $5}')"

# ── 4. 生成 update.json ──
UPDATE_JSON="${OUTPUT_DIR}/${PLATFORM_PREFIX}-update.json"
cat > "$UPDATE_JSON" << JSONEOF
{"version":"${VERSION}","hash":"${CONTENT_HASH}","updateAvailable":false,"updateReady":false,"error":""}
JSONEOF
echo "  Update metadata: $UPDATE_JSON"

# ── 5. 列出产物 ──
echo ""
echo "═══════════════════════════════════════════"
echo "  Update artifacts generated in $OUTPUT_DIR:"
ls -lh "${OUTPUT_DIR}/${PLATFORM_PREFIX}"* 2>/dev/null
echo "═══════════════════════════════════════════"
