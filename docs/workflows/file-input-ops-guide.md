# File Input Ops Guide

Use this guide when working on `read`, CLI `@file`, image input, large text input, or future vision-provider routing in `pi-agent-chat` and the paired `pi-coding-agent` fork.

Related docs:

- `docs/architecture/asset-store-and-vision-inputs.md`
- `docs/workflows/local-paired-worktree-stack.md`
- `AGENTS.md`

## What Already Works

Current implemented behavior:

- `read` and CLI `@file` share the same `FileResolver` pipeline.
- Default resolvers currently cover text and image files.
- Large text files are budgeted before entering the model.
- Current shared budget is:

```text
2000 lines or 50KB
```

- Oversized single-line files are not injected directly into the model.
- Image reads can create local asset metadata under the project-private agent dir.
- The current local stack can run independently with:

```text
API:  3102
Vite: 5175
```

## What Is Not Finished Yet

The file-input architecture is partially implemented, not fully productized yet.

Still missing:

1. A real settings schema for `vision.mode`, `vision.providers.*`, and `assets.store`.
2. A Settings UI for editing those values.
3. A concrete OSS/S3/UCloud/R2 `AssetStore` backend.
4. Real provider runners for `mcp`, `xbrowser`, and `bash` vision paths.
5. UI states that clearly show which path handled a file:

```text
native model vision
OCR
MCP tool
xBrowser / Doubao
Bash CLI provider
metadata-only fallback
```

## Current Source Of Truth

App worktree:

```text
/Users/xuyingzhou/Project/temporary/pi-agent-chat
```

Paired fork:

```text
/Users/xuyingzhou/Project/temporary/pi-momo-fork
```

Important implementation files:

```text
packages/coding-agent/src/core/file-resolvers.ts
packages/coding-agent/src/core/assets.ts
packages/coding-agent/src/core/tools/read.ts
packages/coding-agent/src/cli/file-processor.ts
```

## How To Start The Stack

From the app worktree:

```bash
./scripts/worktree-dev.sh /Users/xuyingzhou/Project/temporary/pi-agent-chat \
  --with-agent-fork \
  --agent-path /Users/xuyingzhou/Project/temporary/pi-momo-fork
```

Then verify:

```bash
./scripts/worktree-dev.sh list
curl http://localhost:3102/health
curl http://localhost:5175/health
```

Expected pairing:

```text
API_PORT=3102
VITE_PORT=5175
PI_CLI_PATH=/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/cli.js
```

## Where Runtime State Lives

App UI state for this worktree:

```text
~/.pi/chat/worktrees/pi-agent-chat-8fd216f23c71/config.json
```

Agent runtime state for this worktree:

```text
~/.pi/chat/worktrees/pi-agent-chat-8fd216f23c71/agent
```

That agent dir is used as:

```text
PI_CODING_AGENT_DIR
```

## How File Input Works Today

Text files:

- go through the text resolver
- obey the shared truncation budget
- require offset/search/parser style follow-up for oversized content

Image files:

- go through the image resolver
- may produce image content plus local asset metadata
- currently rely on local fallback asset storage

Important boundary:

```text
@file is only an entry syntax
```

It should not become a place where every file type grows its own custom branch.

## How To Change The Bottom Behavior

If you edit the paired fork:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm run build
```

Then restart the app stack:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-agent-chat
./scripts/worktree-dev.sh /Users/xuyingzhou/Project/temporary/pi-agent-chat \
  --with-agent-fork \
  --agent-path /Users/xuyingzhou/Project/temporary/pi-momo-fork
```

Do not edit:

```text
node_modules/@dyyz1993/pi-coding-agent/dist
```

## Where Future Config Should Go

Target global config:

```text
~/.pi/agent/settings.json
```

Target project config:

```text
<project>/.pi/settings.json
```

But this is target shape, not fully wired behavior yet.

For the planned vision router, the settings should eventually cover:

```yaml
vision:
  mode: auto
  providers:
    native:
      enabled: true
    ocr:
      enabled: true
    mcp:
      enabled: false
    xbrowser:
      enabled: false
    bash:
      enabled: false
assets:
  store: local
  remoteUpload: auto
```

## Recommended Next Steps

If the goal is "usable now":

1. Keep using the local `FileResolver` + local `AssetStore` flow.
2. Add one provider path first, preferably `bash` or `xbrowser`, behind a simple config key.
3. Add explicit UI status showing which provider handled the file.

If the goal is "complete product flow":

1. Add `vision` and `assets` config to settings manager.
2. Add Settings UI for those values.
3. Implement one real remote asset backend.
4. Implement provider execution contract and UI result states.
