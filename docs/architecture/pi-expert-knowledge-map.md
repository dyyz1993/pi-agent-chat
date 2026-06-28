# Pi Expert Knowledge Map

`pi-expert` is the owner role for Pi framework internals. Keep this document and the global agent file in sync whenever the framework's configuration, runtime boundaries, file/asset pipeline, preview/proxy behavior, hooks, agent definition format, or worktree development workflow changes.

Global Pi agent file:

```text
~/.pi/agent/agents/pi-expert.md
```

Current fork source for implementation details:

```text
/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/
```

Current app source:

```text
/Users/xuyingzhou/.codex/worktrees/5466/pi-agent-chat/
```

## Required Coverage

`pi-expert` must know these areas:

| Area | Source of truth | Notes |
| --- | --- | --- |
| Global Pi config | `packages/coding-agent/src/config.ts` | `PI_CODING_AGENT_DIR ?? ~/.pi/agent`; owns `settings.json`, `models.json`, `auth.json`, sessions, extensions, agents, skills. |
| App config | `src/server-config.ts`, `src/shared/lib/project-config.ts` | `.env` drives app server, proxy, sandbox, SSH runtime; `~/.pi/chat/config.json` is app-level UI state only. |
| Project shared config | `<project>/.pi/settings.json`, `<project>/.pi/agents/`, `<project>/.pi/rules/`, `<project>/.pi/skills/` | Repository-state config; write only after project trust. |
| Project-private user state | `<PI_AGENT_DIR>/projects/<PROJECT_KEY>/...` | Trust, path permissions, asset metadata, learning/memory state, local-only project caches. |
| Agent definitions | `packages/coding-agent/src/core/agent-types.ts` | Frontmatter parser, known fields, priority, `formatAgentsForPrompt`. |
| Hooks | `packages/coding-agent/extensions/pi-hooks/` | Reads Claude and Pi settings: `~/.claude/settings.json`, `<project>/.claude/settings(.local).json`, `~/.pi/agent/settings.json`, `<project>/.pi/settings.json`. |
| File and asset pipeline | `packages/coding-agent/src/core/file-resolvers.ts`, `src/core/assets.ts`, `src/core/tools/read.ts`, `src/cli/file-processor.ts` | `read` and CLI `@file` must share resolvers and truncation budgets. |
| OSS / remote assets | `ImageAssetStore` / `AssetStore` contract | No real OSS backend exists yet. Add storage backends as plugins/providers, not hardcoded read branches. |
| Vision provider routing | `docs/architecture/asset-store-and-vision-inputs.md`, xBrowser skill, MCP config | No unified switch exists yet. Target router chooses native vision, OCR, MCP, xBrowser/Doubao, or bash metadata fallback. |
| Model config | `packages/coding-agent/src/core/model-registry.ts`, `packages/ai/src/types.ts`, `models.json`, `auth.json` | Do not hardcode provider/model counts. Use source files and runtime config. |
| Preview and local proxy | `src/mainview/lib/proxy.ts`, `src/gateway/proxy-routes.ts`, `src/server-config.ts` | Preview rewrites local/LAN `http://` URLs through `/__proxy__/...` when proxy is enabled and configured. |
| Bridge / remote runtime | `docs/architecture/remote-runtime-architecture-comparison.md`, `src/sandbox/providers/ssh.ts`, `src/shared/agent/runtime-resource-env.ts` | Distinguish SSH temporary child/bridge from remote server/attach semantics. |
| Delegate / fork / subagent | `extensions/coordinator/`, `src/core/subtask.ts`, `src/mainview/components/chat/tool-renderers/CoordinatorRenderer.tsx`, `SubagentRenderer.tsx` | `session_delegate*` is persistent coordinator delegation; `subagent` is child task execution. |
| UI preview surfaces | `AGENTS.md`, `docs/ui/button-density.md`, `src/mainview/components/file-preview/`, `src/mainview/components/chat/preview/` | Chat-scoped previews stay in content surface; review/editing/full workspace flows use fullscreen workspace surfaces. |
| Worktree stack workflow | `docs/workflows/local-paired-worktree-stack.md` | Distinguish current consuming app worktree and bottom fork source worktree; use `build + yalc push`. |
| Worktree capability boundary | `docs/architecture/worktree-capability-boundary.md` | Separates runtime primitives, app state, project orchestration, plugin boundaries, and future `pi worktree` command scope. |

## Role Split Recommendation

Two Pi roles are useful:

- **Use/operation role**: knows how to configure and operate Pi projects, models, proxy, preview, agents, hooks, sessions, and common troubleshooting. It should not need deep build or fork development details.
- **Development role**: knows the bottom fork, app consumer, yalc, worktree stacks, tests, build outputs, protocol contracts, and source ownership. It must reference or inherit `pi-expert`'s knowledge map.

If these are split into separate Agent `.md` files later, the development role should depend on the use/operation knowledge, but the use/operation role does not need to include every implementation detail.

## Current Configuration Boundaries

### Pi Runtime

`PI_CODING_AGENT_DIR` controls the agent root. If unset, the root is:

```text
~/.pi/agent
```

Important files under it:

```text
settings.json     # global Pi settings
models.json       # model registry overrides
auth.json         # model credentials
sessions/         # JSONL sessions
extensions/       # global extensions
agents/           # global agent .md files
skills/           # global skills
projects/<key>/   # project-private user state
```

### App Server

`pi-agent-chat` reads `.env` through `src/server-config.ts`.

Common environment variables:

```text
PORT=3100
PI_CLI_PATH=...
PROXY_API_URL=...
PROXY_PUBLIC_DOMAIN=...
SANDBOX_PROVIDER=local|sandbox-box|ssh|cloudflare
REMOTE_* / SANDBOX_* for remote runtimes
```

`~/.pi/chat/config.json` is app-level state only: recent projects, open tabs, pinned sessions, favorites, disabled skills/plugins. Do not store project trust, path permission caches, or asset metadata there.

## Asset / OSS Policy

Current implementation:

- `ImageAssetStore` and `LocalImageAssetStore` exist in `packages/coding-agent/src/core/assets.ts`.
- Local image assets are stored under project-private state:

```text
<PI_AGENT_DIR>/projects/<PROJECT_KEY>/assets/images/
```

- `read` and CLI `@file` route file handling through `FileResolver`.
- Built-in default resolvers are text and image resolvers.
- Text files are capped before entering the model: 2000 lines or 50KB, whichever is hit first. Oversized single-line files are not injected.

OSS/UCloud/S3/R2 is not implemented yet. When adding it:

1. Add a concrete `AssetStore` backend or plugin.
2. Keep credentials in env/secret storage or `auth.json`-style private config, not in repository files.
3. Put user/project asset metadata under `<PROJECT_USER_STATE_DIR>/assets/...`.
4. Prefer signed URLs; keep local fallback so replay survives URL expiry.
5. Provider adapters remain the last mile: choose remote URL, inline base64, or fallback text based on provider/model capability.

## Vision / xBrowser / MCP Routing

Current state:

- Native model vision works only when the active model and provider adapter support image input.
- There is not yet one authoritative `vision.mode` setting in the implementation.
- xBrowser/Doubao, MCP vision, OCR, and bash-based media inspection should be modeled as providers or skills, not branches inside `read` or CLI `@file`.

Target routing order:

1. `native`: send image content directly through the model provider adapter.
2. `ocr`: run a fast OCR/text extraction pass for screenshots or scanned documents.
3. `mcp`: call a configured MCP vision tool for structured image/video understanding.
4. `xbrowser`: call an authenticated browser skill/provider such as Doubao via CDP. Use `9221` for logged-in user browser state; use `9222`, headless, or auto sessions for public pages.
5. `bash`: call explicitly configured CLI tools for metadata, OCR, conversion, thumbnails, frame extraction, or external vision services. Generic tools only provide metadata; semantic vision requires a CLI that is itself a vision service.

Bash provider rules:

- Configure commands as argv templates, not shell strings.
- Allowlist commands from global/project settings or trusted plugins.
- Use `AssetRef.localPath`, a managed temp copy, or an explicitly supported remote URL as input.
- Cap timeout and output size.
- Prefer JSON for semantic vision output and plain text for OCR/metadata.
- Keep credentials in env/private auth storage, not command arguments.

Target config belongs in Pi settings, not app UI state:

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
      server: vision
    xbrowser:
      enabled: false
      command: npx xbrowser
      cdp: http://localhost:9221
    bash:
      enabled: false
      timeoutMs: 30000
      maxOutputBytes: 20000
assets:
  store: local
  remoteUpload: auto
```

Secrets for OSS, browser services, and external vision APIs must stay in env/private auth storage. If the implementation adds this router, update `pi-expert`, this document, and `AGENTS.md` together.

## Agent Definition Format

Agent files are Markdown with YAML frontmatter plus body system prompt.

Locations:

```text
~/.pi/agent/agents/<name>.md
<project>/.pi/agents/<name>.md
```

Current known frontmatter fields are parsed in `packages/coding-agent/src/core/agent-types.ts`:

```yaml
name: pi-expert
description: One-line description for the picker
tools: read, write, edit, bash
disallowedTools: []
permissionMode: always-allow
permissionProfile: auto
model: anthropic/claude-sonnet-4-20250514
tier: max
thinkingLevel: high
effort: high
color: blue
maxTurns: 30
memory: project
background: false
hidden: false
mode: primary # primary | subagent | all
isolation: worktree # worktree | remote
skills:
  - some-skill
variables:
  key: value
paths:
  read:
    - "src/**"
  write:
    - "docs/**"
avatar: "🧭"
hooks:
  tool_call:
    - type: command
      command: "echo '{\"allow\": true}'"
      if: "toolName == 'bash'"
```

Do not use the deprecated OpenCode-style `permission: "*": allow` map for Pi agent files. Use `permissionMode` or `permissionProfile`.

### Current Project Orchestration Agents

`pi-agent-chat` currently defines project-scoped agents in `.pi/agents/`:

| Agent | Role | Key boundary |
| --- | --- | --- |
| `pi-issue-leader` | Issue orchestration lead | Splits issues, delegates to project agents, tracks Review/merge/cleanup; no direct edit/write/bash. |
| `pi-worktree-dev` | Worktree development executor | Handles one issue in an isolated worktree/paired fork stack and reports branch/tests/risks back to the leader. |

Workflow details live in `docs/workflows/project-issue-orchestration.md`.

These agents are intentionally project-scoped because they encode this repository's paired app/fork topology, port registry, yalc/build loop, and PR-style cleanup workflow. Do not move them to `~/.pi/agent/agents/` unless the project-specific paths and assumptions are extracted into variables or docs that another project can safely override. Associated fork changes target the current associated fork branch/PR-style change set by default, not upstream PRs unless explicitly requested.

Worktree capability ownership is documented in `docs/architecture/worktree-capability-boundary.md`: the current paired stack is project orchestration, not a plugin feature and not a generic `pi --worktree` runtime contract. Runtime-level worktree support should stay limited to generic primitives such as worktree-aware git identity, explicit `cwd`, and isolated `agentDir` until app ports, yalc, and paired fork assumptions are extracted.

Current policy: project orchestration agents should have complete tool permission (`permissionMode: always-allow`) and rely on workflow instructions for behavior boundaries. Do not hide capabilities via narrow tool lists when the role may need issue fetching, port diagnostics, worktree setup, build/test, yalc, or cleanup coordination. In the current Agent parser, omitting `tools` means no tool restriction and therefore all registered tools; setting `tools` creates a whitelist.

Project startup policy: new stacks use `scripts/worktree-create.sh <slug> --dev --start --with-agent-fork`; existing stacks use `scripts/worktree-dev.sh <app-worktree> --with-agent-fork --agent-path <paired-fork> --agent-build`; `--no-start` prepares env/registry only. The scripts derive worktree `.env` from the main repo `.env`, rewrite `PORT`, `PI_CLI_PATH`, `PI_CODING_AGENT_DIR`, and `PI_APP_CONFIG_DIR`, and export Vite runtime env. Default dependencies are linked; use install modes only when dependency metadata changes. yalc is required for app-imported package API/type changes, not for every CLI-only fork runtime change.

Validation policy: every issue/PR-style change set needs a validation packet before merge: automated test cases, manual acceptance cases, evidence, negative/edge cases, and residual risk. The default lifecycle is issue/local ledger -> branch/PR-style change set -> Review -> User Acceptance -> merge/close issue. Do not create a new issue after every merge by default; create follow-up issues only for known gaps, regressions, new user requests, or failed acceptance. Screenshot/browser automation may provide evidence, but user-facing acceptance remains pending unless the user accepts or explicitly waives it.

## Development Workflow

For bottom fork changes consumed by `pi-agent-chat`:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- <relevant test files>
npm run build
yalc push
```

Never edit `node_modules/@dyyz1993/pi-coding-agent/dist` or app `.yalc` output by hand. Edit fork source, build, then push with yalc.

For current app worktree:

```bash
cd /Users/xuyingzhou/.codex/worktrees/5466/pi-agent-chat
bun run dev:web
```

Check whether ports are already in use before starting another server.

## Maintenance Rule

When any of the following change, update both this document and `~/.pi/agent/agents/pi-expert.md`:

- new configuration file or environment variable,
- new asset/OSS provider,
- new model/auth/proxy setting,
- new hook event or hook config source,
- changed agent frontmatter field,
- changed delegate/subagent/fork semantics,
- changed preview/proxy route,
- changed worktree/yac/build workflow,
- changed persistence path.
