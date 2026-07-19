# 📚 项目文档大纲

> 🤖 由 doc-curator agent 自动维护 | 最后更新: 2026-07-19 08:35
> ⚠️ 请勿手动编辑此文件 — 使用 doc-curator agent 更新

## 📊 统计概览

| 指标                | 数量 |
| ------------------- | ---- |
| 文档总数            | 117  |
| 架构文档            | 6    |
| 实现计划            | 26   |
| 开发指南 / 设计文档 | 15   |
| UI 规范             | 2    |
| 工作流文档          | 6    |
| 配置规则            | 6    |
| Agent 定义          | 9    |
| 测试文档            | 34   |
| Issue 追踪          | 2    |
| Bug 记录            | 6    |
| 项目根文档          | 5    |
| 待校验              | 117  |

> 注：已排除 `node_modules/`、`.yalc/`、`dist/`、`build/`、`.git/`、`.codenomad/`、`.design/`、`.design_library/`、`test-results/`、`test-screenshots/`、`.ui-debugger/`、`.ui-tester/` 等临时/产物目录。

---

## 🗂️ 文档树

### 📦 项目根

| 文件                         | 摘要                                                                         | 类型      | 状态    | 最后修改   |
| ---------------------------- | ---------------------------------------------------------------------------- | --------- | ------- | ---------- |
| `AGENTS.md`                  | 项目主指南：依赖管理、架构、RPC、持久化路径、测试规范、分支清单              | readme    | ✅      | 2026-07-10 |
| `README.md`                  | 项目介绍、截图、下载安装说明                                                 | readme    | ✅      | 2026-06-05 |
| `CHANGELOG.md`               | 版本变更日志（预览卡片重构、剪贴板统一等）                                   | changelog | ✅      | 2026-04-27 |
| `DEPLOYMENT.md`              | macOS/Linux 桌面端及 Web 服务器部署文档                                      | guide     | ✅      | 2026-07-09 |
| `.compaction-verify-plan.md` | Compaction 手动验证计划（往 JSONL 写入 compaction entry 验证前端显示与回滚） | test      | ⚠️ 临时 | 2026-06-03 |

### 📐 架构设计

| 文件                                                          | 摘要                                                                              | 类型         | 状态 | 最后修改   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------- | ------------ | ---- | ---------- |
| `docs/architecture/session-context-and-compaction-flow.md`    | 会话上下文与压缩流程契约：统一 materialization 语义，防止 chat/compact 历史不一致 | architecture | ✅   | 2026-07-07 |
| `docs/architecture/model-tier-scope-contract.md`              | 模型 Tier 档位范围契约：仅全局默认和会话覆盖两层，无 project-level                | architecture | ✅   | 2026-07-07 |
| `docs/architecture/asset-store-and-vision-inputs.md`          | Asset Store 与视觉输入分层：FileResolver/AssetStore/provider 路由边界             | architecture | ✅   | 2026-06-28 |
| `docs/architecture/worktree-capability-boundary.md`           | Worktree 能力归属边界：项目级编排 vs 运行时能力的分层规则                         | architecture | ✅   | 2026-06-28 |
| `docs/architecture/remote-runtime-architecture-comparison.md` | 远程运行时架构对比：Claude ssh vs OpenCode serve/attach 的配置/密钥/会话归属      | architecture | ✅   | 2026-06-28 |
| `docs/architecture/pi-expert-knowledge-map.md`                | Pi Expert 角色知识图谱：需覆盖的配置/运行时/AssetStore/hooks/Agent/worktree 领域  | architecture | ✅   | 2026-06-30 |

### 📋 实现计划

| 文件                                                                  | 摘要                                                                              | 类型 | 状态        | 最后修改   |
| --------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ---- | ----------- | ---------- |
| `docs/plans/2026-06-30-subtask-delegate-runtime-contract.md`          | 子任务与委派运行时契约：权限、Ask、hooks、Review、状态、历史、刷新恢复            | plan | ✅          | 2026-06-30 |
| `docs/plans/2026-06-30-subagent-review-approval-contract.md`          | 子任务 Review 审批近近期契约定义                                                  | plan | ✅          | 2026-06-30 |
| `docs/plans/2026-06-24-ssh-standard-remote-agent-child.md`            | SSH 标准 Remote Agent Child 实现计划：远端完整 pi CLI runtime + 本地 auth 代理    | plan | ✅          | 2026-06-25 |
| `docs/plans/2026-06-24-learning-memory-skill-acceptance.md`           | Learning Memory 与 Skill 实现计划：统一用户面管理 memory + skill 蒸馏与审批       | plan | ✅          | 2026-06-25 |
| `docs/plans/2026-06-22-persistence-path-audit.md`                     | 持久化路径审计：记录当前所有运行时写入路径                                        | plan | ✅          | 2026-06-22 |
| `docs/plans/2026-06-21-agent-list-enhancement-design.md`              | Agent 列表注入 system prompt 方案（v2），对标 Skill 注入方式                      | plan | ✅          | 2026-06-21 |
| `docs/plans/2026-06-18-permission-runtime-redesign.md`                | Permission Runtime 重构：核心 Permission Runtime + 可组合 provider 插件 + UI 传输 | plan | ✅          | 2026-06-22 |
| `docs/plans/2026-06-13-refresh-rpc-optimization-design.md`            | 刷新流程 RPC 调用优化：从 44 个调用精简到必要首屏调用                             | plan | ✅          | 2026-06-19 |
| `docs/plans/2026-06-11-change-review-optimization.md`                 | change-review.pending 性能优化：从 5s+ 优化到毫秒级                               | plan | ✅ 已实施   | 2026-06-11 |
| `docs/plans/2026-06-10-plugin-toggle-design.md`                       | Plugin 按项目 enable/disable：set_settings + reload + config.json 持久化          | plan | ✅ 已实施   | 2026-06-11 |
| `docs/plans/2026-06-08-cross-project-status-indicator-design.md`      | 跨项目会话状态指示器：TabBar 多项目活跃状态展示                                   | plan | ✅          | 2026-06-09 |
| `docs/plans/2026-06-06-tool-lifecycle-rendering-refactor.md`          | Tool 生命周期渲染重构：修复刷新/重连后 tool card 卡在 streaming/waiting           | plan | ✅          | 2026-06-07 |
| `docs/plans/2026-06-06-feedback-router-gold-supervisor-simulation.md` | Goal Supervisor、Gold、Feedback Router 模拟方案                                   | plan | ✅          | 2026-06-07 |
| `docs/plans/2026-06-02-ui-interaction-audit.md`                       | UI 与交互审计优化：让界面更像高频工程工作台                                       | plan | ✅ 部分实施 | 2026-06-02 |
| `docs/plans/2026-06-01-session-switch-experience-design.md`           | 会话切换体验优化：hot/cold 分流、fetchInit TTL 缓存、无闪烁渲染                   | plan | ✅ 已实施   | 2026-06-01 |
| `docs/plans/2026-06-01-render-cache-design.md`                        | 会话切换渲染缓存设计：按 session 缓存 processedMessages/cardMeta/flatItems        | plan | ✅ 已实施   | 2026-06-01 |
| `docs/plans/2026-06-01-process-per-session-design.md`                 | Process-Per-Session 架构改造：每会话独立 CLI 进程，LRU 淘汰                       | plan | ✅ Phase 1  | 2026-06-01 |
| `docs/plans/2026-05-30-llm-error-silent-failure-fix.md`               | LLM 错误静默丢失修复：确保失败时 inline 显示错误提示                              | plan | ✅          | 2026-06-03 |
| `docs/plans/2026-05-19-subagent-v2-refactor.md`                       | Subagent-v2 重构：extension spawn → coordinator channel 创建子会话                | plan | ✅          | 2026-05-19 |
| `docs/plans/2026-05-06-coordinator-realtime-visibility.md`            | Coordinator 实时会话推送：子会话动态复用 subagent 模式                            | plan | ✅          | 2026-05-06 |
| `docs/plans/2026-05-01-worktree-workspace.md`                         | Worktree Workspace 交互：左侧栏底部 workspace 选择器 + session 标识               | plan | ✅          | 2026-05-01 |
| `docs/plans/2026-05-01-session-resource-leak-fix.md`                  | Session 资源泄漏修复：WebSocket 订阅和前端数据泄漏                                | plan | ✅          | 2026-05-01 |
| `docs/plans/2026-04-30-scroll-intent-optimization.md`                 | 滚动意图检测优化计划，参考 CodeNomad 方案                                         | plan | ✅          | 2026-05-01 |
| `docs/plans/2026-04-30-linked-projects-bridge-design.md`              | 跨项目知识桥接插件设计（Linked Projects Bridge）                                  | plan | ⚠️ 待实现   | 2026-05-01 |
| `docs/plans/2026-04-26-rpc-client-integration.md`                     | RpcClient 集成方案                                                                | plan | ✅ 已实施   | 2026-04-27 |
| `docs/plans/2026-04-26-bash-channel-enhancement.md`                   | Bash Channel UI Enhancement：补齐文档定义但 UI 缺失的功能                         | plan | ✅          | 2026-04-27 |

### 🎨 UI 规范

| 文件                        | 摘要                                                                   | 类型  | 状态 | 最后修改   |
| --------------------------- | ---------------------------------------------------------------------- | ----- | ---- | ---------- |
| `docs/ui/button-density.md` | Button/IconButton/CopyAction 密度指南：视觉密度 vs 触控目标规范        | guide | ✅   | 2026-07-01 |
| `docs/ui/popover-menus.md`  | Popover/Menu 规范：AnchoredPopover vs local popover 选择规则与组件入口 | guide | ✅   | 2026-07-02 |

### 📖 开发指南与设计文档

| 文件                                          | 摘要                                                                | 类型     | 状态 | 最后修改   |
| --------------------------------------------- | ------------------------------------------------------------------- | -------- | ---- | ---------- |
| `docs/testing-architecture.md`                | 测试架构总览：5 种测试方法、目录结构、散落文件收拢计划              | guide    | ✅   | 2026-06-11 |
| `docs/notification-interaction-manual.md`     | 通知交互操作手册：状态/通知/retry/权限 UI 分层                      | guide    | ✅   | 2026-06-05 |
| `docs/streaming-tool-card-debugging-guide.md` | 流式 Tool Card 调试指南：卡片重复/卡住/重连后异常排查               | guide    | ✅   | 2026-06-05 |
| `docs/lsp-extension-guide.md`                 | LSP 扩展功能实践指南：自动诊断 + 主动工具调用                       | guide    | ✅   | 2026-06-11 |
| `docs/session-switch-monitoring-guide.md`     | 会话切换性能监控手册：日志位置与指标解读                            | guide    | ✅   | 2026-05-10 |
| `docs/design-chat-timeline.md`                | Chat Timeline 组件架构设计：重构 chat/ 目录支撑混排与 Activity 系统 | design   | ✅   | 2026-04-24 |
| `docs/design-progressive-state-sync.md`       | 渐进式状态同步设计：首屏快可用、切换不卡、后台逐步到位              | design   | ✅   | 2026-05-30 |
| `docs/design-sidenav-interaction.md`          | SideNav 交互需求：选中态由点击决定，滚动不改选中                    | design   | ✅   | 2026-04-27 |
| `docs/design-tokens-analysis.md`              | Design Tokens 完整分析（含移动端与层级扩展）                        | design   | ✅   | 2026-05-18 |
| `docs/analysis-model-selection-logic.md`      | Model Selection 逻辑链分析：关键组件与 Store 路径                   | analysis | ✅   | 2026-06-03 |
| `docs/spec-agent-switching.md`                | Agent Switching 功能 Spec（Draft）                                  | spec     | ✅   | 2026-05-14 |
| `docs/permission-ui-verification-matrix.md`   | Permission UI 验证矩阵：权限提示/规则/状态的真实运行时验证跟踪      | guide    | ✅   | 2026-07-02 |
| `docs/agent-config-implementation-plan.md`    | AgentConfig 未实现字段实现计划（permissionMode/maxTurns 等）        | plan     | ✅   | 2026-05-30 |
| `docs/agent-config-e2e-test-plan.md`          | AgentConfig 字段 E2E 测试计划                                       | test     | ✅   | 2026-05-30 |
| `docs/followup-race-condition-fix.md`         | FollowUp 消息竞态丢失问题分析与修复                                 | bugfix   | ✅   | 2026-05-14 |

### 📝 工作流文档

| 文件                                                        | 摘要                                                                | 类型  | 状态 | 最后修改   |
| ----------------------------------------------------------- | ------------------------------------------------------------------- | ----- | ---- | ---------- |
| `docs/workflows/project-issue-orchestration.md`             | 项目 Issue 编排工作流：leader→worker→review→acceptance→merge 全流程 | guide | ✅   | 2026-07-02 |
| `docs/workflows/ssh-remote-runtime.md`                      | SSH Remote Runtime 冒烟测试与操作文档                               | guide | ✅   | 2026-07-02 |
| `docs/workflows/local-paired-worktree-stack.md`             | 本地 Paired Worktree Stack 工作流：app + fork 隔离开发栈            | guide | ✅   | 2026-06-28 |
| `docs/workflows/file-input-ops-guide.md`                    | File Input Ops Guide：read/@file/图片/大文本/vision 路由操作指南    | guide | ✅   | 2026-06-28 |
| `docs/workflows/apple-container-paired-worktree-sandbox.md` | Apple Container Paired Worktree Sandbox：容器隔离 Web 验证          | guide | ✅   | 2026-06-28 |
| `docs/workflows/electrobun-voice-input-repro-handoff.md`    | Electrobun 语音输入 Repro 交接文档：repro 资产管理建议              | guide | ✅   | 2026-06-27 |

### 🔧 配置与规则

| 文件                                   | 摘要                                                                    | 类型      | 状态    | 最后修改   |
| -------------------------------------- | ----------------------------------------------------------------------- | --------- | ------- | ---------- |
| `.claude/rules/clipboard.md`           | 剪贴板功能统一规范：必须用 copyToClipboard/useClipboard/CopyButton      | rule      | ✅      | 2026-04-29 |
| `.claude/rules/code-style.md`          | ESLint 规范规则：禁止 eslint-disable 注释，用 createLogger 替代 console | rule      | ✅      | 2026-04-24 |
| `.claude/rules/doc-outline-context.md` | 文档大纲上下文注入规则：会话启动优先引用 OUTLINE.md                     | rule      | ✅      | 2026-07-12 |
| `.claude/rules/timeline-extension.md`  | Timeline 组件扩展指南：Activity/ContentBlock/工具渲染器四种扩展场景     | rule      | ✅      | 2026-04-24 |
| `.opencode/design-system.md`           | OpenCode 设计系统规范：Token 定义与 UI 开发规范                         | guide     | ✅      | 2026-05-14 |
| `.opencode/outline.md`                 | OpenCode 项目进度大纲（2026-05-05 快照，已过期）                        | changelog | ⚠️ 过期 | 2026-05-05 |

### 🤖 Agent 定义

#### Pi Agent 定义 (`.pi/agents/`)

| 文件                            | 摘要                                                                      | 类型  | 状态 | 最后修改   |
| ------------------------------- | ------------------------------------------------------------------------- | ----- | ---- | ---------- |
| `.pi/agents/doc-curator.md`     | 项目文档大纲管理员：扫描 .md、维护结构化大纲、校验需求准确性              | agent | ✅   | 2026-07-12 |
| `.pi/agents/issue-manager.md`   | 项目级 Issue 管理者：派发验证、记录会话、创建 GitHub Issue                | agent | ✅   | 2026-06-30 |
| `.pi/agents/pi-issue-leader.md` | 项目级 Issue 协调者：拉取 issue、拆任务、委派开发、组织 Review            | agent | ✅   | 2026-07-02 |
| `.pi/agents/pi-worktree-dev.md` | 项目级开发执行者：隔离 worktree/paired fork 开发、端口/yalc 协调、PR 收口 | agent | ✅   | 2026-07-02 |

#### OpenCode Agent 定义 (`.opencode/agent/`)

| 文件                               | 摘要                                                              | 类型  | 状态 | 最后修改   |
| ---------------------------------- | ----------------------------------------------------------------- | ----- | ---- | ---------- |
| `.opencode/agent/leader.md`        | Leader agent：只读 + 委派编排，不直接编辑                         | agent | ✅   | 2026-05-21 |
| `.opencode/agent/pi-dev.md`        | pi-agent-chat 专属全栈开发智能体：自动判断是否涉及底层仓库        | agent | ✅   | 2026-05-16 |
| `.opencode/agent/pi-debug.md`      | 日志排查 & Debug 主智能体：读取服务端日志、定位 RPC/WS/Store 异常 | agent | ✅   | 2026-05-25 |
| `.opencode/agent/lsp-doctor.md`    | LSP 诊断专家：复盘、复现、回测 LSP 插件的触发时机与性能           | agent | ✅   | 2026-05-13 |
| `.opencode/agent/state-auditor.md` | Store-First 状态审计智能体：扫描违反 Store-First 规范的代码       | agent | ✅   | 2026-05-14 |

### 🧪 测试文档

#### 测试话术与计划

| 文件                              | 摘要                                                       | 类型 | 状态 | 最后修改   |
| --------------------------------- | ---------------------------------------------------------- | ---- | ---- | ---------- |
| `docs/test-dialogues.md`          | 全面测试话术手册总览：覆盖全部 UI 功能、扩展、Channel、RPC | test | ✅   | 2026-06-05 |
| `docs/test-dialogues-part-1.md`   | 测试话术手册第 1 卷：基础对话流                            | test | ✅   | 2026-06-05 |
| `docs/test-dialogues-part-2.md`   | 测试话术手册第 2 卷：模型与层级切换                        | test | ✅   | 2026-06-05 |
| `docs/test-dialogues-appendix.md` | 测试话术手册附录：扩展-Channel-RPC 映射表                  | test | ✅   | 2026-06-05 |
| `docs/mobile-test-plan.md`        | 移动端测试方案（T26.x）：agent-browser + Playwright        | test | ✅   | 2026-05-13 |

#### OpenCode UI 测试计划 (`.opencode/ui-plans/`)

| 文件                                                                    | 摘要                                   | 类型 | 状态 | 最后修改   |
| ----------------------------------------------------------------------- | -------------------------------------- | ---- | ---- | ---------- |
| `.opencode/ui-plans/overview.md`                                        | UI 测试计划总览：5173 前端 + 3100 后端 | test | ✅   | 2026-05-13 |
| `.opencode/ui-plans/pc-full-test-matrix.md`                             | PC 端全量测试矩阵                      | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/auth.md`                                    | 模块测试：auth/login 认证登录          | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/chat.md`                                    | 模块测试：chat 聊天面板                | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/chat-message-types.md`                      | 模块测试：消息类型渲染                 | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/chat-message-actions.md`                    | 模块测试：消息操作交互                 | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/chat-toolbars.md`                           | 模块测试：聊天区工具栏与特殊组件       | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/input-bar.md`                               | 模块测试：input-bar 输入栏             | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/explorer.md`                                | 模块测试：explorer 文件浏览器          | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/model-selector.md`                          | 模块测试：model-selector 模型选择器    | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/session.md`                                 | 模块测试：session 会话管理             | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/tab-bar.md`                                 | 模块测试：tab-bar 项目标签栏           | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/sidebar.md`                                 | 模块测试：左侧边栏 Sidebar             | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/status-panel.md`                            | 模块测试：status-panel 状态面板        | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/project-picker.md`                          | 模块测试：project-picker 项目选择器    | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/theme.md`                                   | 模块测试：theme 主题切换               | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/thinking-level.md`                          | 模块测试：thinking-level 思考级别      | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/tier-switcher.md`                           | 模块测试：tier-switcher 模型 Tier 快切 | test | ✅   | 2026-05-14 |
| `.opencode/ui-plans/modules/workspace.md`                               | 模块测试：工作区 Workspace             | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/git-panel.md`                               | 模块测试：Git 面板                     | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/memory-panel.md`                            | 模块测试：记忆面板                     | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/rpc-panel.md`                               | 模块测试：RPC 面板                     | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/rules-panel.md`                             | 模块测试：Rules 面板                   | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/snapshot-panel.md`                          | 模块测试：快照面板                     | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/diagnostic.md`                              | 模块测试：诊断面板                     | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/notification.md`                            | 模块测试：通知中心                     | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/shortcuts.md`                               | 模块测试：全局快捷键                   | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/responsive.md`                              | 模块测试：响应式/多设备测试            | test | ✅   | 2026-05-06 |
| `.opencode/ui-plans/modules/subagent-session-interaction.md`            | 模块测试：Subagent & 会话侧边栏交互    | test | ✅   | 2026-05-14 |
| `.opencode/ui-plans/modules/subagent-session-verification-checklist.md` | Subagent & 会话交互验证清单            | test | ✅   | 2026-05-14 |

#### Bug 记录 (`.opencode/ui-plans/bugs/`)

| 文件                                        | 摘要                                   | 类型 | 状态      | 最后修改   |
| ------------------------------------------- | -------------------------------------- | ---- | --------- | ---------- |
| `.opencode/ui-plans/bugs/2026-05-05-001.md` | Bug #001：auth/login 模块 P1 严重问题  | bug  | ✅ 已修复 | 2026-05-06 |
| `.opencode/ui-plans/bugs/2026-05-06-002.md` | Bug #002：chat 模块 P2 一般问题        | bug  | ✅ 已修复 | 2026-05-06 |
| `.opencode/ui-plans/bugs/2026-05-06-003.md` | Bug #003：theme 模块 P1 严重问题       | bug  | ✅ 已修复 | 2026-05-06 |
| `.opencode/ui-plans/bugs/2026-05-06-004.md` | Bug #004：theme/shortcuts 模块 P2 问题 | bug  | ✅ 已修复 | 2026-05-06 |
| `.opencode/ui-plans/bugs/2026-05-06-005.md` | Bug #005：sidebar 缺少折叠按钮 P3 轻微 | bug  | ✅ 已修复 | 2026-05-06 |
| `.opencode/ui-plans/bugs/2026-05-06-006.md` | Bug #006：rules-panel P3 问题          | bug  | ✅ 关闭   | 2026-05-06 |

### 🔍 Issue 追踪

| 文件                                                    | 摘要                                                           | 类型         | 状态 | 最后修改   |
| ------------------------------------------------------- | -------------------------------------------------------------- | ------------ | ---- | ---------- |
| `docs/issues/2026-07-03-recent-pr-issue-test-matrix.md` | 近期 PR/Issue 测试矩阵：2026-07-02 合并的 40 个 PR 验证范围    | requirements | ✅   | 2026-07-07 |
| `docs/issues/ctx-fs-capability-for-remote-sandbox.md`   | 架构提案：为 Extension 提供 ctx.fs capability 补齐远程能力缺口 | requirements | ✅   | 2026-07-07 |

### 📝 其他

#### OpenCode 命令与配置

| 文件                                | 摘要                                         | 类型    | 状态 | 最后修改   |
| ----------------------------------- | -------------------------------------------- | ------- | ---- | ---------- |
| `.opencode/commands/audit-state.md` | OpenCode 命令：扫描 Store-First 规范违规代码 | command | ✅   | 2026-05-14 |

#### 脚本报告 (`scripts/`)

| 文件                                     | 摘要                                              | 类型   | 状态      | 最后修改   |
| ---------------------------------------- | ------------------------------------------------- | ------ | --------- | ---------- |
| `scripts/FINAL-VERIFICATION-REPORT.md`   | 隔离开发环境最终验证报告（2026-07-11）            | report | ⚠️ 一次性 | 2026-07-11 |
| `scripts/ISOLATED-5183-README.md`        | 隔离开发环境 (5183/3102) 端口配置说明             | readme | ⚠️ 一次性 | 2026-07-11 |
| `scripts/ISOLATED-5183-SUMMARY.md`       | 隔离开发环境配置总结：反向代理、端口、进程        | report | ⚠️ 一次性 | 2026-07-11 |
| `scripts/PORT-ISOLATION-VERIFICATION.md` | 端口隔离验证报告：确认 5173/3100 未被隔离环境占用 | report | ⚠️ 一次性 | 2026-07-11 |
| `scripts/VERIFICATION-REPORT-3101.md`    | 端口 3101 访问验证报告                            | report | ⚠️ 一次性 | 2026-07-11 |
| `scripts/monitor-final-report.md`        | Progress Monitor 最终报告：121/130 (93.0%)        | report | ⚠️ 一次性 | 2026-06-19 |

---

## 🔍 需求文档校验

> 首次扫描暂不校验，标记为 unverified

| 需求文档           | 对应代码 | 校验状态 | 备注                          |
| ------------------ | -------- | -------- | ----------------------------- |
| _首次扫描暂不校验_ |          | ❓       | 后续运行 doc-curator 校验模式 |

---

## ⚠️ 健康告警

### 🔴 过期 / 一次性文档（建议清理或归档）

| 文件                                  | 问题                                                       | 建议                          |
| ------------------------------------- | ---------------------------------------------------------- | ----------------------------- |
| `.compaction-verify-plan.md`          | 根目录临时验证计划，已完成使命                             | 归档到 `docs/archive/` 或删除 |
| `.opencode/outline.md`                | 项目进度大纲停留在 2026-05-05 快照，已被本 OUTLINE.md 取代 | 归档或删除                    |
| `scripts/*.md` (6 个)                 | 一次性验证报告（端口隔离/环境验证），非长期文档            | 归档到 `docs/archive/` 或删除 |
| `.opencode/ui-plans/bugs/*.md` (6 个) | 全部已修复/关闭的 bug 记录                                 | 归档到 `docs/archive/bugs/`   |

### 🟡 内容重叠风险

| 文件组                                                                 | 问题                                     | 建议                       |
| ---------------------------------------------------------------------- | ---------------------------------------- | -------------------------- |
| `.opencode/design-system.md` ↔ `docs/design-tokens-analysis.md`        | 两份设计系统/Token 文档可能内容重叠      | 确认权威源，合并或互相引用 |
| `.claude/rules/timeline-extension.md` ↔ `docs/design-chat-timeline.md` | 规则引用设计文档，需确认设计文档仍为最新 | 定期同步检查               |

### 🟢 无告警

架构文档 (`docs/architecture/`)、实现计划 (`docs/plans/`)、UI 规范 (`docs/ui/`)、工作流 (`docs/workflows/`) 均结构清晰、路径规范。

---

## 📂 排除目录

以下目录的 `.md` 文件未纳入大纲（产物/临时/测试会话日志）：

| 目录                                        | 原因                          |
| ------------------------------------------- | ----------------------------- |
| `node_modules/`                             | 第三方依赖                    |
| `.yalc/`                                    | yalc 链接包                   |
| `dist/` `build/`                            | 构建产物                      |
| `.git/`                                     | Git 内部                      |
| `.codenomad/` `.design/` `.design_library/` | 设计资产/临时                 |
| `test-results/` `test-screenshots/`         | 测试截图与错误上下文产物      |
| `.ui-debugger/` `.ui-tester/`               | UI 测试会话知识库（自动生成） |
| `.trae-cn/`                                 | IDE worktree                  |
