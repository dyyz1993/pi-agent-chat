# Apple Container Paired Worktree Sandbox

Use this workflow when a feature touches both this app (`pi-agent-chat`) and the linked agent runtime (`pi-momo-fork/packages/coding-agent`) and you want to keep the main working copies and running dev server unaffected.

The shape is:

```text
pi-agent-chat feature worktree  <->  coding-agent feature worktree
           |                                  |
           | consumes isolated yalc package   | builds/publishes package
           v                                  v
      Apple container running Web dev server on its own IP
```

This is for Web validation. macOS Electrobun desktop validation still runs on the host.

## When To Use

Use this when:

- You are developing a feature that needs changes in both repositories.
- You need another `bun run dev:web` without disturbing the current one.
- You want same-port parallelism: every worker can still use `3100` and `5173`.
- You need UI automation against a stable per-worker URL.

Do not use this as a replacement for final host validation. It is an isolation workflow for development and Web smoke testing.

## Repositories

Current canonical paths:

```bash
APP_MAIN=/Users/xuyingzhou/Project/temporary/pi-agent-chat
AGENT_REPO=/Users/xuyingzhou/Project/temporary/pi-momo-fork
AGENT_PKG=/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
SKILL_DIR=/Users/xuyingzhou/.agents/skills/apple-container-worktree-sandbox
```

The app consumes `@dyyz1993/pi-coding-agent` from:

```text
pi-agent-chat/.yalc/@dyyz1993/pi-coding-agent
```

Always edit the fork source under `pi-momo-fork/packages/coding-agent`, build it, then update the consuming app worktree. Never edit `node_modules/@dyyz1993/pi-coding-agent/dist`.

## One-Time Runtime Check

```bash
/usr/local/bin/container system status || /usr/local/bin/container system start
"$SKILL_DIR/scripts/create-shared-cache-volumes.sh"
```

If the container service was stopped, `system start` may take a moment.

## Create A Paired Sandbox

Pick a short feature name. Use the same suffix for both worktrees so the pair is obvious.

Worktrees start from committed Git state. Uncommitted or untracked files in the main working copies are not copied automatically. Commit, stash, or export a patch first if the sandbox must include them.

```bash
FEATURE=feature-permission-runtime
SANDBOX_ROOT=/Users/xuyingzhou/Project/worktrees/pi-agent-chat-sandboxes/$FEATURE

APP_WT=$SANDBOX_ROOT/pi-agent-chat
AGENT_WT=$SANDBOX_ROOT/pi-momo-fork

mkdir -p "$SANDBOX_ROOT"

git -C "$APP_MAIN" worktree add "$APP_WT" -b "codex/$FEATURE"
git -C "$AGENT_REPO" worktree add "$AGENT_WT" -b "codex/$FEATURE"
```

If you need to start from an existing branch, append the source branch to each `git worktree add` command.

## Install Dependencies

Run installs inside the paired worktrees, not in the main checkouts.

```bash
cd "$AGENT_WT"
npm install

cd "$APP_WT"
bun install --ignore-scripts
```

If host installs are already present and compatible, this step may be fast because package manager caches are shared on the host.

Use the Node version expected by the fork when building or publishing packages:

```bash
source ~/.nvm/nvm.sh
nvm use 25.2.1
```

The fork currently needs a Node runtime that can execute its TypeScript build helper scripts directly. Older Node versions may fail on `node scripts/*.ts`.

## Configure Sandbox Runtime State

Code worktrees are only half of the isolation. The Web server and spawned `pi` CLI also read runtime state from `.env`, `HOME`, and the global pi config directory. Configure those per sandbox so sessions, memory, trust decisions, extension toggles, and settings do not write into the main `~/.pi/agent` or `~/.pi-agent-chat`.

Create a sandbox home and pi config directory inside the app worktree:

```bash
mkdir -p "$APP_WT/.sandbox/home"
mkdir -p "$APP_WT/.sandbox/pi-agent"
mkdir -p "$APP_WT/.sandbox/logs"
```

Copy or create the local environment file required by the Web server, then put sandbox-sensitive overrides in a separate container-only env file:

```bash
cp "$APP_MAIN/.env" "$APP_WT/.env"

cat > "$APP_WT/.env.container" <<EOF
# Sandbox-local runtime paths. Keep these relative to /workspace because the
# Apple container mounts APP_WT at /workspace.
HOME=/workspace/.sandbox/home
LOG_DIR=/workspace/.sandbox/logs
PI_CLI_PATH=/workspace/node_modules/.bin/pi
PI_CODING_AGENT_DIR=/workspace/.sandbox/pi-agent
PI_CODING_AGENT_SESSION_DIR=/workspace/.sandbox/pi-agent/sessions
EOF
```

Keep these overrides out of `.env`. Bun auto-loads `.env` for host-side commands such as `bun install`, and `HOME=/workspace/...` would break host setup.

Skip copying only if the sandbox should intentionally use a different `.env`.

Seed the sandbox pi config. Choose one mode:

```bash
# Mode A: copy current global pi config for a realistic but isolated sandbox.
rsync -a \
  --exclude 'sessions/' \
  --exclude 'memory/' \
  --exclude 'file-store/' \
  --exclude 'tmp/' \
  --exclude '*.log' \
  "$HOME/.pi/agent/" "$APP_WT/.sandbox/pi-agent/"

# Mode B: minimal clean config.
mkdir -p "$APP_WT/.sandbox/pi-agent/extensions"
cp "$HOME/.pi/agent/auth.json" "$APP_WT/.sandbox/pi-agent/auth.json"
cp "$HOME/.pi/agent/models.json" "$APP_WT/.sandbox/pi-agent/models.json"
cp "$HOME/.pi/agent/settings.json" "$APP_WT/.sandbox/pi-agent/settings.json"
```

Use Mode A when you want the worker to behave like your normal environment. Use Mode B when testing config/bootstrap behavior or when you want fewer global extensions involved.

### Global Config Mapping Policy

Treat host global directories as seed material, not as the worker's live writable state.

Recommended mapping:

| Host source                                  | Sandbox target                                     | Mode                       | Why                                                                             |
| -------------------------------------------- | -------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------- |
| `~/.pi/agent/auth.json`                      | `$APP_WT/.sandbox/pi-agent/auth.json`              | Copy                       | Gives the worker credentials without writing back to the main auth file.        |
| `~/.pi/agent/models.json`                    | `$APP_WT/.sandbox/pi-agent/models.json`            | Copy                       | Keeps model/provider setup realistic and isolated.                              |
| `~/.pi/agent/settings.json`                  | `$APP_WT/.sandbox/pi-agent/settings.json`          | Copy                       | Allows per-worker extension/model/settings experiments.                         |
| `~/.pi/agent/mcp.json`                       | `$APP_WT/.sandbox/pi-agent/mcp.json`               | Copy if present            | MCP enablement can be worker-specific.                                          |
| `~/.pi/agent/keybindings.json`               | `$APP_WT/.sandbox/pi-agent/keybindings.json`       | Copy if present            | UI/runtime convenience, low risk.                                               |
| `~/.pi/agent/agents/`                        | `$APP_WT/.sandbox/pi-agent/agents/`                | Copy                       | Worker gets the same global agents but can test edits independently.            |
| `~/.pi/agent/extensions/` and `extensions2/` | `$APP_WT/.sandbox/pi-agent/extensions*/`           | Copy by default            | Extensions are code; copying avoids one worker mutating global extension state. |
| `~/.pi/agent/bin/`                           | `$APP_WT/.sandbox/pi-agent/bin/`                   | Copy or read-only mount    | Useful helper binaries. Prefer copy unless large.                               |
| `~/.pi-agent-chat/config.json`               | `$APP_WT/.sandbox/home/.pi-agent-chat/config.json` | Generate, not copy blindly | Must point `activeProject`/tabs to container paths such as `/workspace`.        |
| package caches                               | named volumes such as `acws-npm-cache`             | Shared cache               | Cache contents are not project state. Sharing saves install time.               |
| `~/.pi/agent/sessions/`                      | do not copy by default                             | Isolated per worker        | Sessions are exact-`projectPath` history; copying can confuse project buckets.  |
| `~/.pi/agent/file-store/`                    | do not copy by default                             | Isolated per worker        | Snapshot/object-store state is tied to sessions and can be huge.                |
| `~/.pi/agent/memory/`                        | do not copy by default                             | Isolated per worker        | Memory writes should not leak back to main unless intentionally testing memory. |
| `~/.pi/agent/tmp/`, logs, update files       | do not copy                                        | Runtime noise              | Recreated by the worker.                                                        |

For a realistic worker, seed with this pattern:

```bash
mkdir -p "$APP_WT/.sandbox/pi-agent"

rsync -a \
  --exclude 'sessions/' \
  --exclude 'file-store/' \
  --exclude 'memory/' \
  --exclude 'tmp/' \
  --exclude '*.log' \
  "$HOME/.pi/agent/" "$APP_WT/.sandbox/pi-agent/"

mkdir -p "$APP_WT/.sandbox/home/.pi-agent-chat"
cat > "$APP_WT/.sandbox/home/.pi-agent-chat/config.json" <<'EOF'
{
  "recentProjects": [
    {
      "path": "/workspace",
      "name": "pi-agent-chat",
      "lastOpened": 0,
      "pinned": false,
      "sessionCount": 0
    }
  ],
  "activeProject": "/workspace",
  "configuredPaths": [],
  "openTabs": [
    {
      "id": "proj--workspace",
      "name": "pi-agent-chat",
      "path": "/workspace"
    }
  ],
  "activeTabId": "proj--workspace",
  "pinnedSessionIds": [],
  "favoriteFolders": [],
  "disabledSkills": [],
  "disabledPlugins": {},
  "modelFavorites": []
}
EOF
```

If a worker must reuse an existing session history for diagnosis, copy only the specific encoded project bucket you need, and keep the same container project path:

```bash
mkdir -p "$APP_WT/.sandbox/home/.pi/agent/sessions"
cp -R "$HOME/.pi/agent/sessions/<encoded-project-path>" \
  "$APP_WT/.sandbox/home/.pi/agent/sessions/"
```

Do this intentionally. Bulk-copying all sessions makes the sidebar noisy and can mix host paths such as `/Users/...` with container paths such as `/workspace`.

If you need to test a local extension from the paired fork, symlink it into the sandbox pi config:

```bash
ln -s "$AGENT_WT/packages/coding-agent/extensions/<extension-name>" \
  "$APP_WT/.sandbox/pi-agent/extensions/<extension-name>"
```

Do not symlink the sandbox to the real `~/.pi/agent` directory. That would reintroduce shared mutable state.

## Publish The Runtime Into This App Worktree

Avoid `yalc push` for sandbox work. `yalc push` can update every registered installation of the package, including a main working copy that you did not intend to touch.

Build the fork from the monorepo root, then publish all local workspace packages consumed by the app/runtime:

```bash
source ~/.nvm/nvm.sh
nvm use 25.2.1

cd "$AGENT_WT"
npm run build

for pkg in packages/tui packages/ai packages/agent packages/coding-agent; do
  cd "$AGENT_WT/$pkg"
  yalc publish
done

cd "$APP_WT"
yalc add \
  @dyyz1993/pi-tui \
  @dyyz1993/pi-ai \
  @dyyz1993/pi-agent-core \
  @dyyz1993/pi-coding-agent
bun install --ignore-scripts
```

This changes only the app worktree files. Repeat this block whenever you change the fork package or one of its workspace dependencies.

Publishing only `@dyyz1993/pi-coding-agent` is not enough for this sandbox. Its runtime imports sibling workspace packages such as `@dyyz1993/pi-tui`, `@dyyz1993/pi-ai`, and `@dyyz1993/pi-agent-core`; if those are installed from registry or without `dist/`, the container backend can fail at startup.

For extension-only changes, the same rule still applies: rebuild and republish before updating the app worktree, because `extensions/` is copied into `dist/extensions/` during the package build.

## Start The Web Dev Server In A Container

The app needs two ports:

- `3100`: HTTP + WebSocket backend
- `5173`: Vite HMR frontend

Start one container for the app worktree:

```bash
WORKER="pac-$FEATURE"
HOST_GIT="$APP_MAIN/.git"

"$SKILL_DIR/scripts/run-worktree-container.sh" \
  --name "$WORKER" \
  --worktree "$APP_WT" \
  --port 5173 \
  --image docker.io/oven/bun:1-alpine \
  --memory 6G \
  --cpus 4 \
  --volume "$HOST_GIT:$HOST_GIT" \
  --volume "acws-npm-cache:/root/.npm" \
  --volume "acws-yarn-cache:/root/.cache/yarn" \
  --cmd 'apk add --no-cache git && git config --global --add safe.directory /workspace && bun install --ignore-scripts && set -a && . ./.env.container && set +a && bunx dotenv -e .env -- bunx concurrently "bunx vite --host 0.0.0.0 --port 5173" "bun src/server.ts"'
```

The explicit `set -a && . ./.env.container` is intentional. Bun auto-loads `.env` before `dotenv-cli` runs, and `dotenv-cli` does not override existing values by default.

The Git mount is also intentional. A Git worktree's `.git` is usually a file that points back to the main checkout's `.git/worktrees/...` directory using a host path. If only the worktree is mounted at `/workspace`, the container cannot follow that pointer and Git panels/RPC calls will report no repository or fail. Mounting `$APP_MAIN/.git` at the same absolute path and installing `git` keeps Git status, branches, history, and worktree operations available inside the sandbox.

Before opening the UI, make sure the sandbox app config points at the repository worktree rather than the pi runtime state directory:

```json
{
  "activeProject": "/workspace",
  "openTabs": [{ "id": "proj--workspace", "name": "pi-agent-chat", "path": "/workspace" }],
  "activeTabId": "proj--workspace"
}
```

If `activeProject` is `/workspace/.sandbox/pi-agent`, the Git panel is expected to show "Not a Git repository" because that directory stores sandbox runtime state, not source code.

Session history is also keyed by exact `projectPath`. The app scans:

```text
$HOME/.pi/agent/sessions/<encoded-project-path>/*.jsonl
```

For this sandbox, keep `HOME=/workspace/.sandbox/home` stable across every container start. If a browser tab or app config switches the active project from `/workspace` to `/workspace/.sandbox/pi-agent` or `/workspace/.sandbox/games`, the old sessions have not been deleted; they are just in a different project bucket. Add those paths back as project tabs if you need to inspect old sandbox-runtime conversations, but use `/workspace` for source-code work and Git review.

Then inspect both useful URLs:

```bash
"$SKILL_DIR/scripts/inspect-container-addresses.sh" --port 5173 "$WORKER"
"$SKILL_DIR/scripts/inspect-container-addresses.sh" --port 3100 "$WORKER"
```

Open the frontend URL:

```text
http://<container-ip>:5173
```

The frontend already treats private IPs as dev hosts and connects WebSocket RPC to the same host on port `3100`, so no code change is needed for `http://<container-ip>:5173`.

### Stable Localhost Entry

Container IPs can change when an Apple container is recreated. For day-to-day browser usage, prefer a stable Mac-side proxy instead of bookmarking the container IP directly.

For this project, use:

```text
frontend: http://localhost:55173
backend:  http://localhost:53100
```

Then open:

```text
http://localhost:55173?token=demo-test-token&ws=ws%3A%2F%2Flocalhost%3A53100%2Fws
```

The frontend port proxies to the container's `5173`, and the backend port proxies to the container's `3100`. This avoids conflicts with a host dev server already using `localhost:3100` or `localhost:5173`.

If the container is recreated and receives a new IP, restart only the stable proxy so it re-reads the current container address:

```bash
tmux kill-session -t pac-stable-proxy 2>/dev/null || true
tmux new-session -d -s pac-stable-proxy -c "$APP_WT" \
  'node scripts/sandbox-stable-proxy.mjs pac-container-sandbox-20260621 2>&1 | tee -a .sandbox/logs/stable-proxy.log'
```

Keep automation and browser tabs pointed at the localhost URL. Treat the raw `192.168.64.x` address as an implementation detail.

## UI Automation

Use one browser automation session per worker:

```bash
APP_BASE_URL=http://<container-ip>:5173
agent-browser --session "$WORKER-ui" open "$APP_BASE_URL"
agent-browser --session "$WORKER-ui" snapshot -i --selectors
```

After exploratory testing, save the useful case notes into the app worktree:

```bash
"$SKILL_DIR/scripts/capture-agent-browser-case.sh" \
  --project "$APP_WT" \
  --session "$WORKER-ui" \
  --case "$FEATURE-smoke" \
  --url "$APP_BASE_URL"
```

This writes reusable notes under:

```text
$APP_WT/.codex/ui-cases/
```

## Development Loop

For app-only edits:

```bash
cd "$APP_WT"
bun run test:unit
```

For runtime package edits:

```bash
source ~/.nvm/nvm.sh
nvm use 25.2.1

cd "$AGENT_WT/packages/coding-agent"
npm test -- extensions/coordinator/handler.test.ts

cd "$AGENT_WT"
npm run build

for pkg in packages/tui packages/ai packages/agent packages/coding-agent; do
  cd "$AGENT_WT/$pkg"
  yalc publish
done

cd "$APP_WT"
yalc add \
  @dyyz1993/pi-tui \
  @dyyz1993/pi-ai \
  @dyyz1993/pi-agent-core \
  @dyyz1993/pi-coding-agent
bun install --ignore-scripts
```

For an end-to-end smoke check against the running container:

```bash
APP_BASE_URL=http://<container-ip>:5173
WS_URL=ws://<container-ip>:3100/ws?token=demo-test-token
```

Use the WebSocket RPC template from `AGENTS.md` when validating agent session behavior.

## Cleanup

Stop the worker container:

```bash
"$SKILL_DIR/scripts/stop-worktree-containers.sh" "$WORKER"
```

Remove worktrees only after you have saved or merged the work:

```bash
git -C "$APP_MAIN" worktree remove "$APP_WT"
git -C "$AGENT_REPO" worktree remove "$AGENT_WT"
```

If a worktree has uncommitted changes you still need, do not remove it.

## Guardrails

- Mount only the app feature worktree into the dev-server container.
- Keep the app and agent runtime worktrees paired by feature name.
- Do not mount `/Users/xuyingzhou/Project/temporary` or another parent directory when the goal is isolation.
- Do not manually edit `node_modules/@dyyz1993/pi-coding-agent/dist`.
- Prefer `yalc publish` + targeted `yalc add`/`yalc update` in the app worktree over `yalc push` in sandbox work.
- Set sandbox-local `HOME`, `PI_CODING_AGENT_DIR`, and `PI_CODING_AGENT_SESSION_DIR`; otherwise runtime state can leak into the main pi config.
- Keep essential `pi-agent-chat` runtime behavior refresh-safe and reconnect-safe while developing features in this workflow.
- For file review work, keep backend/persisted review data as the source of truth; do not patch frontend diff guesses in the sandbox and call it done.
