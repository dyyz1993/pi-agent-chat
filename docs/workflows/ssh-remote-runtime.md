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
  remoteShell: 'zsh -lc',
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
    remoteShell: "zsh -lc",
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

This smoke validates the lighter SSH child-runtime path directly through
`RpcClient`. It bootstraps a local child binary plus the extension directory to
the remote host, starts multiple remote child processes, and verifies the core
runtime before any browser UI checks.

Build the fork child binary first, or reuse an existing local binary:

```bash
cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent
npm run build
```

Run the remote child verifier from the app repo:

```bash
npm run verify:remote-child -- \
  --target xyz-mac \
  --remote-project /tmp/pi-agent-remote-child-project \
  --binary /tmp/pi-remote-child-smoke-darwin-x64 \
  --extensions /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/extensions \
  --remote-runtime-dir /Users/xyz/.pi/agent/remote-runtime-child-verify \
  --remote-agent-dir /Users/xyz/.pi/agent-remote-child-verify \
  --concurrency 2
```

The command checks:

- bootstrap binary upload or cache hit
- bootstrap extension upload or cache hit
- two concurrent remote child clients
- `getState`
- `getExtensions`
- remote `bash("pwd")`
- `memory.list`
- `memory.getStatus`

Expected output includes `"ok": true`, a remote binary path under
`remote-runtime-child-verify/children/<hash>/pi`, a remote extensions directory,
and both clients reporting the remote project path.

Avoid unquoted `~` in CLI arguments. The local shell may expand it before the
remote command receives it. Prefer absolute remote paths such as
`/Users/xyz/.pi/agent/remote-runtime-child-verify`, or quote the value when
testing manually.

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
