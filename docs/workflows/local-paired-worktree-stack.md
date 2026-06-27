# Local Paired Worktree Stack

Use this workflow when a local development task needs an app worktree plus one or more local dependency worktrees. In this repo the common case is:

```text
pi-agent-chat worktree
  -> pi-momo-fork worktree
      -> packages/coding-agent/dist/cli.js
```

The goal is not only separate Git checkouts. A usable worktree stack also needs isolated ports, runtime env, app config, package links, build output, logs, and a registry entry that explains which parts belong together.

## When To Use

Use a paired worktree stack when:

- A change touches `pi-agent-chat` and `pi-momo-fork/packages/coding-agent`.
- The app worktree must run next to the main dev server.
- A local dependency is consumed through `PI_CLI_PATH`, `.yalc`, `file:` packages, or generated `dist/`.
- Debugging needs a realistic UI config but must not write into the main app config.

Do not treat `git worktree add` alone as sufficient. Always decide how the stack handles the dimensions below.

## Dimensions Checklist

### 1. Source Topology

Record every repo and branch in the stack:

```text
app repo path
app worktree path
app branch
dependency repo source root
dependency worktree path
dependency branch
```

For `pi-agent-chat`, the paired fork source defaults to:

```text
/Users/xuyingzhou/Project/temporary/pi-momo-fork
```

### 2. Dependency Install Strategy

Choose separately for the app and for each dependency worktree:

| Strategy | Meaning | Use When |
| --- | --- | --- |
| `link` | Symlink existing `node_modules` / `.yalc` from the main checkout | Fast local UI/runtime testing without package dependency changes |
| `install` | Run package install in the worktree | Package deps or lockfiles may change |
| `skip` | Leave dependencies untouched | Caller manages dependencies manually |

For `pi-momo-fork`, remember both root and package-level dependencies can exist:

```text
pi-momo-fork/node_modules
pi-momo-fork/packages/coding-agent/node_modules
```

### 3. Local Package And yalc Strategy

There are two different dependency paths:

- Runtime CLI: `PI_CLI_PATH` points to `packages/coding-agent/dist/cli.js`.
- App package import: `package.json` consumes `@dyyz1993/pi-coding-agent` from `.yalc`.

If the app only needs to spawn the paired CLI, updating `PI_CLI_PATH` is enough. If app code imports changed package APIs or types, update the app worktree's `.yalc` or install strategy too.

Avoid broad `yalc push` during isolated worktree testing unless you intentionally want to update every yalc consumer. Prefer targeted worktree-local package updates when adding that capability.

### 4. Env Layers

Keep these env classes distinct:

| Env Class | Examples | Owner |
| --- | --- | --- |
| Server env | `AUTH_TOKEN`, `PORT`, `PI_CLI_PATH`, `LOG_DIR` | Bun server |
| Frontend dev env | `VITE_API_TARGET`, `VITE_AUTH_TOKEN`, `VITE_PORT` | Vite/browser |
| Agent runtime env | `PI_CODING_AGENT_DIR`, model/proxy env, tool dirs | spawned CLI |

For local worktree dev, the scripts generate `.env` from the main `.env`, override `PORT`, and optionally override `PI_CLI_PATH`. The start path exports `VITE_API_TARGET` and `VITE_AUTH_TOKEN` so the browser connects to the paired worktree backend without manual token entry.

### 5. App Config

`<PI_APP_CONFIG_DIR>/config.json` stores app UI indexes such as recent projects, tabs, favorites, and UI preferences. A worktree stack should not write those changes to the main app config by default.

The local scripts use:

```text
~/.pi-agent-chat/worktrees/<worktree-id>/config.json
```

On first start, the script seeds this file from:

```text
~/.pi-agent-chat/config.json
```

After seeding, the worktree config is independent.

### 6. Agent Global State

The spawned CLI can read and write agent state under `PI_CODING_AGENT_DIR` / `~/.pi/agent`, including settings, sessions, projects, extensions, skills, memory, and auth/model files.

Supported policy should be explicit:

| Policy | Meaning |
| --- | --- |
| `shared` | Use the normal user agent dir; closest to real app behavior |
| `isolated` | Use a per-stack agent dir; safest for destructive runtime experiments |
| `seed` | Copy selected non-secret settings/resources once, then isolate writes |

Current local scripts primarily isolate app config and ports. Add an explicit `PI_CODING_AGENT_DIR` mode before testing changes that may rewrite agent settings, sessions, memory, trust, permissions, model auth, MCP, hooks, or plugin state.

### 7. Ports And Registry

Port allocation must account for running processes and reserved worktree stacks. The local scripts write stack metadata under:

```text
~/.pi-agent-chat/worktrees/registry/<worktree-id>.env
```

Registry entries include:

```text
APP_PATH
APP_BRANCH
API_PORT
VITE_PORT
CONFIG_DIR
AGENT_SOURCE_ROOT
AGENT_WORKTREE_PATH
AGENT_BRANCH
AGENT_CLI_PATH
```

Rules:

- Reuse a registered port only if it is free or owned by the same worktree's recorded pids.
- Skip ports reserved by another registry entry.
- Skip ports owned by unrelated system processes.

### 8. Commands And Binaries

Avoid relying on global CLIs when a worktree-local binary exists. Prefer:

```text
./node_modules/.bin/vite
npm --prefix <agent-worktree>/packages/coding-agent run build
<agent-worktree>/packages/coding-agent/dist/cli.js
```

This avoids global command drift. For example, a system `dotenv` may not be `dotenv-cli` and can interpret `-e` differently.

### 9. Build Output

For `pi-coding-agent`:

- `src/` builds to `dist/` via `tsgo`.
- `extensions/` are copied into `dist/extensions/` during `npm run build`.
- Changed extension code is not active until the paired package is rebuilt and the app/runtime is restarted or reloaded.

### 10. Logs, Pids, And Cleanup

Each stack should keep local runtime files in the app worktree:

```text
logs/dev.log
.worktree-dev.pid
.worktree-dev.children
.worktree-deps.json
```

These files are ignored by git. Stop a running stack with:

```bash
kill $(cat <app-worktree>/.worktree-dev.pid)
```

Future script commands should add `stop`, `restart`, `doctor`, and `clean` subcommands instead of requiring manual pid handling.

### 11. Sensitive State

Do not blindly copy secrets into stack-specific directories. Treat these as sensitive:

```text
auth.json
oauth.json
models.json
MCP config
hooks
private memory
SSH profiles and keys
```

For local web dev, passing `AUTH_TOKEN` from ignored `.env` into `VITE_AUTH_TOKEN` is acceptable because it is dev-only and not written into tracked files.

## Checklist

Use this checklist before handing a stack to another person, another agent, or a browser automation run.

### Before Creating The Stack

- [ ] Name the stack with a short feature/work item id that can be reused across app and dependency worktrees.
- [ ] Decide whether the dependency fork needs a paired worktree or whether the main fork checkout is acceptable.
- [ ] Check the main app checkout and dependency source checkout for dirty changes; commit, stash, or export patches that must appear in the new worktree.
- [ ] Pick the app dependency strategy: `link`, `install`, or `skip`.
- [ ] Pick the dependency fork strategy: `agent-link`, `agent-install`, or `agent-skip-deps`.
- [ ] Decide whether `PI_CLI_PATH` is enough or whether the app worktree also needs an isolated `.yalc` package update.
- [ ] Decide the app config mode: seed from main config, empty config, or shared config.
- [ ] Decide the agent global state mode: shared `~/.pi/agent`, isolated `PI_CODING_AGENT_DIR`, or seeded agent dir.
- [ ] Confirm no sensitive files need to be copied implicitly.

### After Creating The Stack

- [ ] Confirm `scripts/worktree-dev.sh list` shows the app worktree, API port, Vite port, and paired agent worktree.
- [ ] Confirm the app `.env` contains the expected `PORT` and `PI_CLI_PATH`.
- [ ] Confirm the registry entry under `~/.pi-agent-chat/worktrees/registry/` matches the stack.
- [ ] Confirm `<PI_APP_CONFIG_DIR>/config.json` exists and points at the intended isolated app config.
- [ ] Confirm the paired fork branch and path are correct.
- [ ] If the paired fork was created, run or confirm `npm --prefix <agent-worktree>/packages/coding-agent run build`.
- [ ] Confirm `logs/dev.log` shows the expected `PI_CLI_PATH`, `PI_APP_CONFIG_DIR`, and API port.
- [ ] Confirm `curl http://localhost:<api-port>/health` returns `{"status":"ok"}`.
- [ ] Open `http://localhost:<vite-port>/` and confirm WebSocket traffic reaches the same API port.

### Before Editing Code

- [ ] Edit app code only in the app worktree.
- [ ] Edit fork code only in the paired dependency worktree.
- [ ] Do not edit `node_modules/@dyyz1993/pi-coding-agent/dist`.
- [ ] If changing dependency APIs/types used by the app, update the app worktree's local package link strategy, not only `PI_CLI_PATH`.
- [ ] If changing fork extensions, rebuild the paired fork so `dist/extensions` is refreshed.

### Before Finishing

- [ ] Run `bash -n scripts/worktree-common.sh scripts/worktree-create.sh scripts/worktree-dev.sh` if scripts changed.
- [ ] Run `git diff --check`.
- [ ] Run the relevant app or fork tests for the changed area.
- [ ] Confirm the running browser still uses the stack Vite port and stack API port.
- [ ] Summarize which worktrees, ports, config dirs, and dependency strategies were used.
- [ ] Stop only the stack you own; do not kill unrelated dev servers.

## Scripts

### Create A New Stack

```bash
./scripts/worktree-create.sh <branch> --dev --with-agent-fork
```

Common variants:

```bash
./scripts/worktree-create.sh <branch> --dev --start --with-agent-fork
./scripts/worktree-create.sh <branch> --dev --with-agent-fork --install --agent-install
./scripts/worktree-create.sh <branch> --dev --with-agent-fork --agent-path /path/to/pi-momo-fork
```

### Start Or Repair An Existing Stack

```bash
./scripts/worktree-dev.sh <app-worktree>
```

With paired fork setup:

```bash
./scripts/worktree-dev.sh <app-worktree> \
  --with-agent-fork \
  --agent-path <paired-pi-momo-fork-worktree> \
  --agent-branch <branch> \
  --agent-build
```

Prepare env and registry without starting:

```bash
./scripts/worktree-dev.sh <app-worktree> --no-start
```

List all known worktrees and registered stacks:

```bash
./scripts/worktree-dev.sh list
```

## Verification

After creating or repairing a stack:

```bash
bash -n scripts/worktree-common.sh scripts/worktree-create.sh scripts/worktree-dev.sh
git diff --check
curl http://localhost:<api-port>/health
```

Then verify the browser:

- Open `http://localhost:<vite-port>/`.
- Confirm the server log shows a WebSocket client connected to the stack API port.
- Confirm the log's `PI_CLI_PATH` points to the paired dependency worktree if one is expected.
- Confirm `<PI_APP_CONFIG_DIR>/config.json` is the stack config, not the main app config.

## Parallel Development Guidance

Multiple people or agents can work at the same time if every stack owns its own paths and ports. Treat the stack id as the coordination handle.

### Naming

Use one feature id for every paired checkout:

```text
feature id: codex/permission-runtime
app branch: codex/permission-runtime
agent branch: codex/permission-runtime
registry id: derived from app worktree path
```

If the app worktree is detached, choose an explicit agent branch with `--agent-branch` so the dependency worktree is not named `HEAD`.

### Path Ownership

Each concurrent stack should have its own:

```text
app worktree path
dependency worktree path
PI_APP_CONFIG_DIR
logs/dev.log
.worktree-dev.pid
.worktree-dev.children
registry entry
```

Do not reuse another stack's paired dependency worktree unless that is an explicit collaboration choice. Shared dependency worktrees make it hard to know which app instance is testing which fork build.

### Port Ownership

Use the registry instead of hard-coding ports in notes or scripts. A stack can reuse its own registered ports, but must skip ports reserved by other stacks.

When a port conflict appears:

- Check `./scripts/worktree-dev.sh list`.
- Check `lsof -nP -iTCP:<port> -sTCP:LISTEN`.
- Restart the stack through `worktree-dev.sh` so the registry and `.env` stay aligned.

### Dependency Ownership

Prefer `link` when the task only changes app source or fork source without package dependency changes. Prefer `install` when `package.json`, lockfiles, generated package metadata, or native dependencies may change.

For parallel work, do not run broad package update commands in a shared checkout unless every active stack expects it. In particular:

- Avoid `yalc push` from the main fork during isolated stack testing unless the intent is to update all yalc consumers.
- Prefer targeted app-worktree updates when a stack needs its own package copy.
- Rebuild the paired fork before restarting the app stack.

### Runtime State Ownership

Parallel stacks should not silently share mutable runtime state unless the test requires realism over isolation.

Recommended defaults:

```text
App UI config: seed-copy into per-stack PI_APP_CONFIG_DIR
Ports: per-stack registry allocation
Logs/pids: per-stack app worktree files
Agent source: paired dependency worktree when changing fork code
Agent global state: shared only for normal UI smoke; isolated/seeded for trust, permission, memory, model, MCP, hook, or session-state work
```

### Browser And Automation

Each browser automation run should receive the stack Vite URL, not just `localhost:5173`.

Verify the browser connects to the stack API by checking:

```text
logs/dev.log contains "Client connected"
logs/dev.log shows PORT=<stack api port>
logs/dev.log shows PI_CLI_PATH=<stack dependency worktree>/packages/coding-agent/dist/cli.js
```

### White Screen Troubleshooting

If the stack appears to be "half connected", verify the registry before trusting whatever ports happen to be open globally.

Example from the current stack:

```text
app worktree: /Users/xuyingzhou/.codex/worktrees/5466/pi-agent-chat
registry api: 3102
registry vite: 5175
```

If `localhost:3100` from another checkout is also running, it can look like `5175` is "using 3100". Confirm the actual pairing from:

- `./scripts/worktree-dev.sh list`
- the stack registry file under `~/.pi-agent-chat/worktrees/registry/`
- the Vite process environment (`VITE_API_TARGET`)
- `curl http://localhost:<vite-port>/health`

If the page is not stuck on a loading or retry state and instead shows a blank root, check browser runtime errors before blaming the backend. In the `5466` stack we hit:

```text
TypeError: Cannot read properties of null (reading 'useContext')
at useTranslation(...)
at App (...)
```

Root cause:

- the app worktree used symlinked `node_modules` from another checkout,
- Vite dev resolution loaded React more than once,
- `react-i18next` then saw a different React instance from the renderer, so hooks failed during initial render.

The worktree-safe mitigation is to dedupe React in Vite:

```ts
cacheDir: `../../.vite/vite-${VITE_PORT}`,
resolve: {
  dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
}
```

Why `cacheDir` matters:

- when multiple worktrees share `node_modules` via symlink, Vite's default cache directory (`node_modules/.vite`) is also shared,
- two dev servers can then overwrite each other's prebundled React chunks and browser hashes,
- symptoms include blank screens, `virtua` / `react-i18next` hook crashes, and browser errors such as `unsupported MIME type ('text/html')` for dependency chunks.

After changing this, restart the stack through `scripts/worktree-dev.sh` so Vite picks up the new resolve behavior and rebuilds a per-worktree cache.

### Cleanup

Before removing a stack:

- Stop the stack process.
- Save or commit useful changes in the app worktree.
- Save or commit useful changes in the dependency worktree.
- Remove stale registry entries only after the worktrees are no longer needed.
- Do not remove a dependency worktree that another app stack still references.

## Current pi-agent-chat Example

```text
app:
  /Users/xuyingzhou/.codex/worktrees/5466/pi-agent-chat

paired agent fork:
  /Users/xuyingzhou/.codex/worktrees/5466/pi-momo-fork

registry:
  ~/.pi-agent-chat/worktrees/registry/pi-agent-chat-8fd216f23c71.env
```

The corresponding runtime should show:

```text
API_PORT=3102
VITE_PORT=5175
PI_CLI_PATH=/Users/xuyingzhou/.codex/worktrees/5466/pi-momo-fork/packages/coding-agent/dist/cli.js
PI_APP_CONFIG_DIR=~/.pi-agent-chat/worktrees/pi-agent-chat-8fd216f23c71
```
