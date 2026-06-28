# Worktree Capability Boundary

This document defines where Git worktree support belongs in Pi today, what should
move into the lower runtime over time, and how paths should be named before the
app is released.

## Current State

Worktree support is currently split across three layers:

| Layer | Current owner | What exists today |
| --- | --- | --- |
| Runtime awareness | `pi-coding-agent` | The runtime understands Git worktree metadata, branch state, and canonical git roots. |
| App primitive | `pi-agent-chat` RPC | `git.worktreeList` and `git.worktreeAdd` call Git and return worktree paths. |
| Project orchestration | `scripts/worktree-*.sh` and project agents | Paired app/fork worktrees, ports, app config isolation, `PI_CLI_PATH`, `PI_CODING_AGENT_DIR`, logs, and registry. |

So worktree is not a plugin feature, but the complete paired worktree stack is
also not yet a fully generic runtime feature. It is currently a project-level
workflow built on top of lower-level Git/runtime primitives.

## Ownership Rule

Use this test before moving a feature down into the Pi runtime:

If the feature still makes sense outside `pi-agent-chat` and without the current
`pi-momo-fork` paired topology, it can become a framework/runtime capability. If
it depends on app ports, Vite, yalc, local fork paths, app-specific config shape,
or project-scoped agents, it should remain in this repository's workflow layer.

## Capability Split

| Capability | Should live in | Reason |
| --- | --- | --- |
| Detect current repo is a Git worktree | Runtime | Every agent invocation benefits from correct Git identity. |
| Resolve active working directory vs canonical git root | Runtime | Tools need both values to avoid writing to the wrong project. |
| Run an agent with an isolated agent dir | Runtime | This is generic isolation, not app-specific orchestration. |
| Create/list/remove raw Git worktrees | App or shared Git module first; runtime later if generalized | Useful primitive, but UI and path policy still matter. |
| Allocate API/Vite ports | App workflow | Specific to `pi-agent-chat` dev servers. |
| Seed `PI_APP_CONFIG_DIR` | App workflow | The config schema belongs to the app shell. |
| Pair `pi-agent-chat` with `pi-momo-fork` | Project workflow | This is repository topology, not a framework invariant. |
| Build `packages/coding-agent` and wire `PI_CLI_PATH` | Project workflow | Local fork development detail. |
| Maintain issue-worker registry | Project workflow | Depends on local dev server and PR-style review flow. |

## `pi --worktree` Direction

Avoid introducing a bare `pi --worktree` flag for the current paired stack.
It would suggest the runtime owns app ports, app config, dependency links, and
paired fork builds, which is not true today.

Prefer this staged direction:

1. Runtime primitive:

```bash
pi --cwd <worktree-path> --agent-dir <isolated-agent-dir>
```

or, if a named mode is useful:

```bash
pi --isolation worktree --cwd <worktree-path> --agent-dir <isolated-agent-dir>
```

2. Framework command namespace after the behavior is generic:

```bash
pi worktree list
pi worktree create <repo> --branch <branch> --root <worktree-root>
pi worktree run <worktree-path> --agent-dir <isolated-agent-dir>
```

3. Project workflow on top:

```bash
scripts/worktree-create.sh <slug> --dev --start --with-agent-fork
scripts/worktree-dev.sh <app-worktree> --with-agent-fork --agent-path <fork-worktree>
```

The runtime command should never need to know about Vite ports, yalc, or the
`pi-momo-fork` source path.

## Path Naming

Use one Pi home namespace:

```text
~/.pi/
```

Recommended app/runtime split:

| Variable | Recommended default | Meaning |
| --- | --- | --- |
| `<PI_HOME>` | `~/.pi` | Shared Pi namespace. |
| `<PI_AGENT_DIR>` | `~/.pi/agent` | Runtime-owned agent state: sessions, memory, skills, rules, auth, settings. |
| `<PI_APP_CONFIG_DIR>` | `~/.pi/chat` | App-shell state: recent projects, tabs, favorites, UI preferences, remote project records. |
| `<PI_WORKTREE_STATE_DIR>` | `~/.pi/chat/worktrees` | App-owned worktree stack state: registry, per-stack app config, agent runtime dir, logs that are not source code. |
| `<PI_WORKTREE_REGISTRY_DIR>` | `~/.pi/chat/worktrees/registry` | Port and app/fork pairing records. |
| `<PI_MANAGED_WORKTREE_ROOT>` | `~/.pi/worktrees` | Optional future root for framework-managed source worktrees. |

Do not use `~/.pi-agent-chat` for new code. The app has not been released, so the
clean target should be `~/.pi/chat`.

## Source Worktree Placement

Keep source checkout paths separate from app state by default.

Good defaults:

```text
/Users/<user>/Project/worktrees/<stack-id>/pi-agent-chat
/Users/<user>/Project/worktrees/<stack-id>/pi-momo-fork
```

or an explicit managed framework root:

```text
~/.pi/worktrees/<stack-id>/pi-agent-chat
~/.pi/worktrees/<stack-id>/pi-momo-fork
```

Avoid making `~/.pi/chat/worktrees` the default source checkout root. That path
should primarily hold state and registry files. Source worktrees can be large,
user-edited, and reviewed in editors, so hiding them under an app config dotdir
is only appropriate for explicitly managed temporary stacks.

## Multi-Repo User Project Case

When Pi is used as a released coding tool for a user product, the unit should be
a workspace stack, not a `pi-agent-chat` paired fork stack.

Example product:

```text
admin-suite
  frontend repo: admin-web
  backend repo: admin-api
```

The user-visible workspace may point at normal source directories:

```text
/Users/alice/Projects/admin-suite/admin-web
/Users/alice/Projects/admin-suite/admin-api
```

For isolated issue work, Pi may create source worktrees in a visible worktree
root:

```text
~/.pi/worktrees/admin-suite-issue-128/admin-web
~/.pi/worktrees/admin-suite-issue-128/admin-api
```

The app-owned state for that workspace stack should stay separate:

```text
~/.pi/chat/worktrees/admin-suite-issue-128-5c2b9a/
  manifest.json
  agent/
  logs/
  services/
    admin-web.log
    admin-api.log
```

The registry entry should describe the stack, not infer it from folder names:

```json
{
  "id": "admin-suite-issue-128-5c2b9a",
  "kind": "workspace-stack",
  "name": "admin-suite issue 128",
  "repos": [
    {
      "name": "admin-web",
      "role": "frontend",
      "repoPath": "/Users/alice/Projects/admin-suite/admin-web",
      "worktreePath": "/Users/alice/.pi/worktrees/admin-suite-issue-128/admin-web",
      "branch": "codex/issue-128"
    },
    {
      "name": "admin-api",
      "role": "backend",
      "repoPath": "/Users/alice/Projects/admin-suite/admin-api",
      "worktreePath": "/Users/alice/.pi/worktrees/admin-suite-issue-128/admin-api",
      "branch": "codex/issue-128"
    }
  ],
  "services": [
    {
      "name": "admin-web",
      "cwd": "/Users/alice/.pi/worktrees/admin-suite-issue-128/admin-web",
      "command": "npm run dev",
      "port": 5174,
      "healthUrl": "http://localhost:5174/"
    },
    {
      "name": "admin-api",
      "cwd": "/Users/alice/.pi/worktrees/admin-suite-issue-128/admin-api",
      "command": "npm run dev",
      "port": 8081,
      "healthUrl": "http://localhost:8081/health"
    }
  ],
  "appConfigDir": "/Users/alice/.pi/chat/worktrees/admin-suite-issue-128-5c2b9a",
  "agentDir": "/Users/alice/.pi/chat/worktrees/admin-suite-issue-128-5c2b9a/agent"
}
```

In this model:

- The workspace stack owns the relationship between multiple repos.
- Each repo keeps its own Git identity, branch, worktree path, tests, and diff.
- Each service declares its own port and health check.
- The agent sees a workspace context that lists all repos and services, but
  file operations still target an explicit repo/worktree path.
- App state and runtime state stay out of user source directories unless the
  user explicitly asks to write project-local config.

## Multi-Repo Orchestration Model

A multi-repo workspace should normally be coordinated by a leader session, not
implemented by one worker session that edits every repository at once.

Recommended flow:

1. The leader owns the workspace stack context: repos, services, ports, health
   checks, branches, dependencies, and cross-repo acceptance criteria.
2. The leader decides which repo owns each concrete change.
3. The leader delegates focused tasks to repo-scoped workers.
4. Each worker runs with an explicit `cwd`, `repoName`, `worktreePath`, and
   service context so file edits, Git commands, tests, and previews cannot drift
   into the wrong repository.
5. The leader collects worker results, verifies cross-repo behavior, and decides
   whether more repo-specific work is needed.

Example:

```text
leader session: admin-suite issue 128
  knows:
    admin-web  -> frontend, port 5174
    admin-api  -> backend, port 8081

worker A:
  repoName: admin-web
  cwd: ~/.pi/worktrees/admin-suite-issue-128/admin-web
  task: update UI form and API client

worker B:
  repoName: admin-api
  cwd: ~/.pi/worktrees/admin-suite-issue-128/admin-api
  task: add API validation and tests
```

The point of the workspace stack is to prevent wrong-directory work and preserve
cross-repo awareness. It does not require every worker to load or edit every
repository. Workers should receive only the repo context they need plus enough
workspace metadata to understand integration boundaries.

## Issue Batch Orchestration Case

A common production workflow is:

1. The user opens one leader session.
2. The user gives the leader a batch of issues, tickets, or product requests.
3. The leader inspects the workspace stack and associated projects.
4. The leader decides which repos are affected by each issue.
5. The leader creates or reuses repo-specific worktrees.
6. The leader assigns workers to those worktrees.
7. Workers implement focused changes and report branch, diff, tests, and risks.
8. The leader verifies integration behavior across repos and asks for follow-up
   work when needed.
9. The leader prepares the final review/merge/cleanup plan.

Example:

```text
Input:
  issues:
    ISSUE-128: add audit log list to admin UI
    ISSUE-129: enforce role validation in API
    ISSUE-130: fix login redirect across web/api

Workspace:
  admin-web  -> frontend, default port 5174
  admin-api  -> backend, default port 8081

Leader plan:
  ISSUE-128 -> worker-web-128  -> admin-web worktree
  ISSUE-129 -> worker-api-129  -> admin-api worktree
  ISSUE-130 -> worker-web-130 + worker-api-130, coordinated by leader
```

The leader may create one worktree per repo per issue, or one worktree per repo
for a coordinated batch, depending on expected merge/review shape. The important
rule is that the chosen strategy is explicit in the stack manifest, so later
workers and UI panels can see which issue, repo, branch, service, and port belong
together.

This implies the framework-level model should support:

- a leader-owned workspace stack manifest,
- issue-to-repo planning records,
- worker assignment records,
- per-worker `cwd` and `agentDir`,
- per-service port reservations,
- status and cleanup metadata.

The project-level `pi-issue-leader` and `pi-worktree-dev` agents are a local
prototype of this lifecycle for the Pi codebase. A future generic implementation
should keep the same shape but remove `pi-agent-chat`-specific assumptions.

This is the generic shape that could later justify a framework-level command
such as `pi worktree create --workspace admin-suite --repos admin-web,admin-api`.
It is different from the current `pi-agent-chat` internal development stack,
where the second repo is specifically a local runtime fork wired through
`PI_CLI_PATH`.

## Plugin Boundary

A plugin may expose UI, shortcuts, or specialized workflow templates for
worktree tasks, but it should not own the canonical worktree registry, path
resolver, or runtime isolation contract.

If a plugin needs worktree data, it should call the shared app/runtime APIs:

- Git worktree list/create primitives.
- App worktree stack registry.
- Runtime invocation with explicit `cwd` and `agentDir`.

Plugins should not independently scan `~/.pi/chat/worktrees` and infer ownership
without going through the registry.

## Migration Guidance

Because the app is not released yet, prefer a clean rename instead of a legacy
compatibility layer:

```text
old: ~/.pi-agent-chat
new: ~/.pi/chat
```

Implementation should use a single resolver module for app paths. Do not scatter
`homedir() + ".pi-agent-chat"` or `homedir() + ".pi/chat"` string joins across
handlers, scripts, or tests.

Minimum implementation steps:

1. Add path constants for `PI_HOME`, `PI_APP_CONFIG_DIR`, `PI_WORKTREE_STATE_DIR`,
   and `PI_WORKTREE_REGISTRY_DIR`.
2. Update `project-config.ts` default from `~/.pi-agent-chat` to `~/.pi/chat`.
3. Update `scripts/worktree-common.sh` defaults to `~/.pi/chat/worktrees`.
4. Update docs and project agents that reference `~/.pi-agent-chat`.
5. Run worktree script syntax checks and a paired stack smoke test.

## Decision Summary

For now:

- Treat worktree stack management as project-level orchestration.
- Keep app state under `~/.pi/chat`.
- Keep runtime state under `~/.pi/agent`.
- Keep source worktrees in a visible worktree root unless explicitly managed by
  the framework.
- Do not expose the current paired stack as `pi --worktree`.

Promote to runtime only after the behavior is generic enough to work for any Pi
consumer without knowing about `pi-agent-chat`, Vite, yalc, or `pi-momo-fork`.
