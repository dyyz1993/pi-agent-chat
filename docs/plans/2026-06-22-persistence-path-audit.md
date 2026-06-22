# Persistence Path Audit

Date: 2026-06-22

This audit records the current runtime write paths across `pi-agent-chat` and the linked `pi-coding-agent` fork. It is the handoff point for returning to the permission configuration work without inventing new storage locations.

## Current Path Model

| Area                    | Current source of truth                                                                   | Status                                                                     |
| ----------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| App UI state            | `~/.pi-agent-chat/config.json` via `src/shared/lib/project-config.ts`                     | OK. App-level only.                                                        |
| Agent root              | `PI_CODING_AGENT_DIR ?? ~/.pi/agent` via fork `getAgentDir()` and app `pi-agent-paths.ts` | OK. App and fork now share the same root rule.                             |
| Session JSONL           | `~/.pi/agent/sessions/<SESSION_BUCKET_KEY>` via app `session.ts` and `session-scanner.ts` | OK. Uses app path helper and honors `PI_CODING_AGENT_DIR`.                 |
| Extension session data  | `ctx.sessionDataDir` -> `<sessionDir>/data/<sessionId>/<extName>`                         | OK. Existing extension API.                                                |
| Extension project data  | `ctx.projectDataDir` -> `~/.pi/agent/project-data/<PROJECT_KEY>/<EXT_NAME>`               | OK. This is the existing plugin project storage API.                       |
| Extension global data   | `ctx.globalDataDir` -> `~/.pi/agent/extensions-data/<EXT_NAME>`                           | OK. Existing extension API.                                                |
| Project trust           | `~/.pi/agent/projects/<PROJECT_KEY>/trust.json`                                           | OK after recent change. Legacy `trust.json` is read-only fallback.         |
| Path permissions legacy | `~/.pi/agent/projects/<PROJECT_KEY>/path-permissions.json`                                | OK after recent change. Legacy global file is read-only fallback.          |
| Stored permission rules | `<PROJECT_ROOT>/.pi/settings.json` under `permissions.rules`                              | OK, but requires project trust. Falls back to session rule when untrusted. |
| Auto memory             | `~/.pi/agent/memory/<legacy-bucket>`                                                      | Legacy-compatible. App fallback now uses the shared path helper.           |
| Sandbox memory sync     | `/root/.pi/agent/memory` backup/restore in `sandbox-box.ts`                               | Partial. Does not yet include `projects/` or `project-data/`.              |

## Existing Extension Storage API

The fork already exposes the intended plugin storage API through `ExtensionContext`:

```text
ctx.sessionDataDir
ctx.projectDataDir
ctx.cwdDataDir
ctx.globalDataDir
ctx.projectRoot
```

Implication:

- Ordinary plugins should use `ctx.projectDataDir` for project-scoped private data.
- Plugin-owned project memory should be `ctx.projectDataDir/memory`.
- The shared project memory pool is a separate provider-owned concept, not a place ordinary plugins should write directly.

Observed examples:

- `session-supervisor` reads `ctx.sessionDataDir/supervisor.json` and `ctx.projectDataDir/supervisor.json`.
- `auto-memory` still bypasses `ctx.projectDataDir` and writes `~/.pi/agent/memory/<legacy-bucket>`.

## Permission Configuration Return Point

There are three different permission-related storage surfaces. They should not be merged casually:

| Surface                 | Path                                                       | Meaning                                                                            |
| ----------------------- | ---------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Project trust           | `~/.pi/agent/projects/<PROJECT_KEY>/trust.json`            | Local user decision: whether this project may load/write project settings.         |
| Stored permission rules | `<PROJECT_ROOT>/.pi/settings.json` -> `permissions.rules`  | Project-shared rules created by `Always allow` / `Always deny` when trusted.       |
| Legacy path permissions | `~/.pi/agent/projects/<PROJECT_KEY>/path-permissions.json` | Local-only path allow/deny fallback. Keep for compatibility unless fully migrated. |

Current runtime behavior:

- `askPermission()` checks stored rules before showing UI.
- `always_allow_project` / `always_deny_project` call `PermissionStore.addRule()`.
- `PermissionStore.addRule()` writes project rules only when `settingsManager.isProjectTrusted() !== false`.
- If the project is not trusted, `PermissionStore` stores the rule as a session-only in-memory rule.
- Therefore, persistent `Always allow` depends on project trust.

This explains the user-visible behavior:

```text
Untrusted project + Always allow
=> current session only

Trusted project + Always allow
=> persists to <PROJECT_ROOT>/.pi/settings.json permissions.rules
```

## Gaps To Fix Next

1. App-side path helper

Create a shared app helper, for example `src/shared/lib/pi-agent-paths.ts`, and move duplicated logic into it:

```text
getPiAgentDir()
encodeProjectPath()
getProjectUserStateDir()
getProjectTrustStorePath()
getSessionBucketKey()
getSessionsRoot()
getUserMemoryDir()
```

Then update:

- `src/shared/handlers/agent.ts`
- `src/shared/handlers/session.ts`
- `src/shared/lib/session-scanner.ts`
- `src/shared/handlers/memory.ts`

Status: implemented. Focused tests cover helper output, project trust, session creation, and memory fallback.

2. Permission storage UX

Make the permission UI copy match the actual persistence behavior:

- If project is untrusted, `Always allow` should say it is session-only or prompt to trust first.
- If project is trusted, `Always allow` should persist to project settings.
- The advanced panel should expose where rules are stored.

Status: implemented for permission action cards and the status panel advanced section. The action buttons show the match pattern separately from the primary button label and display whether the remembered rule applies to project settings or only the current session.

3. Sandbox sync policy

Current sandbox restore copies:

```text
/root/.pi/agent/memory
models/settings/extensions
```

It does not yet copy:

```text
/root/.pi/agent/projects
/root/.pi/agent/project-data
```

For permission behavior in sandbox, decide explicitly:

- copy `projects/` read-write for local trust/path-permissions, or
- start sandbox with clean trust and force explicit approval, or
- mount only selected project state.

Do not mount the entire `~/.pi/agent` read-write by default.

4. Memory provider boundary

Keep current auto-memory legacy path compatible. For new memory work:

- user global memory -> `~/.pi/agent/memory`
- shared project memory -> `~/.pi/agent/projects/<PROJECT_KEY>/memory`
- plugin project memory -> `ctx.projectDataDir/memory`
- external Codex memory -> explicit read-only connector/import only

## Suggested Implementation Order

1. Add app-side path helper and focused unit tests.
2. Update app session/trust/memory handlers to use that helper.
3. Add tests proving `PI_CODING_AGENT_DIR` is honored by sessions and memory fallback.
4. Update permission UI text around trusted vs untrusted persistence.
5. Add sandbox sync decision and tests for whichever policy is chosen.
6. Only then migrate `auto-memory` toward the new memory provider path.
