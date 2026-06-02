#!/bin/bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST_DIR="${PROJECT_ROOT}/dist-server"

echo "🔧 Building server..."
rm -rf "${DIST_DIR}"
mkdir -p "${DIST_DIR}"

# esbuild banner: ESM __dirname polyfill
BANNER='import{fileURLToPath as _f2p}from"node:url";import{dirname as _dn}from"node:path";globalThis.__filename=_f2p(import.meta.url);globalThis.__dirname=_dn(globalThis.__filename);'

npx esbuild "${PROJECT_ROOT}/src/server.ts" \
  --bundle \
  --platform=node \
  --format=esm \
  --tree-shaking=false \
  --outfile="${DIST_DIR}/server.js" \
  --banner:js="${BANNER}" \
  --external:@modelcontextprotocol/sdk \
  --external:@dyyz1993/rpc-core \
  --external:ws

echo "🔧 Building sandbox-agent..."
npx esbuild "${PROJECT_ROOT}/src/sandbox/sandbox-agent.ts" \
  --bundle \
  --platform=node \
  --format=esm \
  --tree-shaking=false \
  --outfile="${DIST_DIR}/sandbox-agent.js"
cat "${PROJECT_ROOT}/scripts/agent-path-map.js" "${DIST_DIR}/sandbox-agent.js" > "${DIST_DIR}/sandbox-agent.tmp.js" && mv "${DIST_DIR}/sandbox-agent.tmp.js" "${DIST_DIR}/sandbox-agent.js"
sed -i '' 's/body\.path = queryPath;/body.path = __mp(queryPath);/g' "${DIST_DIR}/sandbox-agent.js"
sed -i '' 's/let filePath = decodeURIComponent(url\.pathname\.slice(5));/let filePath = __mp(decodeURIComponent(url.pathname.slice(5)));/g' "${DIST_DIR}/sandbox-agent.js"

echo "🔧 Building frontend..."
cd "${PROJECT_ROOT}" && npx vite build

echo "✅ Build complete! Output: ${DIST_DIR}/"
ls -lh "${DIST_DIR}/"
