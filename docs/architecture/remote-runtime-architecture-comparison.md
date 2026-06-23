# Remote Runtime Architecture Comparison

This note compares two remote-agent architectures that are useful references for
pi-agent-chat:

- Claude Code `ssh`: local UI and local auth proxy, remote temporary agent child.
- OpenCode `serve` / `attach`: remote standalone server, local client attaches.

The goal is to keep pi's remote runtime design explicit about where config,
credentials, sessions, memory, plugins, and tools live.

## Product Goal

For personal SSH-style remote work, pi should prefer this user experience:

```text
Configure models locally once.
Connect to a remote machine.
Use the remote project immediately.
Do not copy long-lived model credentials to the remote host.
```

This favors a Claude-style remote child architecture for the long-term SSH
experience, while keeping lightweight SSH command execution as a fallback.

## Architecture A: Claude-Style Remote Agent Child

In this model, the remote host runs a temporary agent child process. The local
app remains the UI and credential owner.

```text
Local machine
  pi-agent-chat UI / server
  auth.json / models.json / local model credentials
  local auth proxy
        |
        | ssh stdin/stdout JSONL
        | ssh -R remote auth socket -> local auth proxy
        v
Remote machine
  pi-coding-agent child process
  tools / hooks / MCP / project plugins
  remote ~/.pi/agent/settings.json
  remote ~/.pi/agent/sessions/...
  remote project .pi/settings.json
  remote project files
```

### Data Placement

| Data                    | Location                                                         | Rationale                                                                                 |
| ----------------------- | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Model credentials       | Local                                                            | Long-lived API keys/OAuth tokens should not be copied to the remote host.                 |
| Model registry/defaults | Local as source of auth; remote may receive selected model flags | Local config should make the remote usable immediately.                                   |
| Tool execution          | Remote                                                           | Bash/read/write/edit/grep/list run against the remote project filesystem.                 |
| Project config          | Remote                                                           | Remote project `.pi/settings.json` is the project-shared truth for that remote workspace. |
| User settings           | Remote for remote child runtime, local for local UI              | The remote child reads its own runtime config; the local UI keeps its own app config.     |
| Session history         | Remote                                                           | The child runtime owns the session JSONL for remote work.                                 |
| Memory                  | Remote for remote child runtime                                  | Project/runtime memory follows the runtime that owns the session.                         |
| UI tabs/profiles        | Local                                                            | App-level indexes stay in `~/.pi-agent-chat/config.json`.                                 |
| Auth proxy state        | Local, ephemeral                                                 | Bound to the current SSH session or local app process.                                    |

### Message Flow

```text
User message
  -> local pi-agent-chat
  -> remote child stdin JSONL
  -> remote agent turn
  -> remote tools/hooks/MCP
  -> model request through local auth proxy
  -> remote child stdout JSONL
  -> local UI renders messages/tool cards/permission requests
```

### Security Properties

- The remote host should not receive long-lived model credentials.
- If the remote host is compromised during an active session, it may be able to
  use the active auth tunnel to make model requests until the session ends.
- The auth proxy should be scoped to the active remote session as tightly as pi
  can reasonably make it: ephemeral socket/token, lifecycle-bound cleanup,
  request logging, and eventually rate/session constraints.

### Operational Cost

This mode needs more infrastructure than simple SSH command execution:

- Remote OS/arch probing.
- Remote package or binary deployment.
- Version compatibility checks.
- SSH process and reverse tunnel management.
- Local auth proxy.
- JSONL/RPC transport adaptation.
- Remote crash/disconnect handling.

The payoff is a complete remote runtime: hooks, MCP, project settings, memory,
and sessions naturally live with the remote project.

## Architecture B: OpenCode-Style Standalone Remote Server

In this model, the remote machine runs a self-contained server. The local app is
only an attach client.

```text
Local machine
  attach client / UI
        |
        | HTTP/WebSocket
        v
Remote machine
  standalone pi server
  remote config and credentials
  remote sessions database / JSONL
  remote tools / hooks / MCP
  remote project files
```

### Data Placement

| Data                  | Location | Rationale                                                            |
| --------------------- | -------- | -------------------------------------------------------------------- |
| Model credentials     | Remote   | The server must be able to call models even when clients disconnect. |
| Model config          | Remote   | Server is self-contained.                                            |
| Tool execution        | Remote   | Server owns the workspace.                                           |
| Session history       | Remote   | Server owns sessions and can outlive any client.                     |
| Memory                | Remote   | Server/runtime memory is local to the server.                        |
| UI client preferences | Local    | Client-only display state remains local.                             |

### Security Properties

- Easier to support detached or multi-client sessions.
- Harder to keep credentials off the remote machine.
- Requires server authentication, transport security, access control, rate
  limiting, and operational update discipline.

### Operational Cost

This mode is suitable for team servers, SaaS, or shared remote agents. It is not
ideal as the default personal SSH experience because users would have to
configure models/credentials on every remote host.

## Architecture C: SSH Command Fallback

This is the lightweight mode already useful for fast validation: the local agent
runtime stays local and only tool operations are forwarded to SSH commands.

```text
Local machine
  pi-agent-chat
  pi-coding-agent runtime
  local sessions / local memory / local plugins
        |
        | ssh host "cd remoteCwd && bash -lc <command>"
        v
Remote machine
  shell
  project files
```

This mode is valuable because it is zero-install and easy to debug, but it is not
the final full-fidelity remote architecture.

| Capability                          | SSH command fallback                          |
| ----------------------------------- | --------------------------------------------- |
| Remote install required             | No                                            |
| Remote project files                | Yes                                           |
| Remote hooks/plugins/MCP as runtime | No, unless manually invoked as remote scripts |
| Remote sessions/memory              | No                                            |
| Local model config works            | Yes, because model calls stay local           |
| Path mapping complexity             | High                                          |

## Recommended Pi Direction

Pi should keep multiple runtime modes, but each mode must have a clear boundary.

```text
project runtime kind:
  local
  ssh-command
  remote-agent-child
  remote-server
```

Recommended defaults:

1. `local`: normal local projects.
2. `ssh-command`: zero-install fallback and quick smoke path.
3. `remote-agent-child`: primary long-term personal SSH mode.
4. `remote-server`: advanced/team/SaaS mode only.

### Current Pi Mapping

The current implementation has two runnable remote shapes:

| Target shape        | Current implementation                                                                       | Transport                                   | Status                                                                                                                      |
| ------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Claude-style `ssh`  | `remote-agent-child` via `RpcClient.remoteSsh`                                               | SSH stdio JSONL                             | Runnable MVP. Single-file remote binary can be uploaded, started, and loaded with uploaded extensions.                      |
| Server/attach style | `RemoteSshProvider` starts remote `sandbox-agent.js` and connects through a local SSH tunnel | HTTP `/rpc`, `/events`, `/fs/*` over tunnel | Runnable service-mode MVP. It is not yet a public standalone server with token/TLS; SSH owns deploy, lifecycle, and tunnel. |

`RemoteSshProvider` now allocates one remote bridge process per logical user
connection. Each instance gets:

- a local tunnel port from `REMOTE_LOCAL_BASE_PORT + n`,
- a remote bridge port from `REMOTE_BRIDGE_PORT + n`,
- an isolated remote runtime directory under
  `<REMOTE_AGENT_DIR>/instances/<encoded-user-id>/`.

This is enough to simulate multi-client or multi-session remote concurrency
without bridge processes killing each other through a shared `bridge.pid`.

Do not blur these modes. In particular:

- Do not silently sync local `auth.json`, `models.json`, sessions, or memory to a
  remote host.
- Do not make every plugin detect SSH itself. Runtime ownership should decide
  where tools, settings, sessions, and memory live.
- Do not make standalone remote server mode the default for personal SSH; it
  conflicts with "configure models locally once".

## Fast Implementation Slice For Remote Agent Child

The fastest useful vertical slice is:

1. Start remote `pi --mode rpc` over SSH stdio.
2. Route existing `agent.start`, `agent.send`, `agent.getState`,
   `agent.getMessages`, and `agent.stop` through the remote RPC child.
3. Use a manually configured remote `pi` path first; postpone automatic deploy.
4. Verify remote bash/file tools really run in the remote cwd.
5. Add local auth proxy so remote model calls use local credentials without
   writing them to the remote host.
6. Bridge permission requests and responses back to the local UI.
7. Add remote package deployment and version probing.

## Validation Matrix

Remote-agent-child MVP must prove these cases before UI polish:

| Area        | Validation                                                                               |
| ----------- | ---------------------------------------------------------------------------------------- |
| Connection  | SSH child starts, RPC ping/state works, stop cleans up.                                  |
| Chat        | Send "reply OK"; assistant response streams and finishes.                                |
| Files       | Write a marker file; verify it exists on the remote host, not local shadow state.        |
| Bash        | Run `pwd && hostname`; output matches remote cwd/host.                                   |
| Sessions    | Remote session JSONL is created under the remote agent dir.                              |
| Permissions | Remote permission request appears in local UI; allow/deny response resumes remote child. |
| Hooks       | Remote project `.pi/hooks` runs with remote cwd.                                         |
| Auth        | Remote host has no long-lived model key; model calls succeed via local proxy.            |
| Disconnect  | SSH drop or remote crash reports a clear ended/disconnected state.                       |

## Verified Remote Smokes

The current SSH child smoke verified:

- local package builds into a single remote executable,
- bootstrap uploads the executable and `dist/extensions`,
- remote `pi --mode rpc` starts through SSH stdio,
- selected extensions load from the remote extension directory,
- `memory.list` and `memory.getStatus` work against the remote agent memory
  root.
- two remote RPC children can start concurrently against the same uploaded
  runtime, each with its own `PI_CODING_AGENT_DIR`; both can load extensions,
  run `bash pwd`, and call the memory channel.

The current service/attach smoke verified:

- `RemoteSshProvider` starts two remote `sandbox-agent.js` bridge processes at
  the same time for `service-alpha` and `service-beta`,
- each bridge has a distinct remote port and local tunnel endpoint,
- `/health` reports a live remote pi process for both,
- `/fs/writeFile` and `/fs/readFile` operate on the remote project,
- `/rpc` calls `agent.getState` and `agent.bash`; `agent.bash pwd` returns the
  remote project path for both endpoints.

## Relationship To Existing Workflow Doc

`docs/workflows/ssh-remote-runtime.md` describes a smoke workflow for an
SSH-backed runtime provider. This architecture note is broader: it defines the
target runtime modes and their ownership boundaries. Keep the workflow doc as
operational smoke evidence; use this document for architectural decisions.
