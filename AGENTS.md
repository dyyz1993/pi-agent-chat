# Project: pi-agent-chat

AI-powered coding agent with chat interface. Runs on macOS (Electrobun), web, and mobile browsers. Built with React 18 + TypeScript + Vite + Tailwind CSS + Zustand.

## Source Code Dependency (pi-coding-agent)

The core agent runtime (`@dyyz1993/pi-coding-agent`) is linked via **yalc** from a local fork:

- **Fork path**: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/`
- **package.json**: `"@dyyz1993/pi-coding-agent": "file:.yalc/@dyyz1993/pi-coding-agent"`
- **How to update**:
  1. Edit source in `pi-momo-fork/packages/coding-agent/src/` or `extensions/`
  2. Build: `cd pi-momo-fork/packages/coding-agent && npm run build`
  3. Push: `cd pi-momo-fork/packages/coding-agent && yalc push`
  4. This updates `pi-agent-chat/.yalc/` and `node_modules/` automatically
- **IMPORTANT**: Never manually edit `node_modules/@dyyz1993/pi-coding-agent/dist/` — changes will be lost on next `yalc push` or `npm install`. Always edit the fork source and rebuild.

### 底层库关键目录

```
pi-momo-fork/packages/coding-agent/
  src/
    core/
      file-store/
        internal-git.ts           # InternalGit 对象存储（readTree/readTreeFiles/listTreeFiles）
        file-snapshot-manager.ts  # 快照管理（getBatchFileContents/getBatchDiffs/getLiveChanges）
    modes/
      rpc/
        rpc-mode.ts               # RPC 命令路由（~50 个命令）
        rpc-client.ts             # Channel 通信（stdin/stdout JSONL）
      interactive/
        interactive-mode.ts       # 交互模式
  extensions/
    file-review/
      index.ts                    # 变更审查 extension（review.pending/approve/reject handler）
      contract.ts                 # Channel 类型契约
    # ... (其他 extensions: bash, git, memory 等)
  dist/                           # build 产物
    core/                         # tsgo 编译 src/ → JS
    extensions/                   # copy-assets 直接复制 extensions/（TS 源码，不编译）
    modes/                        # tsgo 编译
```

**build 产物规则**：

- `src/` 目录 → `tsgo` 编译为 JS 到 `dist/`
- `extensions/` 目录 → `copy-assets` 直接复制到 `dist/extensions/`（保留 TS 源码）
- 修改 extensions 后必须重新 build + yalc push，否则 dist 里是旧版本
- `yalc push` 后如果 `bun run dev:web` 已经在跑，新创建的 Agent 进程会读取更新后的 `dist/`；已经运行中的 Agent/CLI 进程需要 `agent.reload`、停止后重启 session，或重启 dev server 才会加载新的 extension 代码。
- 修改底层包后至少验证三层：底层相关单测（例如 `npm test -- extensions/coordinator/handler.test.ts`）、`npm run build && yalc push`、消费项目端口健康检查（默认 `http://localhost:3100/` 和 `http://localhost:5173/`）。

### Desktop dev 启动方式

- Web/HMR 与 App Server 默认分开看：`bun run dev:web` 会同时启动 Vite `http://localhost:5173` 和 server `http://localhost:3100`；若它们已经在跑，不要重复启动一组新进程。
- 桌面 dev app 的主流程优先使用 Vite HMR：`src/bun/index.ts` 在 dev channel 下会先探测 `http://localhost:5173`，可访问时桌面窗口直接加载该地址；因此只改 renderer/React/CSS 时，保持 5173 运行后直接打开 dev app 即可看到最新 UI。
- Vite HMR 只覆盖 renderer 页面，不会刷新桌面主进程 bundle。凡是改到 `src/bun/**`、`src/shared/handlers/**`、`src/shared/modules/**`、`src/shared/register-all-handlers.ts`、`src/gateway/**`、`electrobun.config.ts`，或新增/修改桌面 IPC/RPC handler，都必须重建并重启桌面 app。
- 稳定启动桌面端：
  1. 确认端口：`lsof -nP -iTCP:5173 -sTCP:LISTEN` 与 `lsof -nP -iTCP:3100 -sTCP:LISTEN`。
  2. 若 `build/dev-macos-arm64/PiAgentChat-dev.app` 不存在，或改过任何桌面主进程/IPC/RPC 相关文件，先执行 `npx electrobun build --env=dev`。
  3. 打开桌面端：`open -na build/dev-macos-arm64/PiAgentChat-dev.app`。
- 如果桌面端黑屏、窗口不出现、菜单/剪贴板/窗口 resize 逻辑仍是旧的，先退出旧的 `PiAgentChat-dev` 进程，再重新执行 `npx electrobun build --env=dev && open -na build/dev-macos-arm64/PiAgentChat-dev.app`。
- `npm run dev` / `electrobun dev --watch` 适合调 Electrobun 壳本身，但日常验证 renderer 最新效果时优先用上面的 “5173 + dev app” 流程，避免 watch 进程和现有 web/server 进程互相混淆。
- 桌面 renderer 可通过 `PI_ELECTROBUN_RENDERER` 切换；默认 `cef`，用 `PI_ELECTROBUN_RENDERER=native` 显式回退。语音输入、第三方输入法或文本服务兼容性排查时，可用默认桌面构建验证 `cef` 行为，再用 `npm run build:desktop:native` 或 `npm run dev:desktop:native` 做 native 对照。

### Desktop main-process freshness checks

- 典型症状：Web 端正常，但桌面端仍报旧错误；新 RPC 在桌面端返回 `Method not found: <method>`；菜单、剪贴板、窗口 resize、桌面预览读文件等行为不更新；历史 preview 卡片在桌面端显示旧 fallback（例如 `No path available for preview`）。
- 先判断变更归属：
  - 只改 `src/mainview/**`、CSS、locale、前端 store/component：刷新 5173 或重开 dev app 通常足够。
  - 改 `src/shared/handlers/**`、`src/shared/modules/**`、`src/bun/**`、`src/gateway/**`、`src/shared/register-all-handlers.ts`：必须重建桌面 bundle。
- 标准刷新流程：
  1. `pkill -f '/Users/xuyingzhou/Project/temporary/pi-agent-chat/build/dev-macos-arm64/PiAgentChat-dev.app' || true`
  2. `npx electrobun build --env=dev`
  3. `open -na build/dev-macos-arm64/PiAgentChat-dev.app`
  4. `pgrep -fl 'PiAgentChat-dev|Resources/main.js|bun/index.js'` 确认新进程已启动。
- 若怀疑 bundle 仍旧，检查生成时间和 bundle 内容：`stat -f '%Sm %N' -t '%Y-%m-%d %H:%M:%S' build/dev-macos-arm64/PiAgentChat-dev.app/Contents/Resources/app/bun/index.js`，再用 `rg '<method-or-symbol>' build/dev-macos-arm64/PiAgentChat-dev.app/Contents/Resources/app/bun/index.js` 确认新 handler 已打进桌面包。
- 调桌面专属 RPC 时，必须直接在桌面页验证，而不是只看 Web。CEF devtools 默认端口是 `9223`，可以用 Playwright CDP 连接后在页面里调用 `apiClient.call(...)`，确认运行中的桌面进程真的注册了该 method。
- 这类问题不要先改 preview/card/UI fallback。先证明：session JSONL 是否有数据、前端 store 是否有数据、文件是否存在、桌面 RPC 是否存在。若前三者都正常而桌面 RPC `Method not found`，根因就是桌面主进程 bundle 未刷新。

### Local paired worktree stack

- Worktree 能力归属和目录命名先读 `docs/architecture/worktree-capability-boundary.md`。当前完整 paired worktree stack 是项目级 orchestration，不是插件能力，也还不是底层 runtime 完整能力；不要把 `pi-agent-chat` + `pi-momo-fork` 的端口、yalc、paired fork 规则直接塞进 `pi --worktree`。
- 如果任务需要 app worktree 与本地依赖 fork 一起隔离运行，先读 `docs/workflows/local-paired-worktree-stack.md`。
- 这类任务不只创建 Git worktree；还必须显式处理源码拓扑、依赖安装策略、yalc/local package、`.env`、`PI_CLI_PATH`、`PI_APP_CONFIG_DIR`、端口 registry、全局命令/bin、build/dist、logs/pid、敏感配置和验证流程。
- 本机 Web dev 默认使用 `scripts/worktree-create.sh` / `scripts/worktree-dev.sh` / `scripts/worktree-common.sh` 管理 stack；端口和配对关系记录在 `~/.pi/chat/worktrees/registry/`，结构化 stack 视图记录在 `~/.pi/chat/worktrees/<worktree-id>/manifest.json`。
- `docs/workflows/apple-container-paired-worktree-sandbox.md` 是容器隔离方案；本机多端口、多 worktree 启动优先使用 `local-paired-worktree-stack.md`。

### Remote runtime 架构参考

- 远程 Agent/SSH/server attach 相关设计先读 `docs/architecture/remote-runtime-architecture-comparison.md`。
- 该文档明确区分 `ssh-command`、`remote-agent-child`、`remote-server` 三种 runtime 边界，并对比 Claude Code `ssh` 与 OpenCode `serve/attach` 的配置、密钥、会话、记忆归属。
- `docs/workflows/ssh-remote-runtime.md` 是现有 SSH runtime provider 的 smoke/操作文档，也包含当前 SSH 项目 UX 的验收清单和可复制手工测试 prompts。
- 涉及会话历史、memory、plugins、auth proxy 的归属时，以架构对比文档为准；涉及“现在怎么验证 SSH 项目是否跑通”，以 workflow 文档为准。

### Remote runtime 产品语义

- Claude Code `ssh` 类场景的产品语义是“临时远程执行”：把 agent binary/runtime assets 临时部署到远程主机，通过 SSH stdin/stdout 或 tunnel 工作，并把 API auth 反向代理回本机；目标是不用用户先在远程完整安装，也不默认携带本机长期状态。
- `ssh` 主要用于快速在远程项目目录跑任务：远程构建、测试、部署、看日志、临时验证 Linux/GPU/内网环境，或在远程 git checkout 上做短期修改。它不是把本机 memory/skills/rules/MCP/session 全量搬到远程的同步模式。
- Claude/OpenCode `server` / `serve` / `attach` 类场景的产品语义是“远程常驻服务”：远程机器起一个可复用 agent server，session、memory、tools、hooks、MCP、项目配置自然归远程 runtime；本地 UI/client 只是连接和控制。
- pi 的 SSH 默认边界应靠近 Claude-style `ssh`：本地保留 UI、账号认证、最近项目索引和同步管理入口；远程负责项目文件、tool execution、runtime-owned session/memory/skills/plugins。
- 不要把本机扫描到的 skill/memory/rule/plugin 物理路径注入给远程 Agent。若远程需要使用本机资源，必须通过显式 install/import/sync 把经过过滤的 bundle 安装到远程 runtime，再由远程 registry 暴露为可用资源。
- Standard SSH 的本地资源同步入口是 Remote Resource Sync，不是路径透传。MVP 只同步低风险资源：`<PI_AGENT_DIR>/skills/`、`<PI_AGENT_DIR>/agents/`、`<PI_AGENT_DIR>/rules/`；不同步 `auth.json`、`oauth.json`、`models.json`、memory、plugins、MCP、hooks、sessions 或任意本机绝对路径引用。
- Remote Resource Sync 必须写入远端 managed agent root（默认 `<REMOTE_SYNC_AGENT_DIR>`），然后通过远端 child 的 `PI_CODING_AGENT_DIR=<REMOTE_SYNC_AGENT_DIR>` 加载。不要覆盖远端用户自己的 `~/.pi/agent`，除非用户显式配置同步目录并接受其管理语义。
- Remote Resource Sync 必须维护 manifest/hash（当前为 `.remote-resource-sync/manifest.json`），用来判断已同步、缺失、变更和 blocked 项；同步过程要跳过软链、`.env`、密钥文件、`auth.json`、`oauth.json`、`models.json` 等敏感文件。
- 新增 SSH 相关功能时先判断它属于“临时远程执行”还是“远程常驻服务”。如果需求需要自动双向同步、长期远程状态、多客户端共享或团队访问，优先归入 server/attach 语义，不要偷偷塞进 `ssh` fallback。

### Preview / File Rendering 边界

- 预览文件时不要把远程项目路径直接交给浏览器 `file://`。`file://` 只适合本机真实文件，SSH shadow path 或远端绝对路径都会导致桌面端/Web 端出现 `No path available for preview`、broken image 或 renderer load error。
- Web/mobile 的文件预览应统一走 gateway `/file/<encoded-path>` 或 `/fs/<path>`，gateway 负责把 remote project 的本地 shadow path / 远端 absolute path 映射到 SSH 读取。
- 桌面 IPC 没有 HTTP `baseUrl` 时，媒体类预览（image/video/audio/pdf/html）应通过 `file.readBinaryFile` / `file.readFile` RPC 读取，再生成 data URL 或直接渲染内容；不要在 desktop IPC 中新增裸 `file://` 预览路径。
- Explorer 图片预览同样走 RPC：SVG 使用 `file.readFile`，栅格图片使用 `file.readBinaryFile`，这样本地与 SSH 远程项目共享同一套 path resolver。
- 新增 preview 类型时至少覆盖两类测试：gateway remote shadow path → SSH 读取；desktop/RPC path → data URL 或 content 渲染。

### Coordinator 委派索引规则

- `coordinator` 的委派任务索引是父会话感知子任务的持久化入口，存储在父会话目录的 `coordinator-tasks.json`。
- 不要对 stopped/completed/idle 委派任务做时间驱动的静默自动清理；JSONL 会话文件永久保留时，委派索引也应保留到用户或 Agent 明确调用 `session_delegate_remove` / `session_delegate_clear_stopped`。
- `buildPrompt()` 应展示当前 store 中的委派任务，不要按年龄过滤，否则父 Agent 刷新、重连或长时间运行后会失去委派历史。
- 如果将来必须新增清理机制，必须是显式、可配置、可观测的行为，并向前端/父会话发出状态变化事件，不能静默删除。

### Asset Store / 视觉输入规则

- 涉及图片、二进制文件、OCR、视频帧、模型视觉输入、OSS/signed URL 或文件预览的改动，先读 `docs/architecture/asset-store-and-vision-inputs.md`。
- 内部优先沉淀 `AssetRef`；provider adapter 作为最后一层再决定传 base64、data URL、remote URL 或调用视觉 fallback。
- 能插件化的文件处理必须走 `FileResolver` / `AssetStore` / vision provider，不要把 pdf/csv/video/docx/OCR/OSS 等类型逻辑继续硬编码进 `read` 或 CLI `@file`。
- `read` 工具和 CLI `@file` 可以保留 base64 兼容，但文件类型处理应由 resolver 接管，并尽量附带 asset metadata，方便 UI 预览、重放、远程上传和后续视觉工具调用。
- 大文本、CSV、log、JSONL 等非二进制文件也必须走文本 resolver 的共享预算；`@file` 不允许绕过截断把整文件直接注入模型上下文。默认上限与 `read` 对齐：2000 行或 50KB，超出后用 offset/search/parser/resolver 继续读取。
- 项目私有 asset 状态写入 `<PROJECT_USER_STATE_DIR>/assets/...`；不要写进 `~/.pi/chat/config.json`，也不要默认写进仓库。
- 接 OSS/S3/UCloud 等对象存储时必须作为 `AssetStore` backend 接入，默认 signed URL，不能把公网 URL 作为唯一来源；保留本地 fallback 以支持重放和 URL 过期恢复。
- 视觉识别入口必须作为 provider/router 配置处理，不要硬编码进 `read` 或 `@file`。目标路由顺序是 native model vision、OCR、MCP vision、xBrowser/Doubao、Bash CLI provider/fallback；当前如果还没有统一开关，必须在文档和 `pi-expert` 中明确“未实现统一开关”和临时调用方式。
- Bash 可以调用配置好的 CLI 解析图片/视频，但必须使用 allowlisted argv 模板、超时、输出预算和结构化结果；不能把用户路径或 prompt 拼成 shell 字符串，也不能把普通元数据工具伪装成语义视觉能力。

### Pi Expert 角色同步规则

- 全局 Pi 专家角色是 `~/.pi/agent/agents/pi-expert.md`；它必须掌握当前 Pi 框架的配置、模型、代理、preview、hooks、Agent 定义、委派/子任务、插件、worktree/yalc 开发流程。
- 维护大纲见 `docs/architecture/pi-expert-knowledge-map.md`。任何改动如果涉及以下内容，必须同步更新该文档和 `~/.pi/agent/agents/pi-expert.md`：OSS/AssetStore/FileResolver、`@file`/`read` 文件处理、视觉 provider/OCR/MCP/xBrowser 路由、模型/auth/settings 配置、Bridge/Preview/Proxy URL、hooks 配置来源、Agent frontmatter 字段、session/委派/subagent/fork 语义、worktree/端口/yalc 流程、持久化路径。
- 如果新增“使用型 Agent”和“开发型 Agent”，开发型 Agent 必须引用或继承 pi-expert 的知识入口；使用型 Agent 可以只引用必要的运行/配置说明，不需要包含底层构建细节。
- 不要把 OpenCode 风格的 `permission: "*": allow` 当作 Pi Agent 文件格式；Pi Agent 以 `permissionMode` / `permissionProfile` 和 `packages/coding-agent/src/core/agent-types.ts` 的字段解析为准。

### Project Issue Orchestration Agents

- 当前项目级 Agent 放在 `.pi/agents/`，只服务本仓库及其 paired fork，不应提升为全局 Agent，除非角色已经抽象成通用能力。
- 项目级 issue 处理 workflow 见 `docs/workflows/project-issue-orchestration.md`；角色提示词只保留入口和职责，流程细节以该文档为准。
- `.pi/agents/pi-issue-leader.md` 是项目 Issue 协调者：负责拉取/理解 issue、拆分并行任务、指定执行 Agent、追踪 delegate、组织 Review、规划合并和 worktree 清理；它不直接写代码、不运行 bash。
- `.pi/agents/pi-worktree-dev.md` 是项目开发执行者：负责单个 issue 的隔离 worktree/paired fork 开发、端口 registry、yalc/build、验证和 PR 风格收口。
- `pi-issue-leader` 委派开发任务时默认指定 `agent: "pi-worktree-dev"`；涉及底层框架、Agent 格式、AssetStore/FileResolver、Preview/Proxy、hooks、配置或 worktree 流程时，任务说明必须要求执行者阅读 `AGENTS.md`、`docs/workflows/local-paired-worktree-stack.md` 和 `~/.pi/agent/agents/pi-expert.md` 的相关章节。
- `pi-issue-leader` 和 `pi-worktree-dev` 默认给完整工具权限；不要通过工具白名单隐藏能力。行为边界写在 workflow/prompt 中，权限层保持足够完整，避免端口诊断、构建、测试、issue 拉取或收口时被卡住。
- 在当前 Agent parser 中，省略 `tools` 表示不限制工具、可使用全部已注册工具；写 `tools` 会变成白名单。项目编排/开发 Agent 不要为了消除 recommended-field 提示而写窄工具列表。
- 每个 issue/PR-style change set 必须有 validation packet：自动测试 case、人工验收 case、证据、negative/edge case 和未测风险。没有 validation packet 不能进入合并；用户可以显式 waive，但不能静默跳过。
- 默认生命周期是 issue/local ledger → branch/PR-style change set → Review → User Acceptance → merge/close issue。merge 后不默认再开 issue；只有遗留、回归、用户新要求或 acceptance 失败时才创建 follow-up issue。
- UI/产品行为变更必须提供可执行的人工验收 case：Setup、Steps、Expected、Evidence、Status。截图或浏览器自动识别只能作为辅助证据，除非用户明确授权代验收，否则人工验收状态仍为 pending。
- 关联 fork 的开发结果默认面向当前关联 fork 的分支/PR-style change set，不要写成 upstream PR，除非用户明确要求。
- 关联 fork 并行开发也必须用 worktree：一个 issue/slice 对应 app worktree + paired fork worktree。fork 代码改完后按 `npm run build`、必要时 `yalc push`、再重启/reload app/Agent session 的顺序处理。
- 端口和配对关系从 `./scripts/worktree-dev.sh list`、`~/.pi/chat/worktrees/<worktree-id>/manifest.json`、`~/.pi/chat/worktrees/registry/*.env`、worktree `.env`、`logs/dev.log` 和 `lsof` 查询；不要让 Agent 猜端口。
- 启动项目 stack 时不要手工复制 env 或猜端口。新建并启动用 `scripts/worktree-create.sh <slug> --dev --start --with-agent-fork`；启动/修复已有 worktree 用 `scripts/worktree-dev.sh <app-worktree> --with-agent-fork --agent-path <paired-fork> --agent-build`；只准备 env/registry 用 `--no-start`。
- 启动脚本会从主仓 `.env` 派生 worktree `.env` 并重写 `PORT`、`PI_CLI_PATH`、`PI_CODING_AGENT_DIR`、`PI_APP_CONFIG_DIR`，启动时导出 `VITE_API_TARGET`、`VITE_PORT`、`VITE_AUTH_TOKEN`。worker 必须在回报里列出这些实际值。
- 默认依赖策略是 app `--link` / fork `--agent-link`；改依赖、lockfile 或 native deps 时才用 `--install` / `--agent-install`。仅 CLI/runtime fork 改动通常 build + `PI_CLI_PATH` 即可；app import 的 package API/type 改动才需要 `yalc push`。
- 新增或修改这类项目级 Agent 时，需要同步检查：frontmatter 是否只使用 `agent-types.ts` 支持的字段、是否声明当前项目拓扑、是否说明 app/fork 双仓边界、是否包含回报格式、是否避免直接合并/删除 worktree。

## Theme & Design System

### Token Location

All design tokens are defined as CSS custom properties in `src/mainview/index.css` under `:root` (light) and `html.dark` (dark).

### Token Categories

| Category   | Prefix                               | Example                                          |
| ---------- | ------------------------------------ | ------------------------------------------------ |
| Background | `--color-bg-*`                       | `--color-bg-primary`, `--color-bg-elevated`      |
| Text       | `--color-text-*`                     | `--color-text-primary`, `--color-text-secondary` |
| Border     | `--color-border-*`                   | `--color-border-primary`, `--color-border-focus` |
| Accent     | `--color-accent*`                    | `--color-accent`, `--color-accent-muted`         |
| Status     | `--color-success/warning/error/info` | `--color-success`                                |
| Safe Area  | `--safe-area-*`                      | `--safe-area-top`, `--safe-area-bottom`          |
| Spacing    | `--spacing-*`                        | `--spacing-sm`, `--spacing-lg`                   |
| Radius     | `--radius-*`                         | `--radius-sm`, `--radius-xl`                     |
| Shadow     | `--shadow-*`                         | `--shadow-sm`, `--shadow-lg`                     |
| Z-index    | `--z-*`                              | `--z-overlay`, `--z-modal`                       |
| Touch      | `--touch-target-min`                 | `44px` (Apple HIG minimum)                       |
| Transition | `--transition-*`                     | `--transition-fast`, `--transition-normal`       |

### Theme Store

`src/mainview/stores/use-theme-store.ts` — Manages `light`/`dark`/`system` mode, toggles `dark`/`light` class on `<html>`, persisted to localStorage key `pi-theme`.

### Tailwind Integration

`tailwind.config.js` extends spacing with `safe-top`, `safe-bottom`, `safe-left`, `safe-right` using CSS variables. Use `p-safe-top`, `m-safe-bottom` etc. in Tailwind classes.

### Popover / Menu Rules

- Floating dropdowns, anchored menus, and cross-panel popovers should use `src/mainview/components/primitives/AnchoredPopover.tsx`.
- Use local `absolute bottom-full/top-full` positioning only when the trigger and popover share the same small, unclipped `relative` container.
- Do not wrap a `fixed` popover in an `absolute` parent and expect the parent to anchor it; fixed popovers must calculate against the trigger or use `AnchoredPopover`.
- Detailed rules and the current component map live in `docs/ui/popover-menus.md`. Any UI component change that adds, removes, or changes popover/menu behavior must update that document when the pattern changes.

### Button / Icon Density Rules

- Reusable command buttons should use `src/mainview/components/primitives/Button.tsx`, `IconButton.tsx`, or `CopyAction.tsx` before adding raw `<button>` styles.
- Do not use 44px `IconButton size="md"` as the default for every header action. It is for mobile/touch-sized controls and full-window close targets; dense desktop toolbars should prefer 28-32px visual buttons.
- Separate visual density from touch target requirements: card/tool rows can be visually compact, but mobile/touch surfaces still need at least a 44px target.
- Detailed density rules, current component map, and migration checklist live in `docs/ui/button-density.md`. Any UI change that adds or changes repeated button/icon-button patterns must update that document when the pattern changes.

## Responsive Design

### Breakpoints

| Name    | Width       | Store              |
| ------- | ----------- | ------------------ |
| mobile  | < 640px     | `use-layout-store` |
| tablet  | 640–1024px  | `use-layout-store` |
| desktop | 1024–1440px | `use-layout-store` |
| wide    | >= 1440px   | `use-layout-store` |

### Mobile Conventions

- Sidebars become 85% width overlays with `bg-black/50` backdrop
- Chat `SideNav` must render on mobile and tablet. Do not hide, skip, or breakpoint-gate it as a performance shortcut; mobile performance work must preserve the right-side navigation rail and its active/selection behavior.
- Pin/collapse buttons hidden (`max-sm:hidden`)
- QuickActionToolbar only renders on mobile/tablet
- Tab close buttons always visible on mobile (no hover needed)
- Touch targets minimum 44px on all interactive elements
- `viewport-fit=cover` is set, so `env(safe-area-inset-*)` works

### Chat Content Surfaces

Main chat area surfaces must be designed around stable regions, not ad-hoc modal decisions:

1. **Top Toolbar** — token usage, panel toggles, notifications, review/status entry icons. This region should stay stable for chat-scoped previews and only be covered by true workspace/fullscreen workflows.
2. **Content Stage** — message list by default; image/text/markdown/code/file/single-diff previews should render here when they are part of the chat workflow.
3. **Composer Dock** — input/attachment/goal controls. Keep it visible when the user is likely to ask follow-up questions or append selected content; hide it for immersive edit/review workflows.

Surface types:

| Surface                      | Use for                                                                       | Host / current entry points                                                                                                                                                 | Composer default |
| ---------------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Inline card                  | Lightweight recognition inside message flow                                   | `src/mainview/components/chat/preview/*.tsx`, `src/mainview/components/chat/FileAttachment.tsx`                                                                             | visible          |
| Chat-scoped preview surface  | Image large view, markdown/text reading, read-only code, single-file diff     | Target host: chat content stage in `src/mainview/layouts/MainLayout.tsx`; current state: `src/mainview/stores/use-chat-overlay-store.ts`                                    | visible/compact  |
| Workspace fullscreen surface | Review, multi-file diff, file editor, running preview, settings/project flows | `src/mainview/components/change-review/ChangeReviewPanel.tsx`, `src/mainview/components/settings/SettingsPanel.tsx`, `src/mainview/components/welcome/SshProjectDialog.tsx` | hidden           |
| Modal dialog                 | Short confirmation, small form, destructive action confirmation               | `src/mainview/components/primitives/ModalDialog.tsx`                                                                                                                        | blocked          |

Current scattered preview/editing entry points to check before adding a new one:

- `src/mainview/layouts/MainLayout.tsx` currently hosts `FileOverlay`, `DiffOverlay`, `CodeExpandOverlay`, and `MarkdownExpandOverlay` over the chat area.
- `src/mainview/stores/use-chat-overlay-store.ts` currently models `diff | file | expand | markdown`; new chat-scoped content surfaces should extend or replace this store instead of adding unrelated local state.
- `src/mainview/components/primitives/ImageViewerOverlay.tsx` is body-portaled because message-triggered fullscreen previews must not live inside message rows.
- `src/mainview/components/chat/preview/HtmlCard.tsx` and `PdfCard.tsx` currently use `IframeFullscreenOverlay`; when unifying surfaces, route their expanded mode through the shared preview host.
- `src/mainview/components/file-preview/FileOverlay.tsx` and `src/mainview/components/diff/DiffOverlay.tsx` are chat-area overlays today; keep simple read-only states chat-scoped, but move editing, review, and multi-file flows to workspace fullscreen.
- `src/mainview/components/change-review/ChangeReviewPanel.tsx` is review workflow UI and should not be treated as a small modal or inline preview.

Decision rules:

- Do not create a new `fixed inset-0` surface from inside a message card, preview card, or virtualized row. Hoist it to the chat/layout host or portal to `document.body`.
- If the user is still in a conversational "look at this and ask/follow up" mode, prefer chat-scoped preview and keep the composer visible or compact.
- If the user is editing, approving, rejecting, comparing many files, or running an app preview, use a workspace fullscreen surface and hide the composer.
- If the operation can be answered with one sentence or one button, use `ModalDialog`; do not put rich file content, diff, code editor, or review UI in a modal dialog.
- Any UI change that adds or changes image/text/markdown/code/diff/file/review/preview surfaces must update this section and the current entry-point map above.

### Composer Placeholder / Context Block Rules

Composer-side references must be modeled as structured placeholder/context blocks, not as unrelated ad-hoc strings inserted into the textarea.

Use this rule for selected text quotes, `@file`, future `@agent` references, memory snippets, rules, skills, URL/page captures, screenshots, terminal excerpts, and any other context that should travel with the next user message.

Expected UX:

- Render placeholders in the composer input frame above the textarea: visually part of the input box, but technically outside the raw textarea.
- Render composer tools such as attach, image, goal, future Skill/Agent insertion, and slash helpers in the composer frame action row; avoid floating a separate vertical toolbar beside the input on desktop.
- Default to a compact/collapsed chip or row that shows type, title, source, and a small size/count hint.
- Let the user expand a placeholder to preview the full content inline, then collapse it again.
- Keep the raw textarea focused on the user's own message; do not dump long quoted context directly into the input when a structured placeholder is available.
- Pasting short plain text into the textarea should remain normal text input; pasting long, multiline, or fenced-code text should create a text quote placeholder in the composer frame.
- When a placeholder must serialize into the outbound prompt, use a deterministic renderer per type. Text selections should serialize as fenced code blocks, not blockquote spam.
- Reuse one renderer/store path for all placeholder types instead of creating one-off local state in individual buttons, cards, or message rows.
- Placeholder renderers must use the shared design tokens and dense composer style; avoid nested cards inside the composer.
- The canonical client state is `use-composer-placeholder-store`; selected text, future `@agent`, Skill, slash command, file/image, memory, rule, and diagnostic snippets should extend that store and renderer instead of adding separate composer-side state.

### Settings Surface

- `SettingsPanel` is a full-window overlay surface, not a centered desktop modal.
- Desktop/tablet settings should use the whole app window with a persistent two-level left navigation, full-height content area, and bottom action bar.
- Mobile may keep the compact full-screen overlay pattern with horizontal tab navigation, but it must still respect safe-area and 44px touch targets.

### Safe-Area Rules for Fullscreen Overlays

ALL `fixed inset-0` fullscreen components MUST:

1. Add `paddingTop: "calc(<base-padding>rem + env(safe-area-inset-top, 0px))"` on the header
2. Add `paddingBottom: "env(safe-area-inset-bottom, 0px)"` on the container or footer
3. Close buttons must be minimum 44px touch target (`p-2` + `w-4 h-4` icon = ~40px)
4. Every fullscreen page MUST have a visible close/exit button
5. Message-triggered fullscreen previews must be hoisted out of message DOM via `createPortal(document.body)` or a layout-level overlay host; never render `fixed inset-0` directly inside a message row or virtualized list item.

Files that implement this pattern:

- `src/mainview/components/tab-bar/TabBar.tsx` — top safe-area
- `src/mainview/components/chat/ChatPanel.tsx` — bottom safe-area
- `src/mainview/components/bash-panel/BashPanel.tsx` — both
- `src/mainview/components/chat/preview/UrlCard.tsx` — fullscreen header
- `src/mainview/components/chat/preview/HtmlCard.tsx` — fullscreen header
- `src/mainview/components/chat/preview/PdfCard.tsx` — fullscreen header
- `src/mainview/components/chat/mermaid/MermaidFullscreen.tsx` — fullscreen header
- `src/mainview/components/project-picker/ProjectPickerDialog.tsx` — mobile view

## Project Structure

```
src/
  gateway/                    # HTTP 路由、WebSocket 处理、IPC 传输、代理注册
  sandbox/                    # 沙箱管理（Cloudflare/Local/SandboxBox 提供者）
  server.ts                   # 服务启动入口
  server-config.ts            # 服务配置
  shared/                    # 前后端共享层（Electron main + renderer 共用）
    modules/
      agent.ts               # Agent RPC 类型（含所有 method 的 params/result）
      coordinator.ts         # Coordinator 委派类型
      session.ts             # Session 管理类型
      # ... (17 modules total: bash, change-review, file, git, hooks, lsp, memory, etc.)
    handlers/
      agent.ts               # Agent RPC handler（前端侧，调用 process-manager）
      session.ts             # Session handler
      coordinator.ts         # Coordinator handler
      # ... (17 handlers total: bash, change-review, file, git, hooks, lsp, etc.)
    agent/
      process-manager.ts         # CLI 进程池核心（spawn/kill/restart）+ 组合根
      agent-process-pool.ts      # LRU 进程池管理
      session-message-reader.ts  # JSONL 读取 + 消息缓存 + 消息检索
      event-handler.ts           # Agent 事件分发 + 7 个 Channel handler
      coordinator-handler.ts     # Coordinator 委派/子代理管理
      coordinator-delegate-operations.ts  # 委派操作的提取实现
      agent-start-operations.ts  # 启动流程操作
      agent-stop-operations.ts   # 停止流程操作
      # ... (37 files total: runtime client, channel system, adapters)
    lib/
      project-config.ts      # ~/.pi/chat/config.json 读写（串行队列 + 备份保护）
      session-scanner.ts     # 磁盘 session 扫描器（用于进程恢复）
      logger.ts              # createLogger 工厂
      with-timeout.ts        # Promise 超时包装
      # ... (9 files total: json-to-yaml, linked-projects-config, paths, etc.)
    rpc-schema.ts            # RPC Server/Client 创建工具（shared 根目录）
    register-all-handlers.ts # Handler 统一注册入口
  mainview/                  # 前端渲染层
    index.css                # Design tokens + global styles
    layouts/                 # MainLayout, breakpoint logic
    components/
      tab-bar/               # Top project tabs
      chat/                  # Chat UI, messages, previews
      left-sidebar/          # Session list
      right-sidebar/         # Status panel (deprecated, merged into status-panel)
      status-panel/          # Agent/Model/Extension/Skill 状态面板
      agent-panel/           # Agent 选择面板
      change-review/         # 变更审查面板
      model-picker/          # 模型选择器
      project-picker/        # Project selection dialog
      bash-panel/            # Terminal output
      settings/              # Settings modal
      diff/                  # Diff viewer
      file-preview/          # File preview overlay
      explorer/              # 文件浏览器侧栏
      git/                   # Git 面板（分支选择/提交）
      hooks-panel/           # Hooks 面板
      memory-panel/          # Memory 面板
      rules-panel/           # Rules 面板
      snapshot-panel/        # Snapshot 面板
      session-sidebar/       # Session 侧栏
      primitives/            # 基础 UI 组件
      debug/                 # 诊断面板
      rpc-panel/             # RPC 调试面板
      theme/                 # 主题切换
    stores/                  # Zustand stores (45 files: 27 stores + 18 helpers)
    hooks/                   # Custom hooks
    lib/                     # API client, i18n, logger
    utils/                   # 工具函数（clipboard, constants, file-utils 等）
    locales/                 # i18n 翻译文件（en/ + zh-CN/）
```

## RPC 架构

前端通过 WebSocket 与 fork CLI 进程通信，分层如下：

```
前端 UI (StatusPanel, ChatPanel, ...)
  │
  ├─ apiClient.call("agent.xxx", params)        # src/mainview/lib/api-client.ts
  │     │
  │     ▼
  ├─ RPC 类型检查                                # src/shared/modules/agent.ts (类型定义)
  │     │
  │     ▼
  ├─ Handler 处理                                # src/shared/handlers/agent.ts
  │     ├─ 前端逻辑（如 project-config 读写）
  │     └─ 转发到 CLI 进程
  │           │
  │           ▼
  └─ AgentProcessManager (组合根)               # src/shared/agent/process-manager.ts
        ├─ SessionMessageReader                  #   JSONL 读取 + 消息缓存
        ├─ AgentEventHandler                     #   事件分发 + Channel 处理
        ├─ CoordinatorHandler                    #   委派/子代理管理
        ├─ spawn CLI 进程（含 Sandbox 模式）
        ├─ Channel 通信（类型安全 ChannelTypeRegistry）
        └─ 事件路由（handleEvent → agent-event-routing）
              │
              ▼
        fork CLI (pi-coding-agent)               # .yalc/@dyyz1993/pi-coding-agent/dist/
          ├─ rpc-mode.ts                         #   RPC 命令路由（~50 个命令）
          ├─ agent-session.ts                    #   Session 生命周期管理
          ├─ resource-loader.ts                  #   Extension/Skill/Prompt 加载
          ├─ package-manager.ts                  #   资源发现 + isEnabledByOverrides 过滤
          └─ settings-manager.ts                 #   Settings 读写（global + project）
```

### Channel 通信机制

App Server 通过 `callChannel()` 与 CLI 进程内的 extension 通信，用于需要 CLI 侧数据/逻辑的 RPC 调用：

```
App Server (handler)
  │
  ├─ manager.callChannel(sessionId, channelName, method, params)
  │     │
  │     ▼
  ├─ 写入 channel_data JSONL 到 CLI stdin        # process-manager.ts
  │     │
  │     ▼
  └─ CLI ChannelManager 路由                      # 底层 channel-manager.ts
        └─ channelName 对应的 extension handler
              └─ 返回结果 → stdout JSONL → App Server 解析
```

**关键点**：

- Channel 调用是同步的（stdin 排队），Agent streaming 时 channel 调用会排队等待
- Channel 名称在 `src/shared/constants/channel-methods.ts` 中定义
- Channel 类型契约在底层 `extensions/<name>/contract.ts` 中定义
- 使用场景：`file-review`（pending/approve/reject）、`bash`、`git` 等

**Channel vs 直接 RPC 的选择**：

- 简单 CRUD（不依赖 CLI 状态）→ 直接 handler 处理
- 需要 CLI 内部数据（快照、文件树、extension 状态）→ channel 调用
- Agent 不在时可用 JSONL fallback（从 session 文件读取持久化记录）

### Session JSONL 数据格式

Session 文件（`<sessionPath>`）是 JSONL 格式，每行一个 JSON 条目。核心条目类型：

| 条目类型     | `type` 字段                                   | 用途                      | 写入方                |
| ------------ | --------------------------------------------- | ------------------------- | --------------------- |
| 消息         | `"message"`                                   | 用户/助手消息             | CLI Agent             |
| 叶子指针     | `"leaf_pointer"`                              | 当前对话分支末端          | CLI Agent             |
| 步骤快照     | `"step-snapshot"`                             | 每轮操作的文件树快照 hash | CLI Agent             |
| 文件变更记录 | `"custom"` + `customType: "file-review-turn"` | 一轮操作改了哪些文件      | file-review extension |
| 审批记录     | `"custom"` + `customType: "file-approval"`    | 文件审批/驳回记录         | file-review extension |
| 通道数据     | `"channel_data"`                              | App Server ↔ CLI 通信     | 双向                  |

**JSONL 读取工具**：

- `src/shared/agent/session-message-reader.ts` — 消息读取 + 缓存
- `src/shared/handlers/change-review.ts` 中的 `readPendingFromJsonl()` — 解析 file-review-turn + file-approval 计算待审查文件

### 新增 RPC 命令的步骤

1. **`src/shared/modules/agent.ts`** — 添加 RPC 类型定义（params + result）
2. **`src/shared/handlers/agent.ts`** — 注册 handler（前端侧逻辑）
3. 如果需要持久化 → **`src/shared/lib/project-config.ts`**（config.json 读写）
4. 如果需要 CLI 侧逻辑 → 修改 fork 源码 → yalc push

## 数据持久化

### 前端持久化：`~/.pi/chat/config.json`

通过 `src/shared/lib/project-config.ts` 管理，使用串行队列（`loadAndSave`）防止并发写竞争，写入前自动备份到 `config.json.bak`。

```jsonc
{
  "recentProjects": [...],        // 最近打开的项目
  "activeProject": "...",         // 当前活跃项目路径
  "openTabs": [...],              // 打开的 tab 列表
  "pinnedSessionIds": [...],      // 固定的 session
  "favoriteFolders": [...],       // 收藏文件夹
  "disabledSkills": ["skill-a"],  // 全局禁用的 skill 名（不区分项目）
  "disabledPlugins": {            // 按项目禁用的 plugin 路径
    "/path/to/project-a": ["/plugins/x/index.ts"],
    "/path/to/project-b": ["/plugins/y/index.ts"]
  },
  "modelFavorites": [...]         // 收藏的模型
}
```

### 后端持久化：Settings（fork CLI 管理）

- **全局**: `<agentDir>/settings.json` — 通过 `agent.getSettings` / `agent.setSettings`（scope="global"）
- **项目**: `<cwd>/.pi/settings.json` — 通过 `agent.getSettings` / `agent.setSettings`（scope="project"）
- Settings 中的 `extensions` 字段支持模式语法：`-path`（排除）、`+path`（强制包含）、`!pattern`（glob 排除）
- Settings 修改后需调用 `agent.reload` 才能生效

### Project-scoped 用户态状态规范

用户本机私有、但语义上属于某个项目的状态，必须按项目目录隔离，不能继续堆到 `<agentDir>` 根目录的大 JSON 文件里。

```text
<PROJECT_USER_STATE_DIR>/
  trust.json              # 用户是否信任该项目，可被父目录决策继承
  path-permissions.json   # legacy path permission fallback，仅本机私有
  metadata.json           # 后续项目私有元数据预留
```

边界规则：

- `<PROJECT_USER_STATE_DIR>/...`：用户本机私有状态，不进仓库，例如 project trust、session fallback、自动审批历史、项目私有权限缓存。
- `<PROJECT_SHARED_DIR>/settings.json`：项目共享配置，只有项目已 trust 后才允许写入，例如 `permissions.rules`、项目 extension 配置。
- `<PROJECT_SHARED_DIR>/agents/` / `<PROJECT_SHARED_DIR>/rules/`：项目共享 agent/rule 定义，属于仓库态配置。
- `<PI_AGENT_DIR>/settings.json`：真正全局的用户默认配置，不应混入按项目分组的状态。
- `<PI_APP_CONFIG_DIR>/config.json`：pi-agent-chat UI 的最近项目、打开 tab、收藏等 app 级索引；它可以记录“打开过哪些项目”，但不能承载项目权限/trust 规则。

迁移/兼容要求：

- 新写入必须写 project-scoped 用户态目录。
- 旧的 `<PI_AGENT_DIR>/trust.json` 和 `<PI_AGENT_DIR>/path-permissions.json` 只允许作为兼容读取来源；不要再向旧全局大文件写入新项目状态。
- 如果新增项目私有状态，先定义 `projects/<encoded-project-path>/` 下的文件，再接 UI/RPC；不要新增“全局 JSON + cwd key”的结构。

### 持久化路径变量

所有持久化路径必须用下面变量描述。新增变量前先补本节和“写入路径注册表”，再写代码；不要在业务代码里直接手写 `~/.pi/agent/...`、`~/.pi/chat/...` 或 `<cwd>/.pi/...` 的新变体。

| 变量                           | 生成规则                                                                                     | 说明                                                                                                                                                                                |
| ------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<PI_APP_CONFIG_DIR>`          | `~/.pi/chat`                                                                           | pi-agent-chat app 级 UI 状态目录，只保存 UI 索引和偏好。                                                                                                                            |
| `<PI_AGENT_DIR>`               | `process.env.PI_CODING_AGENT_DIR ?? ~/.pi/agent`                                             | fork CLI 的用户态根目录。所有 agent 私有状态都必须从这里派生。                                                                                                                      |
| `<PROJECT_ROOT>`               | 当前会话的 canonical project path                                                            | 用户正在操作的项目根目录。普通目录是自身路径；git worktree 见下方规则。写入前必须经过 path guard / trust 规则。                                                                     |
| `<PROJECT_SHARED_DIR>`         | `<PROJECT_ROOT>/.pi`                                                                         | 项目共享配置目录，可进仓库。写入前必须确认 project trusted。                                                                                                                        |
| `<PROJECT_KEY>`                | `encodeProjectPath(<PROJECT_ROOT>)`                                                          | 项目路径稳定编码。不是随机值，也不是完整路径替换；当前算法是 `fnv1a32(projectPath) + "--" + sanitizedBasename.slice(0, 48)`。                                                       |
| `<SESSION_BUCKET_KEY>`         | legacy `encodeCwd(<projectPath>)`                                                            | app 侧现有 session 目录桶编码，格式是 `"--" + path 去掉开头 "/" 后把 "/" 替换成 "-" + "--"`。只用于 session 扫描/兼容，不是项目身份。                                               |
| `<CWD_KEY>`                    | `encodeProjectPath(<cwd>)`                                                                   | fork extension storage 的 cwd 稳定编码。只用于 cwd legacy storage，不等同于项目身份。                                                                                               |
| `<SESSION_ROOT>`               | `<PI_AGENT_DIR>/sessions/<SESSION_BUCKET_KEY>`                                               | 某个 projectPath 下的会话历史根目录。                                                                                                                                               |
| `<SESSION_ID>`                 | session manager 分配的 id                                                                    | 单个会话身份。不要用它替代 project key。                                                                                                                                            |
| `<EXT_NAME>`                   | extension package/name 的稳定标识                                                            | extension 私有数据目录的最后一级名称。                                                                                                                                              |
| `<PROJECT_USER_STATE_DIR>`     | `<PI_AGENT_DIR>/projects/<PROJECT_KEY>`                                                      | 项目维度、本机私有用户态状态目录。project trust、自动审批、项目私有权限缓存优先放这里。                                                                                             |
| `<SESSION_DATA_DIR>`           | `<SESSION_ROOT>/data/<SESSION_ID>/<EXT_NAME>`                                                | session 维度 extension 私有状态目录。                                                                                                                                               |
| `<PROJECT_EXTENSION_DATA_DIR>` | `<PI_AGENT_DIR>/project-data/<PROJECT_KEY>/<EXT_NAME>`                                       | 现有 extension 项目维度用户态目录，对应底层 `ctx.projectDataDir` / `getProjectDataDir()`。新核心权限/trust 状态不要放这里。                                                         |
| `<CWD_EXTENSION_DATA_DIR>`     | `<PI_AGENT_DIR>/cwd-data/<CWD_KEY>/<EXT_NAME>`                                               | legacy extension cwd 维度用户态目录。                                                                                                                                               |
| `<GLOBAL_EXTENSION_DATA_DIR>`  | `<PI_AGENT_DIR>/extensions-data/<EXT_NAME>`                                                  | 真正跨所有项目共享的 extension 状态目录。                                                                                                                                           |
| `<USER_MEMORY_DIR>`            | `<PI_AGENT_DIR>/memory`                                                                      | pi 自己的用户记忆根目录。可包含全局记忆规则、项目记忆 legacy 目录。不要写入宿主产品的记忆目录。                                                                                     |
| `<PROJECT_MEMORY_DIR>`         | `<PROJECT_USER_STATE_DIR>/memory`                                                            | 新规范下的项目私有记忆目录。项目相关、但不进 git 的记忆优先放这里。                                                                                                                 |
| `<PLUGIN_PROJECT_MEMORY_DIR>`  | `<PROJECT_EXTENSION_DATA_DIR>/memory`                                                        | 现有插件项目维度记忆目录，应通过 `ctx.projectDataDir` 派生。插件需要独立记忆索引、向量缓存、摘要缓存时使用。                                                                        |
| `<AUTO_MEMORY_PROJECT_DIR>`    | `<USER_MEMORY_DIR>/<MEMORY_PROJECT_BUCKET_KEY>`                                              | auto-memory legacy 项目记忆目录。当前实现仍在使用，后续重构可迁到 `<PROJECT_MEMORY_DIR>`。                                                                                          |
| `<HOST_CODEX_MEMORY_DIR>`      | `~/.codex/memories`                                                                          | Codex 宿主自己的记忆目录示例。pi 默认只可显式导入/只读引用，不应直接当作 pi 插件写入目标。                                                                                          |
| `<CLAUDE_GLOBAL_SETTINGS>`     | `~/.claude/settings.json`                                                                    | Claude Code 兼容输入源。pi 新功能默认不要写这里。                                                                                                                                   |
| `<CLAUDE_PROJECT_SETTINGS>`    | `<PROJECT_ROOT>/.claude/settings.json` / `<PROJECT_ROOT>/.claude/settings.local.json`        | Claude Code 项目兼容输入源。pi 新功能默认不要写这里。                                                                                                                               |
| `<REMOTE_SYNC_AGENT_DIR>`      | `REMOTE_RESOURCE_SYNC_REMOTE_AGENT_DIR ?? <REMOTE_CHILD_REMOTE_RUNTIME_DIR>/agent-resources` | Standard SSH 本地资源同步后的远端 managed `PI_CODING_AGENT_DIR`。只放同步 bundle、远端 session/memory 等远端 runtime 状态；默认由 pi 管理，可安全覆盖其中的 `skills/agents/rules`。 |
| `<TMP_DIR>`                    | `process.env.TMPDIR ?? os.tmpdir()`                                                          | 临时文件根目录，只能放可清理、可重建的数据。                                                                                                                                        |
| `<APP_LOG_DIR>`                | `process.env.LOG_DIR ?? <repo>/logs`                                                         | app/server 诊断日志目录。                                                                                                                                                           |

`encodeProjectPath()` 必须保持 app 侧和 fork 侧字节兼容。当前实现允许出现在路径中的可读后缀只保留 `[a-zA-Z0-9._-]`，其他字符替换成 `_`；前缀 hash 才是避免同名项目冲突的主身份。后续如果调整算法，必须提供迁移或 fallback 读取。

例子：

```text
PROJECT_ROOT = /Users/xuyingzhou/Project/study-web/猴子
basename     = 猴子
sanitized    = __
PROJECT_KEY  = <fnv1a32-of-full-path>--__

PROJECT_ROOT = /Users/xuyingzhou/Project/temporary/pi-agent-chat
basename     = pi-agent-chat
sanitized    = pi-agent-chat
PROJECT_KEY  = <fnv1a32-of-full-path>--pi-agent-chat
```

`PROJECT_KEY` 的 hash 输入是完整 canonical project path，所以两个不同目录即使 basename 一样，也会生成不同 key。可读后缀只用于人眼辨认，不能当唯一身份。

路径选择规则：

- 项目私有、用户本机状态：写 `<PROJECT_USER_STATE_DIR>/<feature>.json` 或子目录。
- 项目共享、可随仓库流转配置：写 `<PROJECT_SHARED_DIR>/...`，必须先 trust。
- 单次会话状态：写 `<SESSION_DATA_DIR>/...`。
- extension 真正全局状态：写 `<GLOBAL_EXTENSION_DATA_DIR>/...`，不能混入项目 key。
- 用户全局记忆规则：写 `<USER_MEMORY_DIR>/...`，例如全局 skip/guard 规则；不要混入项目专属内容。
- 项目私有记忆：新写入目标是 `<PROJECT_MEMORY_DIR>/...`；现有 auto-memory 仍兼容 `<AUTO_MEMORY_PROJECT_DIR>/...`。
- 插件项目记忆：写 `<PLUGIN_PROJECT_MEMORY_DIR>/...`，不要写到宿主产品目录，例如 `<HOST_CODEX_MEMORY_DIR>`。
- app UI 索引：写 `<PI_APP_CONFIG_DIR>/config.json`，不能存权限/trust 规则。
- 临时日志/缓存：写 `<TMP_DIR>`、`<APP_LOG_DIR>` 或明确 cache/tool/tmp 目录，必须可清理或可重建。

### Extension 存储 API 现状

底层 extension runtime 已经暴露四个标准数据目录。普通插件应优先使用这些 `ctx.*DataDir`，不要自己手拼 `<PI_AGENT_DIR>`：

| Extension API        | 当前路径                                      | 适用场景                                            |
| -------------------- | --------------------------------------------- | --------------------------------------------------- |
| `ctx.sessionDataDir` | `<SESSION_DATA_DIR>`                          | 当前 session 私有状态，例如 runtime state、临时日志 |
| `ctx.projectDataDir` | `<PROJECT_EXTENSION_DATA_DIR>`                | 当前项目下该插件跨 session 共享的用户态状态         |
| `ctx.cwdDataDir`     | `<CWD_EXTENSION_DATA_DIR>`                    | 按当前 cwd 隔离的 legacy/特殊状态                   |
| `ctx.globalDataDir`  | `<GLOBAL_EXTENSION_DATA_DIR>`                 | 该插件跨所有项目共享的全局状态                      |
| `ctx.projectRoot`    | `resolveProjectIdentity(cwd)` 的 canonical 值 | worktree-aware git root；用于 projectDataDir 编码   |

现有例子：

- `session-supervisor` 读取 `ctx.sessionDataDir/supervisor.json` 和 `ctx.projectDataDir/supervisor.json`。
- `auto-memory` 当前没有走 `ctx.projectDataDir`，而是自己写 `<USER_MEMORY_DIR>/<MEMORY_PROJECT_BUCKET_KEY>`；这是历史路径，需要兼容。

因此，插件项目维度记忆如果是插件内部数据，当前应放 `<PLUGIN_PROJECT_MEMORY_DIR>`，也就是 `ctx.projectDataDir/memory`。只有统一 memory provider 管理的项目级共享记忆，才进入 `<PROJECT_MEMORY_DIR>`。

### Memory 存储边界

Memory 是一等用户态数据，不等同于普通 cache。路径需要按“谁拥有”和“是否项目相关”拆开：

```text
<USER_MEMORY_DIR>/
  MEMORY.md 或全局索引预留
  .prefetch-skip-words.json        # auto-memory 当前全局 skip/guard 规则
  <MEMORY_PROJECT_BUCKET_KEY>/     # auto-memory legacy 项目记忆目录

<PROJECT_MEMORY_DIR>/
  MEMORY.md
  *.md                             # 新规范下的项目私有记忆

<PLUGIN_PROJECT_MEMORY_DIR>/
  MEMORY.md 或 plugin-index.json
  ...                              # 某插件自己的项目维度记忆/索引/缓存
```

`/Users/xuyingzhou/.codex/memories` 这类目录属于宿主 Codex 产品，不属于 pi 默认存储根。pi 插件如果要接入宿主记忆，应通过显式 connector/import/sync 协议读取或同步，并在 UI/权限上说明来源；不要直接把插件数据写进 `<HOST_CODEX_MEMORY_DIR>`。

所有权边界：

- `<PROJECT_MEMORY_DIR>` 归统一 memory provider 管。它是项目级共享记忆池，普通插件不要直接写文件；如果要写入项目记忆，应调用 memory provider 暴露的 channel/API，由 provider 做去重、索引、权限和格式维护。
- `<PLUGIN_PROJECT_MEMORY_DIR>` 归单个插件自己管。它只放该插件内部可解释的数据，例如索引、向量缓存、风险历史、扫描摘要。其他插件不要默认依赖它的内部格式。
- 如果插件产出的内容已经变成“整个项目以后都应该知道”的长期知识，应通过 memory provider 晋升到 `<PROJECT_MEMORY_DIR>`，而不是直接跨目录写入。

当前兼容现状：

- app fallback memory panel 读取 `<USER_MEMORY_DIR>/<SESSION_BUCKET_KEY>/...`。
- auto-memory extension 当前写 `<AUTO_MEMORY_PROJECT_DIR>/...`，其中 bucket 来自 legacy `encodeCwd(getProjectRoot(cwd))`。
- auto-memory 的全局 skip/guard 规则当前写 `<USER_MEMORY_DIR>/.prefetch-skip-words.json`。
- sandbox-box 当前会备份/恢复 `/root/.pi/agent/memory`，对应宿主侧 `<USER_MEMORY_DIR>`。

后续新写入建议：

- 新项目记忆写 `<PROJECT_MEMORY_DIR>`。
- 新插件项目记忆写 `<PLUGIN_PROJECT_MEMORY_DIR>`。
- legacy `<AUTO_MEMORY_PROJECT_DIR>` 只保留读取、兼容和迁移。
- 如果要把 Codex 记忆作为来源，做成显式只读 source 或导入任务，不要共享写同一个目录。

### Git worktree 路径规则

Git worktree 不是特殊项目类型；每一个 worktree path 都可以作为一个 `projectPath` 打开会话，但 project identity 要区分两层：

- UI/session 层的 `<PROJECT_ROOT>`：当前打开的 worktree 实际路径。例如 `/repo-main-feature-x`。会话、文件浏览、写入权限、当前工作区切换都应使用这个路径。
- fork extension 层的 canonical git root：`resolveProjectIdentity(cwd)` 会识别 `.git` 文件里的 `gitdir: .../.git/worktrees/...`，并解析到主仓库 root。这个用于 extension 的 project storage 兼容，不能替代 UI/session 的 active worktree path。

现有 worktree RPC 行为：

- `git.worktreeList({ repoPath })`：以 `repoPath` 执行 `git rev-parse --show-toplevel`，再执行 `git worktree list --porcelain`，返回 Git 报告的每个 worktree 绝对路径。
- `git.worktreeAdd({ repoPath, branch, sourceBranch })`：默认创建到 `dirname(repoRoot) / (basename(repoRoot) + "-" + branch)`。

例子：

```text
repoRoot = /Users/xuyingzhou/Project/temporary/pi-agent-chat
branch   = permission-runtime

默认 worktree path:
/Users/xuyingzhou/Project/temporary/pi-agent-chat-permission-runtime
```

如果未来支持自定义 worktree 根目录，必须新增变量，例如 `<WORKTREE_ROOT>`，并登记默认值、配置来源和沙盒挂载策略；不要在 git handler 里临时拼另一个路径规则。

目录命名原则见 `docs/architecture/worktree-capability-boundary.md`：app 状态推荐收敛到 `~/.pi/chat`，runtime 状态保留 `~/.pi/agent`；源码 worktree 默认不要藏进 app config dotdir，除非它是明确的 Pi managed 临时工作区。

路径来源：

- Project picker / tab：来自 `<PI_APP_CONFIG_DIR>/config.json` 的 recent/open tab 项目路径。
- Worktree 列表：来自 `git.worktreeList` 的 Git porcelain 输出。
- 新 worktree 会话：`git.worktreeAdd` 返回 `worktree.path` 后，UI 调用 `createNewSession(worktree.path)`，所以新 session 的 `projectPath` 就是该 worktree 的实际路径。
- 文件 explorer / walker：调用 `file.listDir({ path })`，路径来自当前 active project/session 的 `projectPath` 或用户正在展开的目录；它不应该自己生成项目路径。
- Session 扫描：`project.scanSessions({ projectPath })` 使用 `<SESSION_ROOT>`，也就是 `<PI_AGENT_DIR>/sessions/<SESSION_BUCKET_KEY>`。

### 写入路径注册表（沙盒/挂载依据）

任何新增持久化写入都必须先归类到下面某一类；如果归不进去，先更新本节再写代码。沙盒、容器、远程执行、权限拦截都应以这张表为准。

| 类别                   | 路径                                                                                                                                                               | 谁写入/读取                                   | 语义与约束                                                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| App UI 状态            | `<PI_APP_CONFIG_DIR>/config.json`                                                                                                                                  | `src/shared/lib/project-config.ts`            | 最近项目、打开 tab、收藏、UI 层 disable 索引。只能存 app 索引，不存权限/trust 规则。                                                              |
| Agent 全局配置         | `<PI_AGENT_DIR>/settings.json`                                                                                                                                     | fork `SettingsManager`                        | 用户全局默认配置，例如全局 extensions/settings。不能塞按项目分组的状态。                                                                          |
| Agent 认证/模型        | `<PI_AGENT_DIR>/auth.json`, `<PI_AGENT_DIR>/oauth.json`, `<PI_AGENT_DIR>/models.json`                                                                              | fork config/auth/model 逻辑                   | 用户机密和模型配置。沙盒默认不应复制，除非明确需要并经过安全处理。                                                                                |
| Agent 全局资源         | `<PI_AGENT_DIR>/agents/`, `<PI_AGENT_DIR>/skills/`, `<PI_AGENT_DIR>/extensions/`, `<PI_AGENT_DIR>/prompts/`                                                        | package/resource loader                       | 用户安装的全局 agent/skill/extension/prompt。沙盒可只读挂载，写入必须走安装/管理流程。                                                            |
| Agent 工具/二进制      | `<PI_AGENT_DIR>/tools/`, `<PI_AGENT_DIR>/bin/`, `<PI_AGENT_DIR>/npm/`, `<PI_AGENT_DIR>/git/`, `<PI_AGENT_DIR>/tmp/`                                                | package/tool manager                          | 下载和构建出来的运行依赖。可缓存，可清理；不要把项目状态放这里。                                                                                  |
| Agent sessions         | `<SESSION_ROOT>/...`                                                                                                                                               | `SessionManager`, JSONL reader                | 会话 JSONL、session data、父子会话索引。属于用户运行历史，不进项目仓库。                                                                          |
| SSH 同步 Agent 根      | `<REMOTE_SYNC_AGENT_DIR>/skills`, `<REMOTE_SYNC_AGENT_DIR>/agents`, `<REMOTE_SYNC_AGENT_DIR>/rules`, `<REMOTE_SYNC_AGENT_DIR>/.remote-resource-sync/manifest.json` | `remote-resource-sync` + remote child runtime | Standard SSH managed 远端资源根。只同步低风险资源；远端 child 用它作为 `PI_CODING_AGENT_DIR`。不放本地密钥、models、memory、plugins、MCP、hooks。 |
| Session 扩展数据       | `<SESSION_DATA_DIR>/...`                                                                                                                                           | `getSessionDataDir()`                         | 某个 session 私有的 extension 数据。生命周期跟 session 走。                                                                                       |
| Project-scoped 用户态  | `<PROJECT_USER_STATE_DIR>/...`                                                                                                                                     | trust/permission/local project state          | 本机私有但属于某项目的状态，例如 `trust.json`、`path-permissions.json`、自动审批历史。                                                            |
| Project 扩展数据       | `<PROJECT_EXTENSION_DATA_DIR>/...`                                                                                                                                 | `ctx.projectDataDir`                          | 现有 extension runtime 的项目维度用户态目录。新核心 trust/permission 状态不要放这里。                                                             |
| CWD 扩展数据（legacy） | `<CWD_EXTENSION_DATA_DIR>/...`                                                                                                                                     | `getCwdDataDir()`                             | 现有 extension storage 的 cwd 维度用户态目录。不要新增核心权限/trust 状态到这里。                                                                 |
| 全局扩展数据           | `<GLOBAL_EXTENSION_DATA_DIR>/...`                                                                                                                                  | `getGlobalDataDir()`                          | extension 的真正全局状态。不得存项目私有状态。                                                                                                    |
| 用户全局记忆           | `<USER_MEMORY_DIR>/...`                                                                                                                                            | `auto-memory` / memory connector              | pi 自己的用户记忆根目录。可存全局记忆规则；项目记忆应进入项目子目录或新规范目录。                                                                 |
| 项目记忆               | `<PROJECT_MEMORY_DIR>/...`                                                                                                                                         | memory / plugin providers                     | 新规范下的项目私有记忆目录。不进 git。                                                                                                            |
| 插件项目记忆           | `<PLUGIN_PROJECT_MEMORY_DIR>/...`                                                                                                                                  | plugin providers                              | 插件自己的项目维度记忆、索引、向量缓存；当前由 `ctx.projectDataDir/memory` 派生。                                                                 |
| Auto memory（legacy）  | `<AUTO_MEMORY_PROJECT_DIR>/...`                                                                                                                                    | `auto-memory` extension                       | 现有本机私有项目记忆目录。后续若重构，可迁到 `<PROJECT_MEMORY_DIR>/`。                                                                            |
| 宿主 Codex 记忆        | `<HOST_CODEX_MEMORY_DIR>/...`                                                                                                                                      | explicit connector/import only                | 外部宿主记忆源。pi 默认不直接写；需要显式授权的只读引用或导入/同步协议。                                                                          |
| 项目共享配置           | `<PROJECT_SHARED_DIR>/settings.json`                                                                                                                               | `SettingsManager` project scope               | 仓库态/项目态配置。只有 project trusted 后才允许写，例如 `permissions.rules`。                                                                    |
| 项目共享 agent/rule    | `<PROJECT_SHARED_DIR>/agents/`, `<PROJECT_SHARED_DIR>/rules/`, `<PROJECT_SHARED_DIR>/rules-config.json`                                                            | agent/rules loader                            | 可随项目共享的 agent/rule 定义。写入前必须经过项目 trust 和权限检查。                                                                             |
| Claude/兼容配置        | `<CLAUDE_GLOBAL_SETTINGS>`, `<CLAUDE_PROJECT_SETTINGS>`                                                                                                            | hooks/compat loaders                          | Claude Code 兼容输入源。除专门兼容功能外，不要作为 pi 新状态写入目标。                                                                            |
| Bash 临时日志          | `<TMP_DIR>/pi-bash-*.log` 或 `<TMP_DIR>/pi-<bashId>.log`                                                                                                           | bash extension / executor                     | 临时运行输出，便于 UI 打开日志。可清理，不作为持久配置。                                                                                          |
| App/server 日志        | `<APP_LOG_DIR>/...`, `<PI_AGENT_DIR>/*-debug.log`, `<TMP_DIR>/*debug*.log`                                                                                         | server/debug/session-supervisor 等            | 诊断日志。不要存配置；沙盒可映射为临时或丢弃。                                                                                                    |
| 用户上传/调试临时文件  | gateway upload/debug temp dir、sandbox provider temp dir                                                                                                           | gateway/sandbox                               | 只作为传输或调试缓存。必须受 path guard/sandbox policy 限制。                                                                                     |

写入规则：

- **禁止新增** `<PI_AGENT_DIR>/<name>.json` 且用 cwd/project path 当 key 的结构；这是全局大文件污染，也是并发热点。
- **禁止新增** 未登记路径：任何新写入路径必须先进入“持久化路径变量”和“写入路径注册表”。
- **禁止业务代码手拼根路径**：除 canonical helper/config 外，不要直接 `join(homedir(), ".pi", "agent", ...)`、`join(projectRoot, ".pi", ...)` 或复制 `encodeProjectPath()` 算法。
- **新增项目私有用户态**：写 `<PROJECT_USER_STATE_DIR>/<feature>.json` 或子目录。
- **新增项目共享配置**：写 `<PROJECT_SHARED_DIR>/...`，必须先确认 project trust，且失败时不能静默降级写项目目录。
- **新增 session 私有状态**：写 `<SESSION_DATA_DIR>/...`，不要写到项目目录。
- **新增 extension 全局状态**：只有确实跨所有项目共享时，才能用 `<GLOBAL_EXTENSION_DATA_DIR>/...`。
- **新增 memory 状态**：用户全局记忆写 `<USER_MEMORY_DIR>`，项目私有记忆写 `<PROJECT_MEMORY_DIR>`，插件项目记忆写 `<PLUGIN_PROJECT_MEMORY_DIR>`；不要直接写 `<HOST_CODEX_MEMORY_DIR>`。
- **新增缓存/下载产物**：必须放到明确 cache/tool/tmp 目录，并可重建、可清理。
- **新增沙盒支持**：先判断该路径是只读挂载、读写挂载、复制进入沙盒、还是禁止暴露；不要默认把整个 `<PI_AGENT_DIR>` 读写挂进沙盒。
- **旧路径兼容**：可以 read fallback，可以做一次性迁移；新写入必须进入新规范路径。

## Extension / Skill / MCP Toggle 机制对比

| 特性              | Extension (Plugin)                                               | Skill                          | MCP Server              |
| ----------------- | ---------------------------------------------------------------- | ------------------------------ | ----------------------- |
| **Toggle UI**     | StatusPanel Eye/EyeOff                                           | StatusPanel Eye/EyeOff         | StatusPanel 滑动开关    |
| **RPC 命令**      | `agent.setDisabledPlugin` + `agent.setSettings` + `agent.reload` | `agent.setDisabledSkill`       | `agent.toggleMcpServer` |
| **持久化**        | `config.json` (disabledPlugins) + settings (extensions `-path`)  | `config.json` (disabledSkills) | 内存（进程重启恢复）    |
| **生效方式**      | reload CLI runtime                                               | 即时（前端标记）               | 即时（断开/重连）       |
| **真正禁用**      | 是（extension 不加载）                                           | 否（前端标记，Agent 仍可调用） | 是（MCP 连接断开）      |
| **粒度**          | 按项目                                                           | 全局                           | 按会话                  |
| **乐观更新+回滚** | 有                                                               | 无                             | 无                      |

## Testing

- Unit/Integration/Regression/Smoke: `vitest` + `@testing-library/react` (happy-dom)
- E2E (real LLM): `vitest` + `ws` (sequentially, requires dev server + LLM API)
- E2E (browser): `@playwright/test` with `workers: 3`, `headless: true`
- Config: `vitest.config.ts` (default), `vitest.config.e2e.ts` (LLM), `vitest.config.integration.ts`, `playwright.config.ts`

### Real LLM E2E Model Preference

For real LLM E2E validation (`PI_E2E_LLM=1`), prefer `opencode-go/deepseek-v4-flash` when the test does not require a specific model. This is the fastest currently configured model for these validation runs.

### Test Directory Structure (两层分类: test/{type}/{domain}/)

```
test/
  unit/                   # 单元测试 — 隔离测试单一模块/函数/组件
    stores/               #   Zustand store 状态管理 (50 文件)
    handlers/             #   RPC Handler 请求处理 (17 文件)
    utils/                #   工具函数 / 纯逻辑 (15 文件)
    lib/                  #   项目配置 / 持久化 (project-config.test.ts)
    components/           #   React 组件渲染 / DOM 交互 (19 文件)
  integration/            # 集成测试 — 跨模块/多组件协作
    agent/                #   Agent 运行时 + 进程池
    session/              #   Session 会话管理
    chat/                 #   Chat 流式 + 渲染
    coordinator/          #   Coordinator 协调层
    compaction/           #   压缩与历史
    render-cache/         #   渲染缓存
    notification/         #   通知系统
    git/                  #   Git 集成
    memory/               #   Memory 集成
    tabbar/               #   TabBar 集成
    cross/                #   跨项目/跨模块
  regression/             # 回归测试 — Bug 修复保护
    agent/                #   Agent 相关 bug
    rollback/             #   回滚相关 bug
    chat/                 #   Chat 相关 bug
    change-review/        #   ChangeReview 相关 bug
  smoke/                  # 冒烟测试 — 快速健康检查
    phase/                #   p0/p1/p2/p3/p4 阶段验证
    batch/                #   3/6/7/8/12/45/next 批次验证
  e2e-llm/                # 真实 LLM 端到端 (独立 vitest.config.e2e.ts)
    rpc/                  #   RPC 端到端流程
    verify/               #   验证类 (push/pull/mode-switch/timeout)
    hooks/                #   Hooks 引擎
    helpers.ts            #   E2E 辅助
  helpers/                # 测试辅助工具 (event-fixtures/mock-llm/harness)
  setup.ts                # vitest 全局 setup (localStorage + jest-dom)

e2e/                      # Playwright 浏览器 E2E (17 文件, 独立运行)
```

### 测试类型识别规则

| 路径前缀                | 测试类型    | 工具               | 速度 | 何时使用              |
| ----------------------- | ----------- | ------------------ | ---- | --------------------- |
| `test/unit/stores/`     | store 状态  | vitest (happy-dom) | 快   | 改动 Zustand store 时 |
| `test/unit/handlers/`   | RPC handler | vitest             | 快   | 改动 RPC handler 时   |
| `test/unit/utils/`      | 纯函数      | vitest             | 极快 | 改动工具函数时        |
| `test/unit/components/` | React 组件  | vitest + RTL       | 中   | 改动 UI 组件时        |
| `test/integration/**`   | 跨模块集成  | vitest             | 慢   | 改动跨模块流程时      |
| `test/regression/**`    | Bug 回归    | vitest             | 中   | 修复已知 bug 时       |
| `test/smoke/**`         | 健康检查    | vitest             | 极快 | CI 冒烟 / 提交前      |
| `test/e2e-llm/**`       | 真实 LLM    | vitest + ws        | 极慢 | 验证真实 LLM 行为     |
| `e2e/*.spec.ts`         | 浏览器      | playwright         | 慢   | 验证 UI 流程          |

### 运行测试

```bash
# 默认 — 跑 vitest.config.ts 范围内的所有测试
bun run test

# 按类型
bun run test:unit           # test/unit/**
bun run test:integration    # test/integration/**
bun run test:regression     # test/regression/**
bun run test:smoke          # util + handler (最快)
bun run test:watch         # vitest watch mode
bun run test:ui            # vitest UI
bun run test:e2e-llm        # 真实 LLM (需 dev server)

# 按业务模块 (跨类型聚合)
bun run test:chat           # 聊天相关
bun run test:agent          # Agent 代理相关
bun run test:rollback       # Rollback 相关
bun run test:process-manager
bun run test:compaction
bun run test:coordinator
bun run test:bash / session / git / memory / theme / settings

# 高级
bash run-tests.sh list      # 列出所有分类
bash run-tests.sh check     # 检查文件完整性
bash run-tests.sh failed    # 只重跑上次失败

# 浏览器 E2E
bunx playwright test        # e2e/*.spec.ts
```

### 编写新测试

| 改动类型                   | 应放在                                          | 命名建议                                          |
| -------------------------- | ----------------------------------------------- | ------------------------------------------------- |
| 新 Zustand store           | `test/unit/stores/<name>.test.ts`               | `chat.test.ts` / `use-<name>-store.test.ts`       |
| 新 RPC handler             | `test/unit/handlers/<name>.test.ts`             | `bash.test.ts`                                    |
| 新工具函数                 | `test/unit/utils/<name>.test.ts`                | `clipboard.test.ts`                               |
| 新 React 组件              | `test/unit/components/<ComponentName>.test.tsx` | `MessageBubble.test.tsx`                          |
| 跨 store+component+handler | `test/integration/<domain>/<feature>.test.ts`   | `integration/chat/refresh-recovery.test.ts`       |
| Bug 修复保护               | `test/regression/<domain>/<bug-name>.test.ts`   | `regression/rollback/targetid-resolution.test.ts` |
| 快速冒烟                   | `test/smoke/<phase\|batch>/<n>.test.ts`         | `smoke/phase/p5.test.ts`                          |
| 真实 LLM 验证              | `test/e2e-llm/<category>/<feature>.test.ts`     | `e2e-llm/verify/auth-flow.test.ts`                |
| 浏览器交互                 | `e2e/<feature>.spec.ts`                         | `e2e/chat-pagination.spec.ts`                     |

## Architecture Design Docs

| 文档                                                        | 状态             | 说明                                                                                           |
| ----------------------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------------------- |
| `docs/plans/2026-06-01-process-per-session-design.md`       | Phase 1 已完成   | 每会话独立 CLI 进程，LRU 淘汰，全局进程池                                                      |
| `docs/plans/2026-06-01-session-switch-experience-design.md` | Phase 1-3 已实施 | 会话切换体验优化：热/冷切换分流、fetchInitialState 缓存、MessageList 无闪烁                    |
| `docs/plans/2026-06-01-render-cache-design.md`              | 已实施           | 渲染层按 session 缓存：processedMessages/cardMeta/flatItems/messageIds                         |
| `docs/plans/2026-06-10-plugin-toggle-design.md`             | 已实施           | Plugin 按项目 enable/disable，set_settings + reload，config.json 持久化                        |
| `docs/plans/2026-06-11-change-review-optimization.md`       | 已实施           | change-review.pending 性能优化：channel + JSONL 降级，底层 readTreeFiles O(M)，approval 持久化 |
| `docs/notification-interaction-manual.md`                   | 操作手册         | 通知、toast、retry、权限 pending 的 UI 分层与适用场景                                          |
| `docs/ui/popover-menus.md`                                  | UI 规范          | Popover、下拉菜单、右键菜单的锚定规则、组件入口和更新 checklist                                |
| `docs/ui/button-density.md`                                 | UI 规范          | Button、IconButton、CopyAction 的尺寸密度、触控目标、close button 和 toolbar action 规范       |
| `docs/testing-architecture.md`                              | 参考文档         | 测试架构总览：6 种测试方法、目录结构、散落文件收拢计划、新测试编写指南                         |

### WebSocket RPC 端到端测试方法

通过 WebSocket 直接调用 RPC API，对真实 dev server 做端到端验证。适用于验证 Agent 会话行为、回滚、消息过滤等涉及前后端+CLI 进程的完整链路。

**前提条件**：

- Dev server 已启动（`bun run dev:web`），默认端口 3100
- `node_modules` 中有 `ws` 包（项目已安装）
- AUTH_TOKEN 配置在 `.env` 中（默认 `demo-test-token`）

**核心 RPC 方法**：

| 方法                    | 参数                                      | 用途                                          |
| ----------------------- | ----------------------------------------- | --------------------------------------------- |
| `session.create`        | `{ projectPath }`                         | 创建新会话，返回 `{ sessionId, sessionPath }` |
| `agent.start`           | `{ sessionId, projectPath, sessionPath }` | 启动 Agent 进程（必须先调才能发消息）         |
| `agent.send`            | `{ sessionId, content }`                  | 发送用户消息                                  |
| `agent.stop`            | `{ sessionId }`                           | 停止 Agent 进程（确保 JSONL 写完）            |
| `agent.getFullMessages` | `{ sessionId, sessionPath }`              | 获取当前分支的过滤后消息                      |
| `agent.navigateTree`    | `{ sessionId, targetId, summarize }`      | 回滚到指定 entry                              |
| `agent.getTree`         | `{ sessionId }`                           | 获取会话树结构                                |

**测试脚本模板**：

```javascript
// e2e-test.mjs — 放在项目根目录，用 node e2e-test.mjs 运行
import WebSocket from "ws";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const WS_URL = "ws://localhost:3100/ws?token=demo-test-token";
const CWD = `/tmp/e2e-test-${Date.now()}`;
execSync(`mkdir -p ${CWD}`);

let msgId = 0;
const pending = new Map();

function wsConnect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      // 路由 RPC response 到对应的 pending promise
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    ws.on("open", () => resolve(ws));
    setTimeout(() => reject(new Error("connect timeout")), 10000);
  });
}

function rpc(ws, method, params, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = `test-${++msgId}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timeout`));
    }, timeout);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

// 轮询等待消息数变化（因为 agent.send 不返回完成信号）
async function waitForMessages(ws, sid, sp, minCount, timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
    const msgs = res.result?.messages || [];
    if (msgs.length >= minCount) return msgs;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`timeout: expected >= ${minCount} messages`);
}

// 读取 JSONL 中的 entry IDs（用于定位回滚目标）
function getMessageEntryIds(sessionPath) {
  const lines = readFileSync(sessionPath, "utf-8").trim().split("\n");
  return lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e?.type === "message")
    .map((e) => ({ id: e.id, role: e.message?.role, parentId: e.parentId }));
}

// === 使用示例 ===
async function main() {
  const ws = await wsConnect();

  // 1. 创建会话 + 启动 Agent
  const sr = await rpc(ws, "session.create", { projectPath: CWD });
  const sid = sr.result.sessionId;
  const sp = sr.result.sessionPath;
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });

  // 2. 发消息 + 等待回复
  await rpc(ws, "agent.send", { sessionId: sid, content: "你好" });
  await waitForMessages(ws, sid, sp, 2); // user + assistant

  // 3. 停止 Agent（确保 JSONL 写完）
  await rpc(ws, "agent.stop", { sessionId: sid });

  // 4. 读 JSONL 找回滚目标
  const entries = getMessageEntryIds(sp);
  const firstAssistant = entries.find((e) => e.role === "assistant");

  // 5. 重启 Agent + 回滚
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
  await rpc(ws, "agent.navigateTree", {
    sessionId: sid,
    targetId: firstAssistant.id,
    summarize: false,
  });

  // 6. 验证回滚后的消息
  const msgs = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
  console.log("Messages after rollback:", msgs.result?.messages?.length);

  // 7. 检查 JSONL 中的 leaf_pointer
  const jsonl = readFileSync(sp, "utf-8");
  const leafPointers = jsonl
    .trim()
    .split("\n")
    .filter((l) => l.includes('"type":"leaf_pointer"'));
  console.log("leaf_pointer entries:", leafPointers.length);

  ws.close();
}

main().catch(console.error);
```

**注意事项**：

- `agent.send` 不阻塞等待完成，需要用 `waitForMessages` 轮询消息数变化
- 回滚前先 `agent.stop` 确保 JSONL 写完，再读 entry IDs 定位目标，再 `agent.start` 后调 `navigateTree`
- LLM 响应时间不确定，轮询 timeout 建议 60-90 秒
- 脚本放在项目根目录运行（`node e2e-test.mjs`），因为需要 `ws` 依赖
- 测试完清理临时目录：`rm -rf /tmp/e2e-test-*`

**典型验证场景**：

1. **回滚消息过滤**：发 A → 发 B → 回滚到 A → 验证只有 A 的消息
2. **回滚后继续对话**：回滚后发新消息 → 验证 LLM 上下文正确
3. **多次回滚**：A → B → 回滚到 A → C → 回滚到中间 → 验证消息树
4. **JSONL 持久化**：回滚后检查 leaf_pointer 是否写入、entry 是否正确
5. **重启恢复**：回滚 → 停止进程 → 重新 agent.start → 验证消息状态恢复

## Code Style

- No `any` type, use `unknown` with narrowing
- No block-level `/* eslint-disable */` comments — fix the root cause. Line-level `// eslint-disable-next-line` is acceptable only for type-system false positives (e.g. `prefer-nullish-coalescing` where `||` is intentional for empty-string fallback)
- Use `createLogger` from `src/shared/lib/logger.ts` instead of `console.log`
- Function components only, hooks prefixed with `use`
- Tailwind utility classes for styling, design tokens for theming

### Zustand Store 规范

- **乐观更新 + 回滚**：涉及 RPC 调用的 toggle 操作应先乐观更新 UI，异步操作失败时回滚。参考 `use-status-store.ts` 中的 `togglePluginEnabled`
- **异步操作不阻塞 UI**：store 方法用 `(async () => { ... })()` 模式，不返回 Promise，避免 UI 层需要 await
- **避免循环依赖**：`session-initial-state.ts` 不能 import `use-session-store`（会被 use-session-store import），需要时通过 `get().sessionsByProject` 获取数据
- **Store 职责单一**：每个 store 管理一个领域（status、chat、session、settings 等），跨 store 调用用 `xxxStore.getState().method()`
