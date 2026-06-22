# Permission Runtime Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Refactor permission handling into a core Permission Runtime, composable provider plugins, and UI transports so permission modes such as YOLO, readonly, safe-project, and autopilot can be implemented without hard-coded core branches.

**Architecture:** Agent files declare permission intent; core provides the runtime protocol, request lifecycle, storage, and interaction abstraction; providers implement policy. UI transports only deliver interaction requests and return responses.

**Tech Stack:** TypeScript, React/WebSocket RPC integration, pi-coding-agent extension runner, JSONL session recovery, Vitest.

**Implementation checkpoint (2026-06-21):**

- Added core `PermissionRuntime` protocol/types and provider pipeline skeleton.
- Added built-in `tool-gate-provider` for `AgentConfig.tools` / `disallowedTools` and wired it into `AgentSession.beforeToolCall`.
- Added generic `PermissionStore` backed by project `.pi/settings.json` under `permissions.rules`.
- Added `stored-decision-provider` that converts stored project allow/deny rules into runtime decisions.
- Added `path-access-provider` for current-compatible `AgentConfig.paths.read/write` enforcement; `paths.bash` remains pass-through until bash path semantics are redesigned and tested separately.
- Added `dangerous-command-provider` for current-compatible dangerous bash detection, with deny-by-default behavior and an ask-capable request shape for later UI/transport wiring.
- Added `pi-hooks-provider` adapter that maps the existing Claude Code-compatible `tool_call` hook protocol into permission `deny` / `mutate` / `pass` decisions without rewriting `pi-hooks` itself.
- Extracted shared tool/path matching helpers so the legacy path store and new permission modules use the same matching semantics.
- Wired `AgentSession.beforeToolCall` through a two-stage PermissionRuntime flow: `tool-gate -> stored-decision -> pi-hooks`, then post-mutation `path-access -> dangerous-command`. This keeps hook mutation useful without letting mutated input skip safety checks.
- Removed the legacy `agent-permissions` extension and deleted the old `checkToolPermission()` implementation/tests so duplicate permission logic no longer remains as a parallel runtime path.
- Added a first `PermissionProfile` registry for `normal` / `yolo` and legacy aliases, moving provider-stage ordering and path-boundary approval skipping out of ad hoc `AgentSession` branches.
- Added `permissionProfile` frontmatter compatibility while keeping `permissionMode` as the effective compatibility field for existing callers.
- Added a core `askPermission()` resolver that lets `permission_request` hooks decide first, falls back to UI select prompts when available, persists project remember choices through `PermissionStore`, and fails closed when no interaction transport exists.
- Extended `askPermission()` so each project-scoped remember option becomes its own selectable UI choice, allowing users to save exact, normalized, or family command rules without the resolver silently picking the first allow/deny rule.
- Added stored-rule lookup inside `askPermission()` itself so direct extension permission requests can reuse project allow/deny rules without depending on an outer provider pass.
- Added deterministic dangerous-command pattern suggestions: destructive commands such as recursive `rm`, `sudo`, env, and credentials stay exact-only, while lower-risk command families such as `git commit *--no-verify*` and `git push *--force*` can offer reusable scoped patterns.
- Added normalized bash command candidates to `stored-decision-provider` so remembered normalized patterns can match commands whose whitespace differs.
- Exposed `ctx.permissions.ask()` on extension contexts and migrated synchronous `pi-hooks` `PreToolUse` exit-3 approvals from legacy `ctx.ui.confirm()` to provider=`pi-hooks`, subject=`hook.approval` `PermissionRequest`s with selectable exact-request and hook-rule remember options.
- Wired `PermissionDecision.ask` into `AgentSession` for dangerous bash prompts; fixed `pi-hooks` so absent `PermissionRequest` hooks defer instead of auto-allowing provider asks.
- Verified the wiring with focused permission/provider tests, AgentSession integration tests, Claude Code hooks compatibility tests, build, `yalc push`, and consumer dev-server health checks.

---

## Current State

The permission flow is currently spread across core and extensions:

```text
Agent .md frontmatter
  tools / disallowedTools / permissionMode / paths / hooks
        |
        v
AgentSession.beforeToolCall
  1. checkToolPermission()
     - tools allowlist
     - disallowedTools
     - paths
     - DANGEROUS_BASH_PATTERNS
  2. _assertAgentPathAllowed()
  3. _checkPathBoundary()
     - PathPermissionStore
     - permission_request hook
     - direct ui.select()
  4. runner.emitToolCall()
     - pi-hooks PreToolUse
     - legacy agent-permissions
```

This creates several architectural problems:

- Core, `agent-permissions`, `pi-hooks`, and path boundary checks all make permission decisions with different protocols.
- UI interaction is mixed into policy logic through direct `ui.select()` or `ctx.ui.confirm()` calls.
- `permissionMode` acts like a hard-coded behavior switch instead of a provider composition profile.
- Stored decisions are path-specific today and cannot represent command, semantic, provider, or risk-based decisions cleanly.
- Pending permission requests are not a first-class refresh/reconnect-safe runtime concept.

## Target State

```text
Agent .md / AgentConfig
  declares tools / disallowedTools / permissionProfile / paths / hooks
        |
        v
AgentSession.beforeToolCall
  build PermissionContext
        |
        v
PermissionRuntime.evaluate(ctx)
  provider pipeline resolved from the selected profile:
    built-in: tool-gate-provider
    built-in: stored-decision-provider
    built-in: path-access-provider
    official optional: dangerous-command-provider
    official optional: auto-approver-provider
    extension: pi-hooks-provider
    extension: file-time-guard-provider
        |
        v
allow / deny / ask / mutate / pass
        |
        v
Interaction transport
  Web UI / CLI TUI / message-bridge / mobile
```

Architectural boundaries:

- **AgentConfig** declares intent only.
- **Core Permission Runtime** owns context, decision protocol, request identity, pending lifecycle, stored decisions, recovery snapshots, and provider orchestration.
- **Permission providers** implement policy.
- **UI transports** display interaction requests and return answers. They do not know permission policy.

Provider categories:

- **Built-in providers** ship with core because they define baseline product semantics that must not disappear when extensions are disabled.
- **Official optional providers** ship with the product but remain profile-selectable policy modules rather than hard-coded runtime branches.
- **Extension providers** are registered by plugins and use `ctx.permissions` instead of calling UI transports directly.

## Naming

Keep existing `permissionMode` initially for compatibility, but introduce the new conceptual name `permissionProfile`.

Compatibility mapping:

```text
permissionMode: normal        -> permissionProfile: normal
permissionMode: yolo          -> permissionProfile: yolo
permissionMode: always-allow  -> permissionProfile: yolo
permissionMode: dontAsk       -> permissionProfile: yolo
permissionMode: always-deny   -> permissionProfile: deny-all
permissionMode: auto          -> permissionProfile: normal
permissionMode: acceptEdits   -> permissionProfile: normal
```

Do not remove `permissionMode` until consumers in pi-agent-chat and existing agent files have migrated.

---

## Phase 0: Baseline Audit

### Task 0.1: Document Existing Permission Entrypoints

**Files:**

- Read: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-session.ts`
- Read: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions.ts`
- Read: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/path-permission-store.ts`
- Read: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/extensions/types.ts`
- Read: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/pi-hooks/index.ts`
- Read: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/agent-permissions/index.ts`
- Read: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/file-time-guard/index.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/docs/plans/2026-06-18-permission-runtime-redesign.md`

**Steps:**

1. List every current permission-like decision point.
2. Classify each as declaration, runtime protocol, provider policy, UI transport, or storage.
3. Record tests that currently protect each decision point.

**Verification:**

Run:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
rg -n "permissionMode|checkToolPermission|PathPermissionStore|permission_request|emitToolCall|DANGEROUS_BASH_PATTERNS|ctx\\.ui|uiContext" src extensions test
```

Expected: every meaningful hit is assigned to a category.

---

## Phase 1: Core Permission Runtime Types

### Task 1.1: Add Permission Protocol Types

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/types.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/index.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permission-runtime-types.test.ts`

**Types to introduce:**

```typescript
export type PermissionAction =
  | "allow_once"
  | "always_allow_project"
  | "deny_once"
  | "always_deny_project";

export type PermissionDecision =
  | { type: "allow"; reason?: string }
  | { type: "deny"; reason: string }
  | { type: "ask"; request: PermissionRequest }
  | { type: "mutate"; input: Record<string, unknown>; reason?: string }
  | { type: "pass" };

export interface PermissionRememberOption {
  id: string;
  label: string;
  subject: string;
  pattern: string;
  scope: "project" | "session";
  action: "allow" | "deny";
  metadata?: Record<string, unknown>;
}

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  toolCallId?: string;
  provider: string;
  subject: string;
  title: string;
  message: string;
  actions: PermissionAction[];
  rememberOptions?: PermissionRememberOption[];
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface PermissionContext {
  sessionId: string;
  cwd: string;
  permissionProfile: string;
  toolName: string;
  toolCallId?: string;
  input: Record<string, unknown>;
  agent?: {
    name?: string;
    tools?: string[];
    disallowedTools?: string[];
    paths?: {
      read?: string[];
      write?: string[];
      bash?: string[];
    };
  };
}
```

**Test cases:**

- Type-only compile test imports and constructs each union variant.
- `PermissionRequest` requires stable `requestId`, `sessionId`, and `provider`.
- `PermissionDecision` supports `allow`, `deny`, `ask`, `mutate`, and `pass`.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- permission-runtime-types.test.ts
```

Expected: tests pass and TypeScript compiles.

### Task 1.2: Add Provider Interface and Runtime Skeleton

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/provider.ts`
- Create: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/runtime.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permission-runtime.test.ts`

**Interfaces:**

```typescript
export interface PermissionProvider {
  name: string;
  priority?: number;
  applies?(ctx: PermissionContext): boolean | Promise<boolean>;
  check(ctx: PermissionContext): Promise<PermissionDecision> | PermissionDecision;
}
```

Runtime behavior:

- Sort providers by ascending priority.
- Skip providers whose `applies()` returns false.
- Continue on `pass`.
- Stop on `allow`, `deny`, `ask`, or `mutate`.
- If all providers pass, return `allow`.

**Test cases:**

- Providers run in priority order.
- `pass` falls through to the next provider.
- `deny` stops the pipeline.
- `ask` stops the pipeline.
- `mutate` returns mutated input and stops.
- Provider exceptions become `deny` with a clear reason.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- permission-runtime.test.ts
```

Expected: all runtime behavior tests pass.

---

## Phase 2: Permission Store

### Task 2.1: Add Generic Permission Store

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/store.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/path-permission-store.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permission-store.test.ts`

**Design:**

Project-level decisions should live under the project `.pi/settings.json`, not under a global path-specific file.

Target structure:

```json
{
  "permissions": {
    "rules": [
      {
        "id": "perm_...",
        "provider": "path-access",
        "subject": "file.write",
        "pattern": "src/**",
        "action": "allow",
        "scope": "project",
        "createdAt": "2026-06-18T00:00:00.000Z"
      }
    ]
  }
}
```

Keep `PathPermissionStore` as a compatibility adapter during migration. It should delegate to the new store where practical or be explicitly marked legacy.

**Test cases:**

- Store creates `.pi/settings.json` if missing.
- Store preserves unrelated settings fields.
- Store matches glob-like path patterns.
- Store matches command patterns such as `npm install *`.
- Store supports project allow and project deny.
- Corrupt permissions field fails closed without deleting the rest of settings.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- permission-store.test.ts path-permission-store.test.ts
```

Expected: generic store passes, existing path store behavior remains compatible.

### Task 2.2: Add Remember Option Matching Semantics

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/store.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permission-store.test.ts`

**Rules:**

- Do not treat every stored rule as a raw regex.
- Store `subject`, `pattern`, and `provider` separately.
- Match only within the same project unless the rule scope says otherwise.
- Prefer exact matches over broad wildcard matches when multiple rules match.
- `deny` wins over `allow` at the same specificity.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- permission-store.test.ts
```

Expected: broad patterns such as `npm *` do not accidentally override more specific deny rules.

---

## Phase 3: Interaction and askPermission

### Task 3.1: Add Permission Interaction Runtime

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/interaction.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/extensions/types.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/extensions/runner.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permission-interaction.test.ts`

**Requirements:**

- `askPermission(request)` creates a stable pending request.
- It sends the request through the existing UI context as an interaction request.
- It resolves with exactly one accepted answer.
- First valid response wins.
- All other clients receive a resolved/closed event through the existing UI/RPC mechanism where available.
- No provider talks directly to Web UI, CLI TUI, or message bridge.

**Compatibility:**

Initially, implement this on top of existing `ui.select()` / `ui.confirm()` so the first migration does not require a full UI rewrite.

**Test cases:**

- `askPermission` maps `allow_once` to `allow` without persisting.
- `always_allow_project` persists the selected remember option.
- `deny_once` returns deny without persisting.
- `always_deny_project` persists deny.
- Missing UI denies with an explicit reason unless an auto provider already allowed.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- permission-interaction.test.ts extensions-ui-intercept.test.ts extensions-message-bridge.test.ts
```

Expected: existing UI interception tests still pass.

**Checkpoint (2026-06-21):**

- Added `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/ask-permission.ts` as the first interaction resolver rather than a full pending-request transport.
- Extended `PermissionRequestEvent` with the full `PermissionRequest`, subject, title, message, and actions so plugins can inspect structured provider requests while keeping the existing allow/deny result shape.
- `askPermission()` now calls `permission_request` hooks first; hook allow can optionally mutate input, hook deny blocks, and hook errors fail closed.
- UI fallback currently uses `ExtensionUIContext.select()` and maps `allow_once`, `always_allow_project`, `deny_once`, and `always_deny_project` into runtime decisions.
- Project-scoped remember choices are persisted through `PermissionStore`.
- Missing UI and missing hook handlers deny explicitly, preserving fail-closed behavior until a real pending-request transport exists.
- `AgentSession` now applies `PermissionDecision.ask` and routes dangerous bash ask requests through `askPermission()`.
- Path boundary approval now also constructs a `path-access` `PermissionRequest` and persists remember choices in `PermissionStore` instead of using `PathPermissionStore` directly from `AgentSession`.
- `pi-hooks` PermissionRequest compatibility was tightened so no matching `PermissionRequest` hook means "defer" rather than automatic allow.
- Verified with `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/ask-permission.test.ts`, AgentSession dangerous-command ask integration tests, and `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/suite/path-boundary-approval.test.ts`.

### Task 3.2: Add Pending Permission Snapshot

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/interaction.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/modes/rpc/rpc-mode.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/shared/modules/agent.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/shared/handlers/agent.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permission-interaction.test.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/test/integration/agent/permission-recovery.test.ts`

**Requirements:**

- Runtime exposes queryable pending permission snapshot.
- Snapshot includes request id, session id, tool call id, title, message, actions, provider, and metadata.
- Resolving a request emits a closed/resolved event.
- pi-agent-chat can rebuild pending permission UI after refresh/reconnect.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- permission-interaction.test.ts

cd /Users/xuyingzhou/Project/temporary/pi-agent-chat
bun run test:integration -- test/integration/agent/permission-recovery.test.ts
```

Expected: pending requests survive reconnect in the queryable snapshot and stale UI clears after resolution.

---

## Phase 4: Built-in Providers

### Task 4.1: Implement Tool Gate Provider

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/providers/tool-gate.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permissions.test.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permission-runtime.test.ts`

**Move here:**

- `AgentConfig.tools`
- `AgentConfig.disallowedTools`

**Do not move here:**

- Dangerous bash regex.
- Path boundary UI.
- Hook execution.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- permissions.test.ts permission-runtime.test.ts
```

Expected: allowlist/blocklist behavior remains unchanged.

### Task 4.2: Implement Stored Decision Provider

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/providers/stored-decision.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permission-store.test.ts`

**Behavior:**

- Checks project `.pi/settings.json` permission rules.
- Matching allow returns allow.
- Matching deny returns deny.
- No match returns pass.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- permission-store.test.ts
```

### Task 4.3: Implement Path Access Provider

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/providers/path-access.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-session.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/path-permission-store.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/path-permission-store.test.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/suite/agent-session-permissions.test.ts`

**Move here:**

- Agent `paths.read/write/bash` handling.
- Project boundary check currently in `_checkPathBoundary`.
- Remember options for exact path, parent directory, and project scope.

**Behavior:**

- Current project paths can be auto-allowed according to profile.
- Outside project paths can ask, deny, or allow according to provider config.
- System path allowlist stays explicit and auditable.
- `always_allow_project` stores a project-level rule in `.pi/settings.json`.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- path-permission-store.test.ts test/suite/agent-session-permissions.test.ts
```

Expected: path restrictions and out-of-project prompts still work, but through runtime decisions.

### Task 4.4: Implement pi-hooks Provider

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/pi-hooks/index.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/providers/pi-hooks.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/extensions/types.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/suite/claude-hooks-compat.test.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/suite/pi-hooks-integration.test.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/claude-hooks-compat-output.test.ts`

**Behavior:**

- `PreToolUse` exit 0 returns pass or allow depending on hook semantics.
- `PreToolUse` exit 2 returns deny.
- `PreToolUse` exit 3 calls `ctx.permissions.ask()` instead of direct `ctx.ui.confirm()`.
- Async `PreToolUse` exit 3 remains non-blocking and emits a clear message, as today.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- test/suite/claude-hooks-compat.test.ts test/suite/pi-hooks-integration.test.ts claude-hooks-compat-output.test.ts
```

Expected: hooks compatibility remains intact and exit 3 uses the new askPermission path.

### Task 4.5: Implement Dangerous Command Provider

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/providers/dangerous-command.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permissions.test.ts`

**Behavior:**

- This provider replaces `DANGEROUS_BASH_PATTERNS`.
- It should be optional per profile.
- It should generate remember options where safe.
- It should prefer semantic parsing for known commands over raw regex where feasible.

Initial cases:

- `sudo`: ask or deny depending on profile.
- `git push --force`: ask or deny depending on profile.
- `.env` and credentials access: ask or deny depending on profile.
- `rm -rf node_modules`: should be distinguishable from destructive out-of-project or system path removal.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- permissions.test.ts
```

Expected: previous dangerous command tests are updated to expect provider decisions, and `rm -rf node_modules` is no longer blindly blocked in safe profiles.

---

## Phase 5: beforeToolCall Migration

### Task 5.1: Wire PermissionRuntime into AgentSession

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-session.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/suite/agent-session-permissions.test.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/suite/agent-session-rpc-permissions.test.ts`

**New flow:**

```text
beforeToolCall
  build PermissionContext
  preRuntime.evaluate(ctx)
  apply decision:
    allow -> continue
    pass -> continue
    deny -> block with reason
    ask -> askPermission then apply answer
    mutate -> update args
  postRuntime.evaluate(updated ctx)
  apply deny/ask/pass/allow
```

**Important ordering:**

The profile controls provider order. The current normal default is:

```text
tool-gate
stored-decision
pi-hooks
path-access
dangerous-command
```

Provider order is explicit and tested. `pi-hooks` can mutate tool input, but the post-runtime path/dangerous providers always see the final mutated input.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- test/suite/agent-session-permissions.test.ts test/suite/agent-session-rpc-permissions.test.ts
```

Expected: blocked tools still return an error ToolResult and do not kill the agent loop.

**Checkpoint (2026-06-21):**

- Implemented in `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-session.ts`.
- Added coverage for hook single execution, safe hook mutation, and dangerous hook mutation blocking in `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/suite/agent-session-permissions.test.ts`.
- Verified with:
  - `npm test -- test/permission-runtime-types.test.ts test/permission-runtime.test.ts test/permission-tool-gate-provider.test.ts test/permission-store.test.ts test/permission-stored-decision-provider.test.ts test/permission-path-access-provider.test.ts test/permission-dangerous-command-provider.test.ts test/permission-pi-hooks-provider.test.ts test/suite/agent-session-permissions.test.ts test/suite/claude-hooks-compat.test.ts test/suite/pi-hooks-integration.test.ts test/claude-hooks-compat-output.test.ts`
  - `npm run build`
  - `yalc push`
  - `curl -I --max-time 5 http://localhost:3100/`
  - `curl -I --max-time 5 http://localhost:5173/`

### Task 5.2: Remove Legacy agent-permissions Extension

**Files:**

- Delete: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/agent-permissions/index.ts`
- Delete: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/agent-permissions/path-checker.ts`
- Delete: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/agent-permissions/__tests__/path-permissions.test.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/builtin-extensions.test.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions.ts`

**Requirements:**

- Remove all references that load or test `agent-permissions`.
- Keep compatibility through core providers and `permissionMode` mapping.
- Remove the old comment that says `agent-permissions` remains as compatibility layer.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- test/builtin-extensions.test.ts test/permission-runtime-types.test.ts test/permission-runtime.test.ts test/permission-tool-gate-provider.test.ts test/permission-store.test.ts test/permission-stored-decision-provider.test.ts test/permission-path-access-provider.test.ts test/permission-dangerous-command-provider.test.ts test/permission-pi-hooks-provider.test.ts test/suite/agent-session-permissions.test.ts test/suite/claude-hooks-compat.test.ts test/suite/pi-hooks-integration.test.ts test/claude-hooks-compat-output.test.ts
```

Expected: built-in extension list no longer expects `agent-permissions`; permission behavior is covered by providers.

**Checkpoint (2026-06-21):**

- Deleted `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/agent-permissions/`.
- Deleted `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions.ts` and `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permissions.test.ts`.
- Updated `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/package.json` so `copy-assets` clears `dist/extensions` before copying, preventing deleted extensions from surviving as stale dist artifacts.
- Verified `rg "agent-permissions|checkToolPermission|CorePermissionMode" -n src extensions test dist/extensions` has no matches.
- Verified `dist/extensions/agent-permissions` and consumer `node_modules/@dyyz1993/pi-coding-agent/dist/extensions/agent-permissions` are absent after `npm run build` and `yalc push`.

---

## Phase 6: Permission Profiles

### Task 6.1: Add Profile Registry

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/profiles.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-types.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-session.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permission-profiles.test.ts`

**Built-in profiles:**

```text
normal
  tool-gate, stored-decision, pi-hooks, path-access, dangerous-command

yolo
  stored-decision, auto-approver

readonly
  tool-gate(read tools only), path-access(read only)

safe-project
  tool-gate, stored-decision, pi-hooks, path-access(project auto, outside ask), dangerous-command

autopilot
  tool-gate, stored-decision, auto-approver(low/medium allow, high ask, critical deny), path-access, dangerous-command

deny-all
  tool-gate(deny all)
```

**Open decision:**

Decide whether YOLO disables all architecture safety or keeps a minimal critical-deny provider. This must be explicit in tests and docs.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- permission-profiles.test.ts
```

Expected: each profile expands into a deterministic provider pipeline.

**Checkpoint (2026-06-21):**

- Added `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions/profiles.ts`.
- Updated `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-session.ts` so pre/post providers are resolved from profile config.
- Updated `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-types.ts` so `permissionMode` uses the shared profile input type.
- Added `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/permission-profiles.test.ts`.
- Added AgentSession coverage proving `yolo` omits dangerous-command while preserving the rest of the permission runtime path.
- Verified with:
  - `npm test -- test/permission-profiles.test.ts test/suite/agent-session-permissions.test.ts`
  - `npm test -- test/builtin-extensions.test.ts test/permission-runtime-types.test.ts test/permission-runtime.test.ts test/permission-profiles.test.ts test/permission-tool-gate-provider.test.ts test/permission-store.test.ts test/permission-stored-decision-provider.test.ts test/permission-path-access-provider.test.ts test/permission-dangerous-command-provider.test.ts test/permission-pi-hooks-provider.test.ts test/suite/agent-session-permissions.test.ts test/suite/claude-hooks-compat.test.ts test/suite/pi-hooks-integration.test.ts test/claude-hooks-compat-output.test.ts`
  - `npm run build`
  - `yalc push`
  - `curl -I --max-time 5 http://localhost:3100/`
  - `curl -I --max-time 5 http://localhost:5173/`

### Task 6.2: Extend Agent Frontmatter Compatibility

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-types.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/main.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/agent-types.test.ts`

**Behavior:**

- Existing `permissionMode` continues to work.
- New `permissionProfile` is accepted.
- If both are present, `permissionProfile` wins and a warning is emitted.
- Agent `hooks` remain configuration for `pi-hooks`, not a direct permission runtime implementation.
- Agent `paths` remain configuration for `path-access-provider`.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm test -- agent-types.test.ts
```

Expected: old agent files continue loading; new profile field works.

**Checkpoint (2026-06-21):**

- Added `permissionProfile` to `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-types.ts`.
- `permissionProfile` wins when both `permissionMode` and `permissionProfile` are present, and the effective value is mirrored into `permissionMode` for existing callers.
- Updated `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-session.ts` to apply `agent.permissionProfile ?? agent.permissionMode`.
- Added `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/agent-types.test.ts`.
- Verified with:
  - `npm test -- test/agent-types.test.ts test/permission-profiles.test.ts test/suite/agent-session-permissions.test.ts`
  - `npm test -- test/agent-types.test.ts test/builtin-extensions.test.ts test/permission-runtime-types.test.ts test/permission-runtime.test.ts test/permission-profiles.test.ts test/permission-tool-gate-provider.test.ts test/permission-store.test.ts test/permission-stored-decision-provider.test.ts test/permission-path-access-provider.test.ts test/permission-dangerous-command-provider.test.ts test/permission-pi-hooks-provider.test.ts test/suite/agent-session-permissions.test.ts test/suite/agent-session-rpc-permissions.test.ts test/suite/claude-hooks-compat.test.ts test/suite/pi-hooks-integration.test.ts test/claude-hooks-compat-output.test.ts`
  - `npm run build`
  - `yalc push`
  - `curl -I --max-time 5 http://localhost:3100/`
  - `curl -I --max-time 5 http://localhost:5173/`

---

## Phase 7: pi-agent-chat Integration

### Task 7.1: Surface Pending Permission Requests in Agent State

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/shared/modules/agent.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/shared/handlers/agent.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/shared/agent/event-handler.ts`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/stores/use-agent-store.ts`
- Test: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/test/integration/agent/permission-recovery.test.ts`

**Requirements:**

- Query current pending permission requests from the authoritative runtime owner.
- Rebuild UI state from snapshot on page refresh or WebSocket reconnect.
- Subscribe to live permission opened/resolved events after snapshot load.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-agent-chat
bun run test:integration -- test/integration/agent/permission-recovery.test.ts
```

Expected: permission cards do not disappear after refresh and close everywhere after response.

**Checkpoint (2026-06-21):**

- The existing `pendingUIRequests` snapshot/recovery path already carries extension UI select requests, so the first runtime permission UI integration reuses that transport instead of adding a separate pending-permission state source.
- Extended `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/shared/modules/agent.ts` and `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/types/index.ts` so `permissionMeta` supports both legacy `path_boundary` and new `permission_runtime` metadata.
- Verified runtime permission metadata survives into the existing active-session pending request dock.
- Updated `/Users/xuyingzhou/Project/temporary/pi-agent-chat/test/unit/stores/status-visibility.test.ts` so `fetchInitialState()` recovery preserves `permission_runtime` metadata and restores session status to `permission`.
- A dedicated runtime-owned query API is still needed later if permissions move beyond the existing extension UI request transport.

### Task 7.2: Add Permission Request UI Card

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/components/chat/PermissionRequestCard.tsx`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/components/chat/ChatPanel.tsx`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/locales/en/*.json`
- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/locales/zh-CN/*.json`
- Test: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/test/unit/components/PermissionRequestCard.test.tsx`

**UI requirements:**

- Show provider, title, message, and resource summary.
- Render available actions from the request, not hard-coded assumptions.
- Render remember options when present.
- Disable buttons after response.
- Respect safe-area/touch target rules for mobile.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-agent-chat
bun run test:unit -- test/unit/components/PermissionRequestCard.test.tsx
```

Expected: card renders actions and sends selected action with request id.

**Checkpoint (2026-06-21):**

- Reused the existing UI interaction card path instead of creating a standalone `PermissionRequestCard`.
- Added runtime permission rendering in `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/components/chat/UIPendingCenter.tsx` for active-session pending request docks.
- Added `RuntimePermissionCard` in `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/components/chat/tool-renderers/UICardRenderer.tsx` for chat/history UI interaction blocks.
- Runtime permission cards show provider, subject, message, and command/path metadata when present, and return the original selected option label so bottom `askPermission()` can resolve it.
- Verified with:
  - `bun run test -- test/unit/components/UIPendingCenter.test.tsx`
  - `bun run test -- test/unit/components/UIPendingCenter.test.tsx test/unit/stores/status-visibility.test.ts`
  - `bun run build`

---

## Phase 8: End-to-End Validation

### Task 8.1: Add Permission Runtime Regression Tests

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/test/regression/agent/permission-runtime-profiles.test.ts`
- Create: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/test/integration/agent/permission-recovery.test.ts`

**Scenarios:**

- `normal`: hooks receive `PreToolUse` before dangerous command provider blocks.
- `exit 2`: returns blocked ToolResult, agent loop continues.
- `exit 3`: creates permission request through runtime.
- `safe-project`: project-local file write auto-allows, outside project asks.
- `readonly`: write/edit/bash deny.
- `autopilot`: low-risk command auto-allows, high-risk command asks.
- `always allow`: selected pattern avoids the next prompt.
- `always deny`: selected pattern blocks the next matching operation.
- Refresh/reconnect: pending permission request restores and closes after response.

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-agent-chat
bun run test:regression -- test/regression/agent/permission-runtime-profiles.test.ts
bun run test:integration -- test/integration/agent/permission-recovery.test.ts
```

### Task 8.2: Build and yalc Push Bottom Library

**Files:**

- No source edits.

**Commands:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm run build
yalc push
```

**Verification:**

```bash
cd /Users/xuyingzhou/Project/temporary/pi-agent-chat
bun run test:smoke
```

Expected: pi-agent-chat sees the updated `.yalc/@dyyz1993/pi-coding-agent` build and smoke tests pass.

---

## Deletion Summary

Delete after provider migration is tested:

- `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/agent-permissions/`
- `DANGEROUS_BASH_PATTERNS` from `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/permissions.ts`
- Direct permission prompt UI code from `_checkPathBoundary()` in `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/core/agent-session.ts`

Do not delete immediately:

- `permissionMode` frontmatter support.
- `PathPermissionStore` compatibility until stored path permissions have a migration path.
- Existing `ctx.ui.confirm/select` transport support.

## Extension Capability After Refactor

New providers can be added without editing `AgentSession.beforeToolCall`:

```text
git-risk-provider
  ask before force-pushing protected branches

network-access-provider
  ask before curl/wget to external domains

secrets-provider
  deny reads of .env/credentials unless explicitly allowed

team-policy-provider
  enforce policy-level deny rules

auto-approver-provider
  approve low-risk operations and escalate high-risk operations
```

UI integrations can be added without editing providers:

```text
CLI TUI
Web chat card
message-bridge
mobile push
future notification center
```

Profiles can be added without rewriting providers:

```text
safe-project
autopilot
readonly
paranoid
sandbox
team-managed
```

## Key Acceptance Criteria

- Core no longer owns business-specific dangerous bash regex as an unconditional gate.
- `agent-permissions` is removed or reduced to a documented compatibility shim before deletion.
- Hooks, path access, stored decisions, and auto approval all use the same decision protocol.
- Permission prompts use stable request identities.
- Pending permission state is queryable for refresh/reconnect recovery.
- UI transport does not implement permission policy.
- Provider order is deterministic and profile-driven.
- Project-level `always allow` / `always deny` rules are persisted in project settings.
- Session-level `allow once` never leaks into other sessions.
