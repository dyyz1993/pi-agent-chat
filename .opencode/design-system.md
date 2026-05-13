# pi-agent-chat 设计系统规范

> 本文档是项目设计规范的唯一权威参考。所有 UI 开发必须遵循此规范。
> Token 定义源文件：`src/mainview/index.css`

---

## 1. 设计 Token（Design Tokens）

### 1.1 颜色体系

#### 背景色

| Token                  | Light             | Dark              | 用途                                |
| ---------------------- | ----------------- | ----------------- | ----------------------------------- |
| `--color-bg-primary`   | `#ffffff`         | `#0a0c10`         | 主背景、内容区                      |
| `--color-bg-secondary` | `#f3f4f6`         | `#111827`         | 次级背景、侧边栏、分组区域          |
| `--color-bg-tertiary`  | `#e5e7eb`         | `#1f2937`         | 三级背景、hover 状态、分割区域      |
| `--color-bg-elevated`  | `#ffffff`         | `#1f2937`         | 浮层背景（弹出层、下拉框、Tooltip） |
| `--color-bg-overlay`   | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.6)` | 全屏遮罩背景                        |

**使用规则**：

- 页面主体用 `primary`
- 侧边栏、面板底色用 `secondary`
- 悬浮/弹出层用 `elevated`（确保与 primary 有对比）
- 遮罩层用 `overlay`

#### 文字色

| Token                    | Light     | Dark      | 用途                         |
| ------------------------ | --------- | --------- | ---------------------------- |
| `--color-text-primary`   | `#111827` | `#f9fafb` | 主要文字（标题、正文）       |
| `--color-text-secondary` | `#6b7280` | `#9ca3af` | 次要文字（描述、辅助信息）   |
| `--color-text-tertiary`  | `#9ca3af` | `#6b7280` | 三级文字（时间戳、占位符）   |
| `--color-text-inverse`   | `#ffffff` | `#111827` | 反色文字（深色背景上的文字） |

**使用规则**：

- 标题和关键内容用 `primary`
- 副标题、描述用 `secondary`
- 时间戳、元数据用 `tertiary`
- 在 accent 色背景上用 `inverse`

#### 边框色

| Token                      | Light     | Dark      | 用途                             |
| -------------------------- | --------- | --------- | -------------------------------- |
| `--color-border-primary`   | `#e5e7eb` | `#1f2937` | 主要边框（分割线、卡片边框）     |
| `--color-border-secondary` | `#d1d5db` | `#374151` | 次要边框（更明显的分割）         |
| `--color-border-focus`     | `#6366f1` | `#818cf8` | 焦点边框（输入框聚焦、tab 选中） |

#### 强调色（Accent / Indigo）

| Token                  | Light                   | Dark                     | 用途                             |
| ---------------------- | ----------------------- | ------------------------ | -------------------------------- |
| `--color-accent`       | `#6366f1`               | `#818cf8`                | 主强调色（按钮、链接、高亮）     |
| `--color-accent-hover` | `#4f46e5`               | `#6366f1`                | 强调色 hover                     |
| `--color-accent-muted` | `rgba(99,102,241,0.15)` | `rgba(129,140,248,0.15)` | 强调色淡化（Tag 背景、选中底色） |
| `--color-accent-text`  | `#4f46e5`               | `#a5b4fc`                | 强调色文字                       |

#### 状态色

| Token             | Light     | Dark      | 语义             |
| ----------------- | --------- | --------- | ---------------- |
| `--color-success` | `#22c55e` | `#4ade80` | 成功、完成、在线 |
| `--color-warning` | `#f59e0b` | `#fbbf24` | 警告、注意       |
| `--color-error`   | `#ef4444` | `#f87171` | 错误、失败、离线 |
| `--color-info`    | `#3b82f6` | `#60a5fa` | 信息、提示       |

#### Diff 专用色

| Token                    | Light     | Dark      | 用途         |
| ------------------------ | --------- | --------- | ------------ |
| `--diff-bg`              | gray-100  | gray-900  | Diff 背景色  |
| `--diff-added-bg`        | green-100 | green-950 | 新增行背景   |
| `--diff-removed-bg`      | red-100   | red-950   | 删除行背景   |
| `--diff-word-added-bg`   | green-200 | green-800 | 新增文字背景 |
| `--diff-word-removed-bg` | red-200   | red-900   | 删除文字背景 |
| `--diff-gutter-bg`       | gray-200  | gray-800  | 行号区域背景 |

---

### 1.2 间距（Spacing）

| Token           | 值              | 使用场景                   |
| --------------- | --------------- | -------------------------- |
| `--spacing-xs`  | `0.25rem (4px)` | 图标与文字间距、紧凑内边距 |
| `--spacing-sm`  | `0.5rem (8px)`  | 组件内 padding、小间距     |
| `--spacing-md`  | `1rem (16px)`   | 标准间距、卡片 padding     |
| `--spacing-lg`  | `1.5rem (24px)` | 区块间距、大 padding       |
| `--spacing-xl`  | `2rem (32px)`   | 区域分隔                   |
| `--spacing-2xl` | `3rem (48px)`   | 页面级分隔                 |

**使用规则**：

- 同一组件内部的元素间距用 `xs` 或 `sm`
- 卡片/面板的内边距用 `md`
- 不同功能区块之间用 `lg` 或 `xl`

---

### 1.3 圆角（Border Radius）

| Token           | 值               | 使用场景             |
| --------------- | ---------------- | -------------------- |
| `--radius-sm`   | `0.25rem (4px)`  | 小按钮、Badge、Tag   |
| `--radius-md`   | `0.5rem (8px)`   | 按钮、输入框、下拉框 |
| `--radius-lg`   | `0.75rem (12px)` | 卡片、面板、弹窗     |
| `--radius-xl`   | `1rem (16px)`    | 大面板、对话框       |
| `--radius-full` | `9999px`         | 头像、圆形按钮、Pill |

---

### 1.4 阴影（Shadows）

| Token         | Light                              | Dark                               | 使用场景       |
| ------------- | ---------------------------------- | ---------------------------------- | -------------- |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)`       | `0 1px 2px rgba(0,0,0,0.3)`        | 微弱阴影、卡片 |
| `--shadow-md` | `0 4px 6px -1px rgba(0,0,0,0.1)`   | `0 4px 6px -1px rgba(0,0,0,0.4)`   | 弹出层、下拉框 |
| `--shadow-lg` | `0 10px 15px -3px rgba(0,0,0,0.1)` | `0 10px 15px -3px rgba(0,0,0,0.4)` | 模态框、浮层   |
| `--shadow-xl` | `0 20px 25px -5px rgba(0,0,0,0.1)` | `0 20px 25px -5px rgba(0,0,0,0.5)` | 全屏弹出       |

---

### 1.5 字体

| Token         | 值                                                  | 用途           |
| ------------- | --------------------------------------------------- | -------------- |
| `--font-sans` | `ui-sans-serif, system-ui, -apple-system, ...`      | 正文、UI 文字  |
| `--font-mono` | `ui-monospace, SFMono-Regular, SF Mono, Menlo, ...` | 代码、终端输出 |

#### 字号

| Token         | 值                | 使用场景               |
| ------------- | ----------------- | ---------------------- |
| `--text-xs`   | `0.75rem (12px)`  | 元数据、时间戳、Badge  |
| `--text-sm`   | `0.875rem (14px)` | 次要文字、列表项、描述 |
| `--text-base` | `1rem (16px)`     | 正文、主要 UI 文字     |
| `--text-lg`   | `1.125rem (18px)` | 标题、强调             |

#### 行高

| Token               | 值     | 使用场景     |
| ------------------- | ------ | ------------ |
| `--leading-tight`   | `1.25` | 标题         |
| `--leading-normal`  | `1.5`  | 正文         |
| `--leading-relaxed` | `1.75` | 长文、代码块 |

---

### 1.6 Z-index 层级

| Token          | 值    | 使用场景          |
| -------------- | ----- | ----------------- |
| `--z-base`     | `0`   | 默认内容          |
| `--z-overlay`  | `10`  | 侧边栏遮罩        |
| `--z-dropdown` | `50`  | 下拉菜单          |
| `--z-sticky`   | `100` | 固定头部、Tab 栏  |
| `--z-modal`    | `200` | 模态框、对话框    |
| `--z-popover`  | `300` | 弹出提示、Tooltip |
| `--z-toast`    | `400` | 通知、Toast       |

**使用规则**：

- 不得使用硬编码的 z-index 值
- 自定义弹出层优先用对应的 CSS 变量
- 如果需要新的层级，先在 `index.css` 中定义 Token

---

### 1.7 动画与过渡

| Token                 | 值           | 使用场景                   |
| --------------------- | ------------ | -------------------------- |
| `--transition-fast`   | `150ms ease` | hover 颜色变化、小元素位移 |
| `--transition-normal` | `200ms ease` | 面板展开/收起、Tab 切换    |
| `--transition-slow`   | `300ms ease` | 页面过渡、大面板动画       |

#### Tailwind 动画

| 类名                     | 动画                      | 用途         |
| ------------------------ | ------------------------- | ------------ |
| `animate-slide-in-left`  | `200ms ease-out` 从左滑入 | 左侧边栏展开 |
| `animate-slide-in-right` | `200ms ease-out` 从右滑入 | 右侧面板展开 |
| `animate-slide-in-up`    | `250ms ease-out` 从下滑入 | 底部弹出面板 |

---

### 1.8 安全区域（Safe Area）

| Token                | 值                            | 用途                           |
| -------------------- | ----------------------------- | ------------------------------ |
| `--safe-area-top`    | `env(safe-area-inset-top)`    | 刘海屏顶部安全距离             |
| `--safe-area-bottom` | `env(safe-area-inset-bottom)` | 底部安全距离（Home Indicator） |
| `--safe-area-left`   | `env(safe-area-inset-left)`   | 左侧安全距离（横屏）           |
| `--safe-area-right`  | `env(safe-area-inset-right)`  | 右侧安全距离（横屏）           |

**Tailwind 类**：`p-safe-top`、`m-safe-bottom` 等

**全屏组件规则**：所有 `fixed inset-0` 的全屏组件必须：

1. Header 加 `paddingTop: "calc(<base>rem + env(safe-area-inset-top, 0px))"`
2. 容器/底部加 `paddingBottom: "env(safe-area-inset-bottom, 0px)"`
3. 关闭按钮最小 44px 触摸区域
4. 必须有可见的关闭/退出按钮

---

### 1.9 触摸目标

| Token                | 值     | 说明                       |
| -------------------- | ------ | -------------------------- |
| `--touch-target-min` | `44px` | Apple HIG 最小触摸目标尺寸 |

**使用规则**：

- 所有可点击元素的点击区域 ≥ 44px
- 小图标按钮需通过 padding 补足到 44px（`p-2` + `w-4 h-4` 图标 ≈ 40px）
- 移动端 < 768px 时按钮最小尺寸 28px（CSS 中已有 `min-width/min-height` 规则）

---

## 2. 响应式设计

### 2.1 断点

| 名称    | 宽度        | Tailwind 前缀        | 典型设备           |
| ------- | ----------- | -------------------- | ------------------ |
| mobile  | < 640px     | `sm:` (反向 max-sm:) | iPhone, 小屏手机   |
| tablet  | 640–1024px  | `md:`                | iPad, Android 平板 |
| desktop | 1024–1440px | `lg:`                | 笔记本、小桌面     |
| wide    | ≥ 1440px    | `xl:`                | 大显示器           |

### 2.2 响应式约定

| 元素               | Desktop     | Mobile/Tablet                                                 |
| ------------------ | ----------- | ------------------------------------------------------------- |
| 侧边栏             | 固定/可钉住 | 85% 宽遮罩浮层 (`bg-black/50`)                                |
| Pin/Collapse 按钮  | 可见        | 隐藏 (`max-sm:hidden`)                                        |
| QuickActionToolbar | 隐藏        | 显示                                                          |
| Tab 关闭按钮       | hover 显示  | 始终显示                                                      |
| 侧边栏滚动条       | 系统滚动条  | 隐藏 (`.sidenav-scroll::-webkit-scrollbar { display: none }`) |

---

## 3. 颜色语义规范（Timeline & 工具状态）

### 3.1 工具/状态颜色

| 语义      | Tailwind Class    | 适用场景                         |
| --------- | ----------------- | -------------------------------- |
| 成功/完成 | `text-green-400`  | 工具执行成功、测试通过、构建完成 |
| 警告/注意 | `text-amber-400`  | 压缩、资源警告、非致命问题       |
| 重试/异常 | `text-orange-400` | 自动重试、降级、部分失败         |
| 错误/失败 | `text-red-400`    | 错误、LSP 异常、构建失败         |
| 信息/中性 | `text-blue-400`   | 文件读取、通用工具调用           |
| 模型/AI   | `text-purple-400` | 模型切换、AI 相关操作            |
| 规则/配置 | `text-cyan-400`   | 规则加载、配置变更               |
| 记忆/数据 | `text-teal-400`   | 记忆检索、数据库操作             |
| 次要/低优 | `text-gray-400`   | 队列更新、背景活动               |

**使用规则**：

- 每种语义只对应一种颜色，不得混用
- 新增语义颜色前先检查此表是否已有匹配项

### 3.2 Activity 优先级

| priority    | 内嵌模式          | 独立模式      | 适用场景                   |
| ----------- | ----------------- | ------------- | -------------------------- |
| `prominent` | 默认展开 + 背景色 | icon 脉冲动画 | Agent 生命周期、关键操作   |
| `normal`    | 默认展开          | 标准样式      | 模型切换、重试、删除       |
| `subtle`    | 默认折叠 + 半透明 | 更小字号      | 压缩、队列、书签、思考级别 |

---

## 4. 主题切换

### 4.1 机制

- **管理 Store**：`src/mainview/stores/use-theme-store.ts`
- **模式**：`light` / `dark` / `system`
- **持久化**：localStorage key `pi-theme`
- **切换方式**：在 `<html>` 标签上添加/移除 `dark` class

### 4.2 规则

- 所有颜色**必须**使用 CSS 变量或 Tailwind 的 `dark:` 前缀
- **禁止**硬编码颜色值（如 `color: #111`）
- 新增颜色必须同时在 `:root` 和 `html.dark` 中定义

---

## 5. 基础组件原语

Timeline / 工具渲染器可复用的基础组件：

| 原语       | 用途                              | 路径                                      |
| ---------- | --------------------------------- | ----------------------------------------- |
| `AnsiText` | ANSI 转义序列渲染（终端彩色输出） | `components/chat/primitives/AnsiText.tsx` |

> 注意：`CollapsibleCard`、`StatusBadge`、`CodeBlock`、`IconLabel`、`StreamingCursor` 在 `.claude/rules/timeline-extension.md` 中有设计规划，实际组件可能尚未全部实现。开发前先用 `glob` 确认组件文件是否存在。

---

## 6. 焦点与键盘交互

### 6.1 焦点样式

所有可交互元素（`button`、`a`、`[tabindex]`）的 focus-visible 样式：

```css
ring-2 ring-indigo-500 ring-offset-2 ring-offset-white dark:ring-offset-gray-950
```

### 6.2 键盘规范

- 所有弹窗、模态框必须支持 ESC 关闭
- Tab 键必须能在可交互元素间正确导航
- 模态框使用 `useFocusTrap` hook 捕获键盘焦点

---

## 7. 通用交互规范

### 7.1 Resize Handle

- 宽度 4px，hover 区域 12px（向两侧各扩展 4px）
- hover 时显示 3rem 高的强调色指示条
- `touch-action: none` 防止触摸冲突

### 7.2 侧边栏

- 钉住状态和宽度持久化到 localStorage
- 宽度范围约束由 `use-sidebar-store.ts` 管理

### 7.3 复制功能

统一使用三种入口（禁止自行实现）：

| 场景                        | 使用                         |
| --------------------------- | ---------------------------- |
| 需要独立复制按钮            | `CopyButton` 组件            |
| 需要自定义 UI + copied 状态 | `useClipboard` hook          |
| 非 React 环境或简单复制     | `copyToClipboard()` 工具函数 |

详见 `.claude/rules/clipboard.md`

---

## 8. Diff 显示

- 使用专门的 Diff CSS 变量（`--diff-*`），不使用通用颜色
- 新增行：绿色背景 + 绿色文字
- 删除行：红色背景 + 红色文字
- 行号区域：灰色背景 + 灰色文字

---

## 9. Prose（Markdown 渲染）

- 标题尺寸缩减（h1: 1.25em, h2: 1.125em, h3: 1.0625em）避免在聊天中过于突出
- 表格 `display: block` + `overflow-x: auto` 水平滚动
- 代码块 `white-space: pre-wrap` + `word-break: break-word` 自动换行
