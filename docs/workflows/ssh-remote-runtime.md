# SSH Remote Runtime Smoke

This workflow runs the agent runtime on a remote machine through SSH, then exposes it to the local app through an SSH tunnel.

## Runtime Shape

```
pi-agent-chat local server
  -> RemoteSshProvider
  -> ssh target
  -> remote sandbox-agent.js bridge
  -> remote pi-coding-agent CLI
```

The remote host does not need a global `pi` command. When `REMOTE_BOOTSTRAP_PI_PACKAGE` is enabled, the provider uploads the local `pi-coding-agent` package into a private remote runtime directory.

## Environment

```bash
SANDBOX_ENABLED=true
SANDBOX_PROVIDER=ssh
REMOTE_SSH_TARGET=xyz-mac
REMOTE_PROJECT_PATH=/Users/xyz/pi-agent-remote-smoke
REMOTE_AGENT_DIR=~/.pi/agent/remote-runtime
REMOTE_PI_AGENT_DIR=~/.pi/agent-remote
REMOTE_BRIDGE_PORT=3101
REMOTE_LOCAL_BASE_PORT=3300
REMOTE_BOOTSTRAP_PI_PACKAGE=true
REMOTE_LOCAL_PI_PACKAGE_PATH=.yalc/@dyyz1993/pi-coding-agent
REMOTE_LOCAL_PI_WORKSPACE_PACKAGES_PATH=/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages
```

`REMOTE_LOCAL_PI_WORKSPACE_PACKAGES_PATH` is optional, but recommended for local fork development because the yalc sibling packages can be lightweight stubs. The workspace path lets the SSH bootstrap upload the complete local `@dyyz1993/pi-ai`, `@dyyz1993/pi-agent-core`, and `@dyyz1993/pi-tui` packages.

## Verified Smoke

```bash
bun run test -- test/unit/sandbox/remote-ssh-provider.test.ts
```

Build the bridge bundle before provider smoke:

```bash
bash scripts/build-server.sh
```

Manual provider smoke:

```bash
bun - <<'EOF'
import { RemoteSshProvider } from './src/sandbox/providers/ssh.ts';

const provider = new RemoteSshProvider({
  target: 'xyz-mac',
  localBasePort: 3430,
  remoteBridgePort: 33141,
  remoteProjectPath: '/Users/xyz/pi-agent-remote-smoke',
  remoteAgentDir: '~/.pi/agent/remote-runtime-smoke',
  remotePiCliPath: 'pi',
  remoteNodePath: 'node',
  remoteShell: 'sh -lc',
  remotePiAgentDir: '~/.pi/agent-remote-smoke',
  childNodeOptions: '--max-old-space-size=1024',
  bootstrapPiPackage: true,
  localPiPackagePath: '.yalc/@dyyz1993/pi-coding-agent',
  localWorkspacePackagesPath: '/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages',
});

try {
  const instance = await provider.getOrCreate('smoke');
  console.log(await fetch(`${instance.endpoint}/health`).then((r) => r.text()));
  console.log(await fetch(`${instance.endpoint}/rpc`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method: 'agent.bash', params: ['pwd && node -v'] }),
  }).then((r) => r.text()));
} finally {
  await provider.destroy('smoke');
}
EOF
```

Expected output includes the remote project path and remote Node version:

```text
/Users/xyz/pi-agent-remote-smoke
v22.15.0
```

Concurrent service/bridge smoke:

```bash
npx tsx --eval '
import { RemoteSshProvider } from "./src/sandbox/providers/ssh.ts";

(async () => {
  const provider = new RemoteSshProvider({
    target: "xyz-mac",
    localBasePort: 3440,
    remoteBridgePort: 33250,
    remoteProjectPath: "/tmp/pi-agent-remote-service-project",
    remoteAgentDir: "~/.pi/agent/remote-runtime-service-smoke",
    remotePiCliPath: "/Users/xyz/.pi/agent/remote-runtime-smoke-onefile/pi",
    remoteNodePath: "node",
    remoteShell: "sh -lc",
    remotePiAgentDir: "/Users/xyz/.pi/agent-remote-service-smoke",
    childNodeOptions: "--max-old-space-size=1024",
    bootstrapPiPackage: false,
    localPiPackagePath: ".yalc/@dyyz1993/pi-coding-agent",
  });

  const users = ["service-alpha", "service-beta"];
  const instances = await Promise.all(users.map((user) => provider.getOrCreate(user)));
  try {
    const result = [];
    for (const [index, instance] of instances.entries()) {
      const bash = await fetch(`${instance.endpoint}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "agent.bash", params: ["pwd"] }),
      }).then((response) => response.json());
      result.push({ user: users[index], endpoint: instance.endpoint, localPort: instance.localPort, bash });
    }
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await Promise.all(users.map((user) => provider.destroy(user).catch(() => {})));
  }
})();
'
```

Expected output has two different local endpoints and both `bash.data.output`
values equal the remote project path.

## Remote Child Runtime Smoke

This smoke validates the standard SSH child-runtime path directly through
`RpcClient`. It bootstraps a local child binary plus the extension directory to
the remote host, starts multiple remote child processes, and verifies the core
runtime before any browser UI checks.

Build the fork child binary first, or reuse an existing local binary:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm run build
bun build --compile --target=bun-darwin-x64 \
  ./dist/bun/cli.js ./src/utils/image-resize-worker.ts \
  --outfile dist/pi-darwin-x64
bun build --compile --target=bun-linux-x64 \
  ./dist/bun/cli.js ./src/utils/image-resize-worker.ts \
  --outfile dist/pi-linux-x64
```

Use a binary matching the remote host architecture. For `xyz-mac` on x86_64
Darwin, use `dist/pi-darwin-x64`. For Linux x86_64 hosts, use
`dist/pi-linux-x64`. The app must not upload the generic local `dist/pi` when
the remote OS/arch is known, because that file may belong to the local machine's
platform.

Run the remote child verifier from the app repo:

```bash
npm run verify:remote-child -- \
  --target xyz-mac \
  --remote-project /tmp/pi-agent-remote-child-project \
  --binary /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/pi-darwin-x64 \
  --extensions /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/extensions \
  --remote-runtime-dir /tmp/pi-agent-remote-runtime-child-verify \
  --remote-agent-dir /tmp/pi-agent-remote-child-agent-dir \
  --concurrency 2
```

The command checks:

- bootstrap binary upload or cache hit
- bootstrap extension upload or cache hit
- two concurrent remote child clients
- `getState`
- `getExtensions`
- `getSkills`
- `getAgents`
- remote `bash("pwd")`
- `memory.list`
- `memory.getStatus`
- `getSystemPrompt`

Expected output includes `"ok": true`, a remote binary path under
`remote-runtime-child-verify/children/<hash>/pi`, a remote extensions directory,
and both clients reporting the remote project path. It must also report:

- `"runtimeKind": "remote-agent-child"`
- `"remoteResourcesVisible": true`
- `"localResourcesVisible": false`
- a remote sentinel skill loaded from the remote `PI_CODING_AGENT_DIR`
- a remote sentinel agent loaded from the remote `PI_CODING_AGENT_DIR`
- memory directories under the remote agent dir
- no local-only sentinel skill, agent dir, or local path leaked into the system
  prompt

## Remote Resource Sync Smoke

Standard SSH can sync local low-risk resources into a managed remote agent root
before the remote child starts. This is controlled by:

```bash
REMOTE_RESOURCE_SYNC=true              # default
REMOTE_RESOURCE_SYNC_LOCAL_AGENT_DIR=  # optional; defaults to PI_CODING_AGENT_DIR or ~/.pi/agent
REMOTE_RESOURCE_SYNC_REMOTE_AGENT_DIR= # optional; defaults to REMOTE_CHILD_REMOTE_RUNTIME_DIR/agent-resources
```

The synced remote root becomes the remote child `PI_CODING_AGENT_DIR`.

Expected managed layout:

```text
<REMOTE_SYNC_AGENT_DIR>/
  skills/
  agents/
  rules/
  .remote-resource-sync/manifest.json
```

Acceptance:

- local `skills/`, `agents/`, and `rules/` are installed under
  `<REMOTE_SYNC_AGENT_DIR>`;
- `.remote-resource-sync/manifest.json` records the bundle hash, included
  resource counts, and blocked entries;
- symlinks, `.env`, private-key-looking files, `auth.json`, `oauth.json`, and
  `models.json` are skipped;
- model credentials still stay local and model calls go through the local model
  proxy;
- memory, sessions, plugins, MCP config, and hooks are not copied by this MVP;
- `ssh-command` quick sandbox mode does not run this sync and still hides local
  skills/memory/agents.

Avoid unquoted `~` in CLI arguments. The local shell may expand it before the
remote command receives it. Prefer absolute remote paths such as
`/Users/xyz/.pi/agent/remote-runtime-child-verify`, or quote the value when
testing manually.

## SSH Command Fallback Smoke

`ssh-command` is the quick sandbox/fallback mode. It forwards selected tool
operations to the remote shell, but the local runtime must not expose local
memory, skills, agents, or plugin-owned learning state as if they were remote
resources.

Run this smoke only after the remote-child verifier passes:

1. Start the local runtime with `PI_RUNTIME_KIND=ssh-command`,
   `PI_REMOTE_SSH_TOOL_PROXY=1`, `PI_REMOTE_SSH_HOST=<host>`, and
   `PI_REMOTE_SSH_CWD=<remote-project>`.
2. Seed a local-only sentinel skill under a temporary `PI_CODING_AGENT_DIR`.
3. Query `getSkills`, `getSystemPrompt`, `memory.list`, and the learning
   channel.
4. Run `ssh <host> 'cd <remote-project> && pwd && hostname'` as a direct remote
   identity check.

Expected result:

- `getSkills` returns no user/project local sentinel skills.
- `getSystemPrompt` mentions the remote cwd but not the local agent dir.
- `memory.list` is empty or disabled for this runtime.
- learning/skill sedimentation is unavailable or disabled for this runtime.
- direct `pwd && hostname` output matches the selected SSH host and remote
  project.

## Product Acceptance Checklist

Use this checklist after SSH project opening changes. Follow the project rule:
prove RPC/runtime behavior first, then verify the browser UI.

### RPC / Runtime First

| Case                    | Action                                                                             | Expected result                                                                            |
| ----------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| SSH config discovery    | Call the SSH config/list path or open the SSH dialog with `~/.ssh/config` present. | Saved SSH aliases are shown; selecting an alias fills host, port, user, and identity file. |
| Connect and browse      | Connect to an SSH alias and list the remote home directory.                        | Directory entries come from the remote host, not the local filesystem.                     |
| Remote command identity | Run `pwd && hostname && whoami && uname -a` in the opened SSH project.             | Output matches the remote path, remote host/user, and remote OS.                           |
| Remote file write       | Ask the agent to write a marker file under the selected remote directory.          | The file exists on the remote host; no equivalent local file is required.                  |
| Extension loading       | Query extension status or run a simple extension-backed command.                   | The uploaded/runtime extension directory is used by the remote child.                      |
| Remote skills/agents    | Run the remote-child verifier sentinel check.                                      | Remote `PI_CODING_AGENT_DIR` skills and agents are visible; local sentinels are absent.    |
| Memory channel          | Call `memory.list` / `memory.getStatus` in the remote session.                     | Calls return normally against the remote agent dir, not a local memory path.               |
| Quick fallback boundary | Run the `ssh-command` fallback smoke.                                              | Local memory/skill/agent/learning resources are not exposed in fallback mode.              |
| Permission ask          | Trigger a non-whitelisted write or dangerous command.                              | The permission request appears locally, and allow/deny resolves the remote action.         |
| Git refresh             | Initialize git or create a file in the remote project through the agent.           | When the agent returns to idle, Explorer and Git state refresh without manual page reload. |

### Browser UI Second

| Area                  | Expected result                                                                                                                           |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Welcome / empty state | The main entry offers local project browsing and SSH remote project opening as separate choices.                                          |
| SSH project wizard    | The wizard is step-based: choose method, fill/select config, connect, choose/create remote directory, then open.                          |
| Recent projects       | SSH projects show an SSH badge, remote host, and remote path; local shadow cache paths are not shown as the primary identity.             |
| Project tab           | The tab name uses the opened remote directory/project name, not only the SSH alias.                                                       |
| Status panel          | The project remains visibly remote; right-side panels are display/control surfaces, not the primary place to configure a new SSH project. |
| Failure display       | Failed tool calls fall back to readable Input / Output so the user can inspect the actual remote error.                                   |

### Copyable Manual Prompts

Paste these into a remote SSH project chat when doing a manual UI pass:

```text
请直接用 bash 执行：pwd && hostname && whoami && uname -a。不要解释，直接执行工具。
```

```text
请在当前项目目录创建 pi-agent-remote-smoke.txt，内容是 hello remote，然后用 bash 验证文件存在并输出它的绝对路径。不要解释，直接执行工具。
```

```text
请在当前项目目录初始化 Git 仓库（如果已经是 Git 仓库就创建一个新文件 pi-agent-git-refresh.txt），然后告诉我当前 git status 的结果。不要解释，直接执行工具。
```

```text
请尝试把 hello 写入 /tmp/pi-agent-remote-permission-smoke.txt，并说明是否触发了权限申请。不要解释，直接执行工具。
```

```text
请尝试把 hello 写入 /var/pi-agent-remote-denied-smoke.txt。不要解释，直接执行工具。
```

## Data Ownership Quick Reference

Current SSH project UX is a remote execution workflow with local UI ownership.

| Data                        | Owner in current SSH UX          | Notes                                                                                                           |
| --------------------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Project files               | Remote                           | File tools and bash operate on the selected remote directory.                                                   |
| Tool execution              | Remote                           | `pwd`, `git`, file writes, hooks, and project commands should see the remote cwd.                               |
| Browser UI state            | Local                            | Tabs, recent project index, and SSH profiles are app-level local state.                                         |
| Recent SSH project identity | Local index with remote metadata | Store remote host/path metadata locally; do not show local cache paths as user-facing identity.                 |
| Model credentials           | Local                            | Do not copy long-lived auth/model credentials to the remote host for personal SSH.                              |
| Session history             | Runtime-owned                    | For remote-agent-child, the child runtime owns remote session JSONL; local UI can index/open it.                |
| Memory                      | Runtime-owned                    | Remote child memory follows the remote agent dir; local Codex memories are not automatically mounted or synced. |
| Project `.pi/settings.json` | Remote project                   | Shared project config belongs beside the remote project and still needs trust/permission boundaries.            |
| Local app config            | Local                            | `~/.pi/chat/config.json` is only an app index/preference store, not a permission/trust rule store.        |

Do not silently synchronize local memories, sessions, model files, or plugin
state to the remote host. If a later feature needs synchronization, make it an
explicit import/sync action with a visible direction and owner.

## Current Boundary

- This is a runtime backend provider, not the final remote-project UX.
- Session history is still owned by the local app unless a later remote project model explicitly moves it.
- The tunnel listens locally on `127.0.0.1` and forwards to the remote bridge port.
- The remote private package cache lives under `REMOTE_AGENT_DIR`.
- The service/bridge smoke is SSH-managed. It behaves like server/attach behind
  a tunnel, but it is not yet a public HTTP/WebSocket service with token auth or
  TLS.
- The remote child smoke validates runtime, extensions, and memory channels, but
  it is not a full chat UI regression.
