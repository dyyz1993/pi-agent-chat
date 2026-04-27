# Changelog

## [Unreleased] - 2026-04-26

> 共 8 次提交，75 个文件变更，+1991 / -467 行

---

### Refactor

#### `df53684` 预览卡片组件统一重构

提取公共逻辑，统一各预览卡片的交互与渲染风格。

- **新增** `CardHeader` 组件 — 统一卡片头部布局（标题、操作按钮、展开/折叠）
- **新增** `use-clipboard` hook + `clipboard` 工具函数 — 复制到剪贴板能力复用
- **增强** `AudioCard` — 头部重构，支持播放控制
- **增强** `FallbackCard` — 统一 CardHeader 接入
- **增强** `HtmlCard` — iframe 沙箱安全策略 + 全屏预览
- **增强** `ImageCard` — 放大预览 + 复制链接
- **增强** `PdfCard` — 分页渲染 + 页码导航 + 缩放控制
- **增强** `UrlCard` — 链接预览卡片增强，favicon/摘要/截图展示
- **调整** `MarkdownCard` / `TextCard` / `VideoCard` — 接入 CardHeader

| 影响范围 | 文件 |
|---------|------|
| 新增 | `CardHeader.tsx`, `use-clipboard.ts`, `clipboard.ts` |
| 修改 | `AudioCard`, `FallbackCard`, `HtmlCard`, `ImageCard`, `MarkdownCard`, `PdfCard`, `TextCard`, `UrlCard`, `VideoCard` |

---

#### `ae7ba2a` 工具图标映射增强

- **增强** `tool-icon-map` — 扩充工具图标映射表，覆盖更多工具类型
- **删除** `ToolIconList` 组件 — 已被新架构替代，不再使用

---

### Features

#### `360ec52` 聊天核心优化

聊天主界面核心组件全面升级。

- **精简** `ChatPanel` — 移除冗余逻辑，优化渲染结构
- **增强** `MessageBubble` — 消息气泡渲染能力扩展，支持更多内容块类型
- **改进** `TokenStatusBar` — Token 用量状态栏展示优化
- **重构** `use-active-scroll-tracker` — 滚动追踪逻辑重写，提升自动滚动与手动滚动切换体验
- **调整** `message-mapper` — 消息映射逻辑适配新类型
- **扩展** `types/index` — ContentBlock 类型定义更新

---

#### `79187b6` Memory 面板（新功能）

新增完整的 Memory 管理面板，支持记忆条目的查看、搜索与管理。

- **新增** `MemoryPanel` 组件 — 记忆面板 UI，支持列表展示/搜索过滤/分页
- **新增** `use-memory-store` — Memory 状态管理（Zustand store）
- **新增** `memory` handler — 后端 RPC handler，处理记忆相关请求
- **新增** `memory` module — 后端业务模块，提供记忆 CRUD 能力

| 层级 | 文件 |
|------|------|
| UI 组件 | `components/memory-panel/MemoryPanel.tsx` |
| Store | `stores/use-memory-store.ts` |
| Handler | `shared/handlers/memory.ts` |
| Module | `shared/modules/memory.ts` |

---

### Refactor

#### `06a4e24` Store 层重构

状态管理层架构优化与能力扩展。

- **精简** `use-chat-store` — 移除冗余逻辑，职责下沉
- **增强** `use-session-store` — 集成子代理生命周期管理，扩展事件处理
- **增强** `use-subagent-store` — 子代理状态管理增强，支持嵌套代理
- **扩展** `use-status-store` — 新增状态字段
- **调整** `use-chat-nav-store` — 移除不再使用的导航逻辑
- **优化** `message-batcher` — 消息批处理策略调整

---

### Features

#### `abd4a23` 后端增强

后端基础设施与业务能力全面提升。

- **扩展** `process-manager` — 进程管理能力增强，新增进程查询与控制接口
- **补充** `handlers` — agent handler 路由补充，handler 索引更新
- **优化** `project-config` — 项目配置加载与解析逻辑优化
- **新增** `project` module — 项目级能力扩展
- **调整** `agent` module — agent 模块接口适配
- **更新** `rpc-schema` — RPC 协议定义更新

---

### Fixes

#### `b337cbf` 侧栏与面板微调

各 UI 面板样式与功能细节修正。

- `ExplorerSidebar` — 文件浏览器修正
- `GitPanel` — Git 操作面板样式调整
- `RightSidebar` — 右侧栏集成 Memory 入口
- `RpcPanel` — RPC 调试面板优化
- `SessionSidebar` — 会话侧栏交互修正
- `StatusPanel` — 状态面板展示优化

---

### Chores

#### `9c2a843` 杂项更新

资源文件与配置更新。

- **调整** `App.tsx` — 应用入口集成新面板
- **修正** `layouts/types` — 布局类型定义更新
- **新增** `icons/` — 20 个通用 SVG 图标（home/user/settings/search/heart/star/bell/message/folder/cloud/plus/close/check/share/lightning/camera/lock/play/chart/rocket）
- **新增** `logo.svg` — 应用 Logo
- **新增** `preview-test/` — 预览卡片测试资源（html/css/js/json/md/pdf）
- **新增** `test-page.html` — 测试页面
