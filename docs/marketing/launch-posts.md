# Launch posts — Pi Agent Chat open-source promotion

Written 2026-09-15 against v1.1.1. Facts to keep in sync: Docker one-liner
exists, install scripts exist, desktop = macOS only (unsigned), multi-token
isolation just landed (in-memory ownership), desktop packaging is parked.

## GIF / demo video shot list (~40s, 1280x800, 12fps GIF or 720p MP4)

1. **0-5s** Terminal: the four Docker commands from the README, `docker compose up -d`,
   then the printed URL with token.
2. **5-12s** Desktop browser on the same server: create a session, type a real
   coding task ("add a retry button to the login form"), agent starts
   streaming, tool-call cards folding/unfolding.
3. **12-20s** Cut to **phone** (same URL): same session visible, agent still
   streaming; scroll the timeline; tap a diff it produced.
4. **20-28s** Desktop: session sidebar switching between 2-3 concurrent
   sessions; delegation badge showing a subagent running.
5. **28-35s** Rollback: open session tree, navigate to an earlier entry,
   continue from there.
6. **35-40s** End card: repo URL + "Docker · one-line script · macOS app".

Rule: no fake speedups, real prompts, real repo. Mobile shots must be a real
phone or device emulator, not devtools responsive mode.

## Show HN

**Title:** `Show HN: Pi Agent Chat – self-hosted AI coding agent UI you can drive from your phone`

**First comment (post as author):**

Hi HN! I built Pi Agent Chat because I kept leaving my desk while a coding
agent was mid-task, and there was no good way to check on it — let alone
approve a diff or steer it — from my phone.

It's a self-hosted web/desktop UI for AI coding agents:

- Server runs anywhere (Docker one-liner, or `curl … | bash`): the agent
  executes in your machine's context, so your code never leaves your box
- Browser UI works on desktop **and** phone (safe-area aware, 44px touch
  targets); the desktop app is a thin client that can point at a remote
  server, so your laptop and your phone are two views of the same sessions
- Multi-session management: process-per-session, session tree with rollback,
  mid-stream steering and queued follow-ups, delegation to sub-agents with a
  visual badge, SSH remote projects
- Bring your own key: model keys live on your server (`auth.json`), supports
  OpenAI/Anthropic-compatible providers

Architecturally: a Bun/Node gateway spawns one CLI agent process per session,
frontend talks WebSocket RPC; sessions are append-only JSONL so rollback and
history are cheap. There's also an optional sandbox mode (Docker/Cloudflare
providers) if you're sharing a server with other people.

AGPL-3.0, no telemetry. Install: <README link>. Happy to answer questions
about the process-per-session pool and the JSONL session format.

**Honest caveats to include if asked:** macOS desktop build is unsigned
(xattr workaround documented); desktop packaging (Windows/Linux) is parked;
multi-token shared-server mode is new — per-user ownership is in-memory and
restarts are fail-closed.

## r/LocalLLaMA + r/selfhosted

**Title:** `Pi Agent Chat: self-hosted, BYOK web/mobile UI for AI coding agents (Docker one-liner, AGPL)`

Body:

Tired of coding agents locked into an IDE or a subscription? Pi Agent Chat
is a self-hosted gateway + UI: the agent runs on **your** hardware, uses
**your** API keys (including local/OpenAI-compatible endpoints), and you get
a proper web UI that actually works from a phone — check progress, read
diffs, steer mid-run, roll back to any point in the session tree.

- Docker: `docker compose up -d` and scan the printed URL from your phone
- No telemetry, AGPL-3.0, sessions are plain JSONL files you own
- Optional sandbox mode (Docker/Cloudflare) for multi-user sharing

Repo + install: <link>. Feedback welcome, especially from NAS/self-host
folks — the image is linux/amd64 for now.

## V2EX（分享创造节点）

**标题：** `开源了一个自托管 AI 编程 Agent 的 Web/手机端：Pi Agent Chat（自带 key，代码不出自己机器）`

**正文：**

写代码的 Agent（Claude Code / OpenCode 这类）都很好用，但人一离开电脑就
"失联"了——任务还在跑，进度看不到，diff 没法批。所以我做了 Pi Agent Chat：

- **自托管**：一条 Docker 命令部署在自己的服务器/NAS 上，agent 在你自己
  的机器环境里干活，代码和 API key 都不出门
- **手机是真的一等公民**：浏览器打开同一个地址，看进度、读 diff、随时
  插话改需求；桌面 App 也能作为客户端连远程服务器，电脑和手机是同一批
  会话的两个视图
- **多会话**：每个会话独立进程；会话是 JSONL 追加日志，可以回滚到树上
  任意节点重来；支持子 Agent 委派，界面上能看到委派状态
- **SSH 远程项目**：agent 可以直接在远程主机的项目里干活
- AGPL-3.0，无遥测，自带 API key（支持 OpenAI/Anthropic 兼容端点）

安装（Docker）：

```bash
mkdir pi-agent-chat && cd pi-agent-chat
curl -fsSL https://raw.githubusercontent.com/dyyz1993/pi-agent-chat/master/docker-compose.yml -o docker-compose.yml
echo "AUTH_TOKEN=$(openssl rand -hex 16)" > .env
docker compose up -d
```

也有服务器一键脚本和 macOS 客户端：见 README。求反馈，尤其是 NAS/内网
部署场景的问题。
