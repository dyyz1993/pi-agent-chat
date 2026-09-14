# =============================================================================
# PiAgentChat web server image. Built and published by GitHub Actions
# (.github/workflows/docker.yml) — no local Docker required.
#
# Build stages mirror the verified release pipeline (.github/workflows/release.yml):
#   1. build        — bun install (yalc hydrated from npm) + vite frontend
#                     + esbuild server bundle (build-server.sh, node-compatible)
#   2. runtime-deps — isolated node_modules with the pi CLI + its transitive
#                     deps (same mini package.json as the release workflow)
#   3. runtime      — node:22-slim + git/ssh, state persisted under /data
# =============================================================================

# Pin the CLI runtime version here (or pass --build-arg) if you need
# reproducibility; "latest" tracks the npm release.
ARG PI_CODE_AGENT_VERSION=latest

# ── Stage 1: build frontend + server bundle ─────────────────────────────────
FROM node:22-bookworm-slim AS build
# bun is only needed for `bun install` against bun.lock; everything else is node.
COPY --from=oven/bun:1 /usr/local/bin/bun /usr/local/bin/bun
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app

# Install dependencies first (layer-cached). .yalc/ is excluded by
# .dockerignore, so the hydrate script materializes the npm fallback packages
# that package.json's "file:.yalc/..." entries point at.
COPY package.json bun.lock ./
COPY scripts/ci-hydrate-yalc.mjs scripts/ci-hydrate-yalc.mjs
RUN node scripts/ci-hydrate-yalc.mjs && bun install

COPY . .
RUN bun run build && bash scripts/build-server.sh

# ── Stage 2: CLI runtime deps (platform-independent pure JS) ────────────────
# Must use bun, not npm: pi-coding-agent's declared @dyyz1993/pi-tui range can
# resolve to an npm version that was never published; bun falls back to the
# latest published one (same workaround as .github/workflows/release.yml).
FROM oven/bun:1 AS runtime-deps
ARG PI_CODE_AGENT_VERSION
WORKDIR /deps
RUN cat > package.json <<EOF
{
  "name": "pi-chat-web-deps",
  "private": true,
  "dependencies": {
    "@dyyz1993/pi-coding-agent": "${PI_CODE_AGENT_VERSION}",
    "@dyyz1993/rpc-core": "^2.2.0",
    "ws": "^8.18.0",
    "strip-ansi": "^7.0.0"
  }
}
EOF
RUN bun install

# ── Stage 3: runtime ─────────────────────────────────────────────────────────
FROM node:22-bookworm-slim
# git: agent workflows; openssh-client: SSH remote projects.
RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  # Bind-mounted repos may be owned by a different UID than the container user.
  && git config --system --add safe.directory '*' \
  && git config --system init.defaultBranch main

WORKDIR /app
COPY --from=build /app/dist-server/server.js ./server.js
COPY --from=build /app/dist-server/sandbox-agent.js ./sandbox-agent.js
COPY --from=build /app/dist ./dist
COPY --from=runtime-deps /deps/node_modules ./node_modules

# /data            — all persistent state (agent dir, app config, logs)
# /workspace       — user projects opened in sessions
RUN mkdir -p /data/agent /data/chat /data/logs /workspace
VOLUME ["/data", "/workspace"]

ENV NODE_ENV=production \
    PORT=3100 \
    PI_CLI_PATH=/app/node_modules/@dyyz1993/pi-coding-agent/dist/cli.js \
    PI_CODING_AGENT_DIR=/data/agent \
    PI_APP_CONFIG_DIR=/data/chat \
    LOG_DIR=/data/logs \
    HOME=/data/agent

EXPOSE 3100
CMD ["node", "server.js"]
