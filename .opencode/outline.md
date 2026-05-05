# PiAgentChat 项目进度大纲

## 会话信息

- **最后更新**: 2026-05-05
- **Git 状态**: master 分支，已推送到 github.com:dyyz1993/pi-agent-chat

---

## 已完成功能清单

### 🔒 安全修复

- [x] Mermaid XSS → securityLevel: "strict"
- [x] SVG XSS → sanitizeSvg() 清洗函数
- [x] 硬编码 Token 移除（前端 + 后端）
- [x] 开发者本地路径 → 强制环境变量

### 🏗️ 功能实现

- [x] Snapshot 快照模块（6 RPC + handler + store + UI + 19 测试）
- [x] 前端消息分页（游标加载 + 向上加载更多 + 6 测试）
- [x] 跨项目桥接（link/unlink/list + 13 测试）
- [x] browseFolder 桌面端原生对话框（5 测试）
- [x] 附件/图片上传（上传 API + 预览条 + 7 测试）
- [x] Subagent 重命名/删除（inline edit + 7 测试）

### 🎨 主题系统

- [x] Tailwind dark: class 策略
- [x] 亮色/暗色/跟随系统 三模式
- [x] localStorage 持久化
- [x] ThemeMenu 切换 UI
- [x] 71 个组件全部适配
- [x] Mermaid/Prism/DiffViewer 动态主题切换

### 🌐 国际化 (i18n)

- [x] react-i18next 基础设施
- [x] 11 个 namespace × 2 语言 = 22 个翻译文件
- [x] ~250 个翻译 key
- [x] 48 个组件 i18n 替换（~400 处调用）
- [x] 语言切换 UI（ThemeMenu 集成）
- [x] 自动检测浏览器语言 + localStorage 持久化
- [x] 8 个 i18n 单元测试

### 🧪 测试覆盖

- [x] 后端 Handler 测试：7 个文件，65 个用例
- [x] 前端 Store 测试：5 个文件，89 个用例
- [x] 功能测试：snapshot/pagination/linked-projects/upload/browse-folder/subagent
- [x] 键盘导航测试：7 个用例
- [x] E2E 测试：6 个 spec，13 个用例
- [x] 主题 Store 测试：5 个用例
- [x] 总计：~240 个新增测试

### 🔧 工程规范

- [x] ESLint: 0 errors, 0 warnings
- [x] Prettier: 全量格式化
- [x] EditorConfig: 统一编辑器设置
- [x] commitlint: conventional + 项目 scope 枚举
- [x] lint-staged: pre-commit 增量检查
- [x] Husky: pre-commit + commit-msg hooks
- [x] 自定义 RPC ESLint 插件（7 条规则）

### 🚀 CI/CD

- [x] GitHub Actions: Lint + TypeCheck + Test + Build
- [x] Playwright E2E pipeline
- [x] Bun 版本固定
- [x] 集成测试排除（需 agent 后端）

### ⚡ 性能优化

- [x] LogViewer 虚拟化（@tanstack/react-virtual）
- [x] WebSocket 指数退避重连
- [x] Vite 构建 manualChunks 分块
- [x] 移除无效 useMemo

### ♿ 可访问性

- [x] aria 属性（dialog/expand/progressbar/icon button）
- [x] 键盘导航（ContextMenu/文件树/QuickActionToolbar）
- [x] Focus trap（所有模态对话框）
- [x] data-testid（15+ 核心元素）

### 🧹 代码质量

- [x] z-index 统一管理
- [x] 硬编码颜色 → Tailwind token
- [x] 46 处空 catch 块添加日志
- [x] 无效 workspace 配置移除
- [x] 包管理器统一（bun）
- [x] .env.example 补全（18 个变量）
- [x] 死按钮移除/实现

---

## 已知待办（低优先级）

| #   | 项目             | 说明                                                          |
| --- | ---------------- | ------------------------------------------------------------- |
| 1   | E2E 扩展         | 需 agent 后端支持，目前仅基础 UI 测试                         |
| 2   | 测试覆盖深化     | git-store、explorer-store、mermaid-store 等仍无测试           |
| 3   | E2E 集成测试迁移 | rpc-client/session-ready/refresh-recovery 可迁移到 Playwright |

---

## 技术栈

| 类别     | 技术                                   |
| -------- | -------------------------------------- |
| 运行时   | Bun                                    |
| 桌面框架 | Electrobun                             |
| 前端框架 | React 18 + TypeScript                  |
| 构建     | Vite 6                                 |
| CSS      | Tailwind CSS 3 + dark mode             |
| 状态管理 | Zustand                                |
| RPC      | @dyyz1993/rpc-core (WebSocket + IPC)   |
| 国际化   | react-i18next                          |
| 测试     | Vitest + @testing-library + Playwright |
| Lint     | ESLint 9 + Prettier + commitlint       |
| AI Agent | @dyyz1993/pi-coding-agent              |
