#!/bin/bash
set -euo pipefail

# ── Config ──────────────────────────────────────
SERVER="root@192.168.0.29"
SSH_PORT="2201"
REMOTE_DIR="/root/pi-chat"
# ────────────────────────────────────────────────

PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "📦 Step 1/4: Building..."
bash "${PROJECT_ROOT}/scripts/build-server.sh"

echo "📤 Step 2/4: Uploading bundles..."
scp -P ${SSH_PORT} "${PROJECT_ROOT}/dist-server/server.js" ${SERVER}:${REMOTE_DIR}/server.js
scp -P ${SSH_PORT} "${PROJECT_ROOT}/dist-server/sandbox-agent.js" ${SERVER}:${REMOTE_DIR}/dist-server/sandbox-agent.js

echo "📤 Step 3/4: Uploading frontend..."
ssh -p ${SSH_PORT} ${SERVER} "rm -rf ${REMOTE_DIR}/dist"
scp -P ${SSH_PORT} -r "${PROJECT_ROOT}/dist/" ${SERVER}:${REMOTE_DIR}/dist/

echo "🔄 Step 4/4: Installing deps & restarting..."
ssh -p ${SSH_PORT} ${SERVER} "cd ${REMOTE_DIR} && npm install --omit=dev && cd ${REMOTE_DIR} && pm2 restart pi-chat || pm2 start ecosystem.config.js"

echo "✅ Deploy complete!"
