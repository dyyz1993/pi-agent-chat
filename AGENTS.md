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
- Pin/collapse buttons hidden (`max-sm:hidden`)
- QuickActionToolbar only renders on mobile/tablet
- Tab close buttons always visible on mobile (no hover needed)
- Touch targets minimum 44px on all interactive elements
- `viewport-fit=cover` is set, so `env(safe-area-inset-*)` works

### Safe-Area Rules for Fullscreen Overlays

ALL `fixed inset-0` fullscreen components MUST:

1. Add `paddingTop: "calc(<base-padding>rem + env(safe-area-inset-top, 0px))"` on the header
2. Add `paddingBottom: "env(safe-area-inset-bottom, 0px)"` on the container or footer
3. Close buttons must be minimum 44px touch target (`p-2` + `w-4 h-4` icon = ~40px)
4. Every fullscreen page MUST have a visible close/exit button

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
      project-config.ts      # ~/.pi-agent-chat/config.json 读写（串行队列 + 备份保护）
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

### 前端持久化：`~/.pi-agent-chat/config.json`

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
