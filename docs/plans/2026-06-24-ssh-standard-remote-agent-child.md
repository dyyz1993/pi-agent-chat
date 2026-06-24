# SSH Standard Remote Agent Child Implementation Plan

> **For future agents:** Read this file completely before implementation. Also read `AGENTS.md`, `docs/architecture/remote-runtime-architecture-comparison.md`, and `docs/workflows/ssh-remote-runtime.md` before editing code.

**Goal:** Make `remote-agent-child` the standard SSH runtime for real remote projects, while keeping `ssh-command` / tool-proxy behavior as an explicit quick sandbox fallback. Standard SSH must run a complete pi CLI runtime on the remote host, load remote-owned skills, memory, agents, plugins, project config, hooks, and sessions, and use local auth only through a scoped proxy/tunnel. Quick sandbox mode must not expose local long-lived resources or local filesystem paths to the remote task.

**Architecture:** Runtime ownership decides resource ownership. If the runtime is local, local resources are visible. If the runtime is remote, remote resources are visible. If the runtime is quick sandbox/tool-proxy, long-lived resources are unavailable unless explicitly synced or installed through a separate user-visible flow. Do not make every plugin implement its own SSH special case.

**Tech Stack:** React 18, TypeScript, Vite, Zustand, pi-coding-agent RPC mode, SSH stdio JSONL, extension channels, AgentSession/RpcClient tests, `tools/verify-remote-child-runtime.ts`, Playwright or xbrowser UI verification.

---

## Execution Goal

Copy this goal into a future coding-agent turn:

```text
Implement the SSH standard remote-agent-child runtime described in docs/plans/2026-06-24-ssh-standard-remote-agent-child.md. Follow the required test order in that document: fork/harness tests first, app integration tests second, RPC JSON/remote-child verifier third, and UI screenshot verification last. Do not ship scattered plugin-level SSH patches; centralize runtime resource ownership and prove that standard SSH loads remote resources while quick sandbox mode does not expose local resources.
```

## Product Decision

Pi keeps multiple remote shapes, but they must be visibly different:

| Mode                                | User meaning                         | Runtime owner             | Resource owner                     | Default use                                 |
| ----------------------------------- | ------------------------------------ | ------------------------- | ---------------------------------- | ------------------------------------------- |
| `local`                             | Normal local project                 | Local                     | Local                              | Local development                           |
| `ssh-command` / quick sandbox       | Zero-install remote command fallback | Local agent, remote tools | No long-lived resources by default | Fast smoke, fallback, constrained execution |
| `remote-agent-child` / standard SSH | Claude-style temporary remote child  | Remote pi CLI child       | Remote                             | Default personal SSH project work           |
| `remote-server`                     | Remote standalone service / attach   | Remote server             | Remote                             | Later advanced/team/server mode             |

The standard SSH mode is the mode that should support remote skills, memory, agents, plugins, hooks, sessions, and project `.pi` config.

The quick sandbox mode is intentionally limited. It may execute remote commands and read/write remote project files through controlled tool forwarding, but it must not leak local `~/.pi/agent`, local `~/.codex`, local skill paths, local memory paths, local plugin paths, or local project-shadow paths into the agent prompt, tool registry, UI, or generated files.

## Non-Goals

- Do not silently sync local skills, memories, rules, sessions, MCP config, model files, or plugins to the remote host.
- Do not make local resource sync a hidden dependency of SSH.
- Do not make standalone `remote-server` the default personal SSH implementation.
- Do not keep adding per-extension `if SSH then ...` behavior once a central runtime policy exists.
- Do not store remote project trust, permissions, or memory in `~/.pi-agent-chat/config.json`; that remains an app-level index.

## Required Architecture

### 1. Central Runtime Context

Create or consolidate a central runtime context that can be queried by app code and fork runtime code.

Minimum fields:

```ts
type RuntimeKind = "local" | "ssh-command" | "remote-agent-child" | "remote-server";

interface RuntimeContext {
  kind: RuntimeKind;
  projectRoot: string;
  displayProjectRoot: string;
  remote?: {
    host: string;
    cwd: string;
    runtimeDir?: string;
    agentDir?: string;
  };
}
```

Minimum resource policy:

```ts
interface RuntimeResourcePolicy {
  canLoadUserSkills: boolean;
  canLoadProjectSkills: boolean;
  canLoadUserAgents: boolean;
  canLoadProjectAgents: boolean;
  canLoadUserMemory: boolean;
  canLoadProjectMemory: boolean;
  canLoadPlugins: boolean;
  canLoadHooks: boolean;
  promptMayMentionLocalPaths: boolean;
}
```

Expected policy:

| Runtime kind         | Load long-lived resources | Prompt may mention local paths        |
| -------------------- | ------------------------- | ------------------------------------- |
| `local`              | Yes, from local           | Yes, only normal local project paths  |
| `ssh-command`        | No by default             | No                                    |
| `remote-agent-child` | Yes, from remote          | No local paths; remote paths are okay |
| `remote-server`      | Yes, from remote          | No local paths; remote paths are okay |

### 2. Standard SSH Runtime Ownership

`remote-agent-child` must start a full remote pi CLI child over SSH stdio JSONL.

Ownership rules:

- Local app owns UI, tabs, recent project index, SSH profiles, and long-lived model credentials.
- Remote child owns project cwd, tools, hooks, MCP/project plugins when enabled, memory, skills, agents, sessions, and project `.pi` config.
- Model/auth access is provided through a scoped local auth proxy/tunnel, not by copying long-lived secrets to the remote host.
- Remote session JSONL is written under the remote agent dir.
- Remote memory and generated skills are written under the remote agent/project state dirs, not local shadow/cache dirs.

### 3. Quick Sandbox Ownership

`ssh-command` / tool-proxy mode is not a full remote runtime.

Required behavior:

- It must not expose local skill/memory/agent/plugin inventory to the model.
- It must not inject local memory into the prompt.
- It must not provide generated skill creation as if the remote runtime can read local paths.
- It must show UI state that makes long-lived learning/resources unavailable or explicitly sandbox-limited.
- It may offer an explicit "switch to Standard SSH" or "install/sync resource to remote" future affordance, but this plan does not implement hidden sync.

### 4. Remote Resources

In standard SSH, remote resources should be discovered by the remote child itself:

- Remote user skills under the remote pi agent dir.
- Remote project skills under the remote project `.pi` directory.
- Remote user/project agents.
- Remote plugins and extensions selected for the remote runtime.
- Remote memory under the remote memory provider path.
- Remote sessions under the remote session path.

If the remote host has no skills, the UI should show no remote skills. It should not backfill local skills.

### 5. Refresh And Reconnect

User-visible runtime state must be refresh-safe and reconnect-safe.

Minimum snapshot expectations:

- Active runtime kind and remote identity.
- Remote cwd and display project root.
- Remote child status and last error.
- Resource counts and load diagnostics for the active runtime.
- Pending permission/intervention requests with stable request ids.
- Learning/memory/skill snapshot for standard SSH, or disabled/unavailable state for quick sandbox.

The UI must rebuild from a queryable backend snapshot first, then resume live events.

## Implementation Tasks

### Task 1: Define Runtime Context And Resource Policy

Likely files:

- App: `src/shared/agent/agent-runtime-config.ts`
- App: `src/shared/agent/agent-runtime-client.ts`
- App: `src/shared/agent/process-manager.ts`
- Fork: `src/core/package-manager.ts`
- Fork: `src/core/resource-loader.ts` if present
- Fork: `src/core/system-prompt.ts`
- Fork: `src/core/agent-types.ts`
- Fork: extension runtime context setup

Steps:

1. Add a shared runtime-kind concept for local, quick sandbox, remote child, and remote server.
2. Add a single policy function that maps runtime kind to resource permissions.
3. Replace scattered SSH environment checks with calls to the policy where possible.
4. Keep existing environment variables as transitional transport inputs only, not as product logic.
5. Add tests that assert each runtime kind gets the expected policy.

### Task 2: Clean Quick Sandbox Mode

Likely fork files:

- `src/core/package-manager.ts`
- `src/core/system-prompt.ts`
- `src/core/agent-types.ts`
- `extensions/auto-memory/index.ts`
- `extensions/learning/index.ts`
- `extensions/subagent-v2/index.ts`
- Any resource loader that enumerates skills, agents, plugins, rules, or memory.

Steps:

1. Ensure quick sandbox mode returns no local user/project skills.
2. Ensure quick sandbox mode returns no local user/project agents except safe built-ins.
3. Ensure local memory recall/extraction/distillation is disabled or shown as unavailable.
4. Ensure system prompts do not include local `~/.pi/agent`, `~/.codex`, local shadow project paths, or local skill paths.
5. Ensure skill creation/distillation cannot write a local path and then ask the remote runtime to read it.
6. Add regression tests using sentinel local paths and sentinel local skill names.

### Task 3: Finish Standard SSH Remote Child

Likely app files:

- `src/shared/agent/agent-runtime-client.ts`
- `src/shared/agent/process-manager.ts`
- `src/sandbox/remote-child-bootstrap.ts`
- `tools/verify-remote-child-runtime.ts`
- SSH project open/provider files under `src/sandbox/` and `src/shared/lib/`.

Likely fork files:

- `src/modes/rpc/rpc-client.ts`
- RPC mode startup/config parsing.
- Extension/channel runtime setup.

Steps:

1. Make standard SSH project opening select `remote-agent-child` as the preferred full-fidelity mode.
2. Bootstrap or reuse the remote child binary and remote extension directory.
3. Start remote `pi --mode rpc` through SSH stdio with remote cwd.
4. Set a remote `PI_CODING_AGENT_DIR` for the child runtime.
5. Ensure remote child creates and reads remote sessions under the remote agent dir.
6. Ensure `agent.getState`, `agent.send`, `agent.stop`, `agent.getMessages`, and channel calls target the remote child.
7. Keep local app config local, but never treat the local shadow path as the project identity.
8. Add clear fallback/error UI when remote child bootstrap or SSH startup fails.

### Task 4: Prove Remote Resource Loading

Extend or add remote verifier coverage.

Required remote sentinels:

- A remote project skill such as `<remote-project>/.pi/skills/remote-smoke/SKILL.md`.
- A remote user skill or agent under the remote `PI_CODING_AGENT_DIR`.
- A remote memory file under the remote memory path.
- A local-only sentinel skill/path that must not appear in standard SSH output.

Required assertions:

1. `getState` succeeds against remote child.
2. `getExtensions` reflects the remote runtime.
3. `bash("pwd && hostname")` reports the remote cwd/host.
4. `memory.list` and `memory.getStatus` operate against the remote agent dir.
5. Remote skills/agents are visible when they exist on remote.
6. Local skills/agents are not visible unless explicitly installed/synced to remote.
7. System prompt and UI diagnostics do not show local shadow paths.

### Task 5: App UX And UI State

Likely files:

- SSH project picker / project open UI.
- Status panel runtime diagnostics.
- Learning / memory / skill panels.
- Agent or skill inventory panels.
- Explorer/Git panels that show active project identity.

Steps:

1. Label modes clearly: "Standard SSH" and "Quick Sandbox" or equivalent product copy.
2. In standard SSH, show remote host and remote path as the project identity.
3. In quick sandbox, show that long-lived learning/resources are unavailable or sandbox-limited.
4. Do not show local shadow/cache paths as the primary identity.
5. File links from memory/skill/resource panels must open through the existing Explorer/FileOverlay flow.
6. UI must not use system `alert`, `confirm`, or `prompt`; use app modals/toasts/components.
7. Prevent whole-panel horizontal scrolling in Learning/Memory/Skill panels; only code/path subregions may scroll horizontally.

### Task 6: Documentation

Update docs when implementation changes behavior:

- `docs/architecture/remote-runtime-architecture-comparison.md`
- `docs/workflows/ssh-remote-runtime.md`
- `AGENTS.md` if the default boundary or commands change.

Document:

- Which mode is default.
- How to run standard SSH verification.
- How to run quick sandbox verification.
- Where remote sessions, memory, skills, and runtime assets are stored.
- What is intentionally not synced.

## Acceptance Criteria

### Runtime Boundary

- Standard SSH starts a remote child runtime and does not rely on the local agent runtime for resource discovery.
- Quick sandbox does not expose local memory, local skills, local agents, local plugins, local rules, or local project-shadow paths.
- Runtime resource policy is centralized enough that adding a new resource category does not require every plugin to rediscover SSH semantics.

### Standard SSH

- Remote `pwd && hostname && whoami && uname -a` matches the selected remote project.
- Remote file writes appear on the remote host.
- Remote session JSONL is created under the remote agent dir.
- Remote memory channel works against the remote agent dir.
- Remote skills/agents are discoverable when installed on remote.
- Local skills/agents are not discoverable by standard SSH unless explicitly installed/synced to remote.
- Local auth/model credentials are not copied to remote.

### Quick Sandbox

- Quick sandbox can still run remote command/file smoke tests.
- Skill/memory/agent/plugin inventories are empty, builtin-only, or disabled according to policy.
- Learning panels do not offer impossible local-path-backed actions.
- System prompt and diagnostics do not contain local skill/memory/plugin paths.

### UI

- Project identity displays remote host and remote path.
- Standard SSH and quick sandbox are visually distinguishable.
- Refresh/reconnect rebuilds runtime/resource state from a backend snapshot.
- UI verification includes screenshots for project picker, runtime status, system prompt/resource diagnostics, Learning/Skill/Memory panels, and a successful remote command.
- No system `alert`, `confirm`, or `prompt` is introduced.

## Required Test Order

Validation order is mandatory:

1. Fork/harness tests for resource policy and extension behavior.
2. App unit/integration tests for runtime selection, process manager, handlers, and snapshot state.
3. RPC JSON / remote-child verifier tests.
4. Browser UI tests with screenshots.

Do not start with UI screenshots. Prove the runtime and RPC behavior first.

## Test Plan

### Phase 1: Fork / Harness Tests

Run from `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent`:

```bash
npm test -- \
  test/package-manager-ssh.test.ts \
  test/package-manager.test.ts \
  test/system-prompt.test.ts \
  test/agent-types.test.ts \
  test/auto-memory-ext/memory-xml-harness.test.ts \
  test/suite/subagent-v2.test.ts \
  test/suite/learning-memory-skill.test.ts \
  test/suite/learning-skill-curator.test.ts
```

Add or extend tests as needed:

- `test/runtime-resource-policy.test.ts`
- `test/remote-agent-child-resources.test.ts`
- `extensions/auto-memory/__tests__/ssh-policy.test.ts`
- `extensions/learning/__tests__/ssh-policy.test.ts`

Required assertions:

- Quick sandbox policy disables local resource loading.
- Standard remote child policy permits resource loading from the remote runtime context.
- Sentinel local paths do not appear in quick sandbox prompts/resources.
- Learning and auto-memory do not write local project memory for quick sandbox.

Then build and publish the fork:

```bash
npm run build
yalc push
```

### Phase 2: App Unit / Integration Tests

Run from `/Users/xuyingzhou/Project/temporary/pi-agent-chat`:

```bash
npm run test -- \
  test/unit/sandbox/remote-ssh-provider.test.ts \
  test/unit/handlers/agent-project-trust.test.ts \
  test/unit/handlers/memory.test.ts \
  test/unit/lib/pi-agent-paths.test.ts \
  test/integration/agent/runtime-client.test.ts \
  test/integration/agent/runtime-config.test.ts \
  test/integration/agent/reconnect-session-refresh.test.ts \
  test/integration/memory/e2e.test.ts
```

Add or extend tests as needed:

- `test/integration/agent/remote-child-runtime-policy.test.ts`
- `test/integration/agent/ssh-standard-resource-snapshot.test.ts`
- `test/unit/components/learning-ssh-mode.test.tsx`

Required assertions:

- Runtime kind is selected and persisted/displayed correctly.
- Local app config remains an app index only.
- Remote identity uses host + remote path.
- Refresh/reconnect gets a queryable snapshot before live event replay.
- Quick sandbox panels cannot trigger local-path-backed memory/skill actions.

### Phase 3: RPC JSON / Remote Child Verifier

Run from the app repo after building and yalc-pushing the fork:

```bash
npm run verify:remote-child -- \
  --target <ssh-alias> \
  --remote-project /tmp/pi-agent-remote-child-project \
  --binary /tmp/pi-remote-child-smoke \
  --extensions /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/extensions \
  --remote-runtime-dir /tmp/pi-agent-remote-runtime-child-verify \
  --remote-agent-dir /tmp/pi-agent-remote-child-agent-dir \
  --concurrency 2
```

Extend `tools/verify-remote-child-runtime.ts` so it can optionally:

1. Create remote sentinel skills/agents/memory before startup.
2. Create local-only sentinel resources.
3. Query `getState`, `getExtensions`, `getSystemPrompt`, `getAgents`, memory channel, and bash channel.
4. Assert remote sentinel resources are present in standard SSH.
5. Assert local-only sentinel resources are absent.
6. Output a JSON report with `"ok": true` only when all assertions pass.

Expected report:

```json
{
  "ok": true,
  "runtimeKind": "remote-agent-child",
  "remoteCwd": "/tmp/pi-agent-remote-child-project",
  "remoteResourcesVisible": true,
  "localResourcesVisible": false,
  "clients": 2
}
```

### Phase 4: Quick Sandbox Regression

Run a direct quick sandbox/tool-proxy test path.

Required checks:

- `pwd && hostname` runs remotely.
- System prompt does not include local skill paths.
- `getSkills` or resource inventory returns empty/builtin-only.
- Memory injection/extraction is disabled or unavailable.
- Skill distillation is disabled or unavailable.
- UI/resource diagnostics say quick sandbox is limited, not broken.

### Phase 5: Browser UI Verification

Run the app and capture screenshots after Phases 1-4 pass.

Start or reuse the dev server:

```bash
bun run dev:web
```

Required screenshots:

1. SSH project picker showing Standard SSH and Quick Sandbox choices or equivalent mode label.
2. Standard SSH opened project showing remote host + remote path identity.
3. Runtime status panel showing `remote-agent-child`.
4. Successful remote command output for `pwd && hostname && whoami && uname -a`.
5. Learning/Memory/Skills panel in standard SSH showing remote resources or empty remote state.
6. Learning/Memory/Skills panel in quick sandbox showing disabled/unavailable long-lived resources.
7. Live system prompt/resource diagnostics showing no local shadow/cache paths.
8. Refresh/reconnect after standard SSH session remains consistent.

Save screenshots under a test artifact directory, for example:

```text
artifacts/ssh-standard-remote-agent-child/
  01-project-picker.png
  02-standard-identity.png
  03-runtime-status.png
  04-remote-command.png
  05-standard-learning.png
  06-quick-sandbox-learning.png
  07-system-prompt-no-local-paths.png
  08-refresh-reconnect.png
```

### Manual Prompts

Use these prompts in an SSH project after runtime/RPC tests pass:

```text
请直接用 bash 执行：pwd && hostname && whoami && uname -a。不要解释，直接执行工具。
```

```text
请在当前远程项目目录创建 pi-agent-remote-standard-smoke.txt，内容是 hello remote standard，然后用 bash 验证文件存在并输出它的绝对路径。不要解释，直接执行工具。
```

```text
请列出当前可用的 skills 和 memory 状态，并说明它们来自远程还是本地。不要创建新文件。
```

```text
请尝试沉淀一个“每次 SSH 远程项目操作前先执行 hostname && pwd”的项目记忆或候选项，并告诉我它保存在哪里。
```

Expected standard SSH result:

- Commands run on remote.
- Memory/skill writes target remote runtime storage.
- Any displayed file path is remote or app-owned UI metadata, not local shadow state.

Expected quick sandbox result:

- Commands run on remote.
- Long-lived memory/skill actions are disabled, unavailable, or clearly marked as quick-sandbox-limited.
- No local memory/skill paths are exposed.

## Final Report Requirements

When implementation is complete, report:

- Runtime mode decisions made.
- Files changed in app and fork.
- New/updated tests.
- Exact commands run and pass/fail results.
- Remote verifier JSON summary.
- Screenshot artifact paths.
- Any known limitations or deferred work.

Do not mark complete if:

- Standard SSH cannot load remote resources.
- Quick sandbox exposes local resource paths.
- Tests only cover UI and skip RPC/runtime behavior.
- Screenshots are missing.
