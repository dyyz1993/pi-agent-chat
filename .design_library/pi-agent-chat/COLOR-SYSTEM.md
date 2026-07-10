# pi-agent-chat 颜色系统规范

## 一、项目颜色体系总览

项目在 `src/mainview/index.css` 中定义了完整的 CSS 变量系统，通过 `tailwind.config.js` 的 `tokenColor()` 函数桥接到 Tailwind 类名，实现 light/dark 双模式自动切换。

### 1.1 背景色（Background）

| CSS 变量               | Light                 | Dark              | 用途                   | Tailwind 类名     |
| ---------------------- | --------------------- | ----------------- | ---------------------- | ----------------- |
| `--color-bg-primary`   | `#edf1f6`             | `#0b111a`         | 页面主背景 (html/body) | `bg-bg-primary`   |
| `--color-bg-secondary` | `#f8fafc`             | `#111827`         | 侧边栏/Tab Bar 背景    | `bg-bg-secondary` |
| `--color-bg-tertiary`  | `#e7edf4`             | `#142033`         | 三级背景               | `bg-bg-tertiary`  |
| `--color-bg-elevated`  | `#ffffff`             | `#121b28`         | 卡片/弹窗/提升层级     | `bg-bg-elevated`  |
| `--color-bg-overlay`   | `rgba(12,18,28,0.48)` | `rgba(0,0,0,0.6)` | 遮罩层                 | `bg-bg-overlay`   |

### 1.2 文本色（Text）

| CSS 变量                 | Light     | Dark      | 用途                    | Tailwind 类名         |
| ------------------------ | --------- | --------- | ----------------------- | --------------------- |
| `--color-text-primary`   | `#17202e` | `#f2f6fb` | 主文本（标题/正文）     | `text-text-primary`   |
| `--color-text-secondary` | `#4f5f72` | `#c1cad6` | 次级文本（描述/标签）   | `text-text-secondary` |
| `--color-text-tertiary`  | `#7d8a9c` | `#8a96a8` | 三级文本（辅助/占位符） | `text-text-tertiary`  |
| `--color-text-inverse`   | `#f7fafc` | `#0a0c10` | 反色文本（反转背景上）  | `text-text-inverse`   |

### 1.3 边框色（Border）

| CSS 变量                   | Light     | Dark      | 用途       | Tailwind 类名             |
| -------------------------- | --------- | --------- | ---------- | ------------------------- |
| `--color-border-primary`   | `#dce4ee` | `#334155` | 主边框     | `border-border-primary`   |
| `--color-border-secondary` | `#c7d2df` | `#475569` | 次级边框   | `border-border-secondary` |
| `--color-border-focus`     | `#246df3` | `#746cff` | 焦点态边框 | `border-border-focus`     |

### 1.4 强调色（Accent）

| CSS 变量               | Light                   | Dark                     | 用途                  | Tailwind 类名              |
| ---------------------- | ----------------------- | ------------------------ | --------------------- | -------------------------- |
| `--color-accent`       | `#246df3`               | `#746cff`                | 主强调色（选中/品牌） | `bg-accent`, `text-accent` |
| `--color-accent-hover` | `#1958c9`               | `#8d88ff`                | 强调色悬停            | `bg-accent-hover`          |
| `--color-accent-muted` | `rgba(36,109,243,0.11)` | `rgba(116,108,255,0.18)` | 弱化强调背景          | `bg-accent-muted`          |
| `--color-accent-text`  | `#1d58c8`               | `#a8b0ff`                | 强调色上的文字        | `text-accent-text`         |
| `--color-accent-brand` | `#246df3`               | `#2db6e8`                | 品牌强调色            | `bg-accent-brand`          |
| `--color-accent-idle`  | `#16845f`               | `#46dd89`                | 空闲状态              | `bg-accent-idle`           |
| `--color-accent-agent` | `#7f55cc`               | `#ae7aff`                | Agent 强调            | `bg-accent-agent`          |

### 1.5 状态色（Status）

| CSS 变量          | Light     | Dark      | 用途 | Tailwind 类名                                 |
| ----------------- | --------- | --------- | ---- | --------------------------------------------- |
| `--color-success` | `#16845f` | `#46dd89` | 成功 | `text-status-success`, `bg-status-success/XX` |
| `--color-warning` | `#b36b00` | `#eab308` | 警告 | `text-status-warning`                         |
| `--color-error`   | `#cf3654` | `#f87171` | 错误 | `text-status-error`                           |
| `--color-info`    | `#246df3` | `#2db6e8` | 信息 | `text-status-info`                            |

状态色 RGB 分量（用于 Tailwind opacity 语法如 `bg-status-success/10`）：

| 变量                     | Light (R G B) | Dark (R G B)  |
| ------------------------ | ------------- | ------------- |
| `--color-status-success` | `22 132 95`   | `70 221 137`  |
| `--color-status-error`   | `207 54 84`   | `248 113 113` |
| `--color-status-warning` | `179 107 0`   | `234 179 8`   |
| `--color-status-info`    | `36 109 243`  | `45 182 232`  |

### 1.6 语义色（Semantic）—— 工具类型颜色

| CSS 变量                  | Light (RGB)  | Light (Hex) | Dark (RGB)    | Dark (Hex) | 用途               | Tailwind 类名                                 |
| ------------------------- | ------------ | ----------- | ------------- | ---------- | ------------------ | --------------------------------------------- |
| `--color-semantic-agent`  | `127 85 204` | `#7f55cc`   | `174 122 255` | `#ae7aff`  | Agent/思考/委托    | `text-semantic-agent`, `bg-semantic-agent/XX` |
| `--color-semantic-tool`   | `0 128 149`  | `#008095`   | `45 212 232`  | `#2dd4e8`  | 工具执行/Bash/终端 | `text-semantic-tool`                          |
| `--color-semantic-memory` | `30 140 113` | `#1e8c71`   | `45 212 191`  | `#2dd4bf`  | 记忆/知识库        | `text-semantic-memory`                        |
| `--color-semantic-accent` | `36 109 243` | `#246df3`   | `45 182 232`  | `#2db6e8`  | 用户/通用强调      | `text-semantic-accent`                        |
| `--color-semantic-notify` | `186 86 36`  | `#ba5624`   | `251 146 60`  | `#fb923c`  | 通知/分支/Git      | `text-semantic-notify`                        |
| `--color-semantic-line`   | —            | `#dce4ee`   | —             | `#2b394d`  | 分隔线             | `border-semantic-line`                        |

### 1.7 工具 → 语义色映射表（tool-icon-map.ts）

| 工具/操作类型                                                   | 语义分类 | 颜色（Dark）   | 左边框（block-border）        |
| --------------------------------------------------------------- | -------- | -------------- | ----------------------------- |
| subagent / session_delegate / delegate / code / mcp / ui_editor | Agent    | `#ae7aff` 紫   | `border-l-semantic-agent/60`  |
| fork / git                                                      | Notify   | `#fb923c` 橙   | `border-l-semantic-notify/60` |
| read / web / fetch / lsp / lsp_health                           | Info     | `#2db6e8` 蓝   | `border-l-status-info/60`     |
| edit / write / preview / ui_confirm                             | Success  | `#46dd89` 绿   | `border-l-status-success/60`  |
| search / grep / glob / folder / todo / ui_input                 | Warning  | `#eab308` 黄   | `border-l-status-warning/70`  |
| terminal / bash / lsp_exec / bash_background_process            | Tool     | `#2dd4e8` 青   | `border-l-semantic-tool/60`   |
| db                                                              | Memory   | `#2dd4bf` 青绿 | `border-l-semantic-memory/50` |
| user                                                            | Accent   | `#2db6e8` 蓝   | `border-l-status-info/60`     |
| assistant                                                       | Success  | `#46dd89` 绿   | `border-l-status-success/60`  |

### 1.8 Diff 颜色

| CSS 变量                 | Light     | Dark      | 用途         |
| ------------------------ | --------- | --------- | ------------ |
| `--diff-bg`              | `#f4f7fb` | `#111b2a` | Diff 主背景  |
| `--diff-color`           | `#17202e` | `#d6deea` | Diff 文本    |
| `--diff-added-bg`        | `#dff6ea` | `#102719` | 新增行背景   |
| `--diff-added-color`     | `#0e6e4e` | `#72df9d` | 新增行文本   |
| `--diff-removed-bg`      | `#ffe2e9` | `#2f151e` | 删除行背景   |
| `--diff-removed-color`   | `#b42345` | `#ff8a9c` | 删除行文本   |
| `--diff-word-added-bg`   | `#c4ecd5` | `#183d28` | 新增单词高亮 |
| `--diff-word-removed-bg` | `#ffc6d2` | `#48202b` | 删除单词高亮 |
| `--diff-gutter-bg`       | `#e8eef6` | `#182538` | 行号列背景   |
| `--diff-gutter-color`    | `#69778a` | `#94a3b8` | 行号文本     |
| `--diff-highlight-bg`    | `#dce6f1` | `#24344a` | 高亮背景     |

### 1.9 Surface 色

| CSS 变量          | Light     | Dark      | 用途                 |
| ----------------- | --------- | --------- | -------------------- |
| `--surface-code`  | `#eef4fa` | `#0e1724` | 代码块背景           |
| `--surface-hover` | `#eef3f9` | `#1a2638` | 悬停背景             |
| `--surface-dim`   | `#f4f7fb` | `#121b28` | 弱化背景（工具卡片） |

### 1.10 阴影

| CSS 变量            | Light                                                           | Dark                                                                | 用途                   |
| ------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------- |
| `--shadow-sm`       | `0 1px 2px rgba(16,24,40,0.06)`                                 | `0 1px 2px rgba(0,0,0,0.3)`                                         | 小阴影                 |
| `--shadow-md`       | `0 10px 24px -18px rgba(16,24,40,0.3)`                          | `0 4px 6px -1px rgba(0,0,0,0.4), 0 2px 4px -2px rgba(0,0,0,0.3)`    | 中阴影                 |
| `--shadow-lg`       | `0 18px 42px -26px rgba(16,24,40,0.38)`                         | `0 10px 15px -3px rgba(0,0,0,0.4), 0 4px 6px -4px rgba(0,0,0,0.3)`  | 大阴影                 |
| `--shadow-xl`       | `0 28px 64px -34px rgba(16,24,40,0.45)`                         | `0 20px 25px -5px rgba(0,0,0,0.5), 0 8px 10px -6px rgba(0,0,0,0.4)` | 超大阴影               |
| `--shadow-subtle`   | `0 1px 0 rgba(255,255,255,0.78), 0 1px 2px rgba(16,24,40,0.06)` | `0 1px 0 rgba(255,255,255,0.035), 0 1px 2px rgba(0,0,0,0.3)`        | 微妙阴影（含上边框线） |
| `--shadow-floating` | 同 shadow-lg light                                              | 同 shadow-xl dark                                                   | 浮动元素               |

---

## 二、已发现的问题

### 问题 1：`--color-info` 与 `--color-accent` Light 模式重复

- **现状**: Light 模式下 `--color-info: #246df3` = `--color-accent: #246df3`
- **影响**: Light 模式下无法通过颜色区分信息和品牌
- **建议**: 保持 info 用蓝色系 (`#246df3`)，accent 改为 violet (`#746cff`) 在 light 模式也使用，统一两个模式。或者保持差异但重新定义 info 为 `#3b82f6`。

### 问题 2：`--color-semantic-accent` 与 `--color-info` 完全重复

- **现状**: 两个模式下 `--color-semantic-accent` 和 `--color-info` 值完全相同
- **影响**: 两个变量指向同一颜色，造成混淆
- **建议**: 删除 `--color-semantic-accent`，统一使用 `--color-info`。或者将 `--color-semantic-accent` 改为不同用途的颜色（如用于用户消息）。

### 问题 3：51+ 处裸 Tailwind 原色违规

以下文件使用了不跟随主题的裸 Tailwind 原色类：

#### 3.1 memory-config.ts（14 处）

| 当前（裸色）      | 建议改为（语义 token） |
| ----------------- | ---------------------- |
| `text-blue-400`   | `text-status-info`     |
| `text-green-400`  | `text-status-success`  |
| `text-purple-400` | `text-semantic-agent`  |
| `text-teal-400`   | `text-semantic-memory` |
| `text-red-400`    | `text-status-error`    |
| `text-orange-400` | `text-semantic-notify` |
| `text-yellow-400` | `text-status-warning`  |

#### 3.2 TokenStatusBar.tsx（7 处）

| 当前（裸色）    | 建议改为（语义 token）                              |
| --------------- | --------------------------------------------------- |
| `bg-pink-400`   | `bg-semantic-agent` (thinking -> agent)             |
| `bg-orange-300` | `bg-semantic-notify` (tool_inputs -> notify)        |
| `bg-teal-300`   | `bg-semantic-memory` (tool_outputs -> memory)       |
| `bg-violet-400` | `bg-semantic-agent` (provider_system -> agent)      |
| `bg-cyan-300`   | `bg-semantic-tool` (provider_messages -> tool)      |
| `bg-amber-300`  | `bg-status-warning` (provider_tools -> warning)     |
| `bg-slate-400`  | `bg-text-secondary` (provider_options -> secondary) |

#### 3.3 tool-icon-map.ts（2 处）

| 当前                            | 建议改为                                              |
| ------------------------------- | ----------------------------------------------------- |
| `image` -> `text-pink-400`      | `text-semantic-agent` (图片属于特殊媒体，用 agent 紫) |
| 或新增 `--color-semantic-media` | 独立的媒体语义色                                      |

#### 3.4 UICardRenderer.tsx（7 处）

| 当前（裸色）      | 工具名  | 建议改为              |
| ----------------- | ------- | --------------------- |
| `text-orange-400` | bash    | `text-semantic-tool`  |
| `text-blue-400`   | read    | `text-status-info`    |
| `text-green-400`  | write   | `text-status-success` |
| `text-amber-400`  | edit    | `text-status-warning` |
| `text-purple-400` | grep    | `text-semantic-agent` |
| `text-cyan-400`   | find/ls | `text-semantic-tool`  |
| `text-gray-400`   | default | `text-text-secondary` |

#### 3.5 Preview 组件（12 处）

| 文件               | 当前（裸色）                                     | 建议改为                                                            |
| ------------------ | ------------------------------------------------ | ------------------------------------------------------------------- |
| ImageCard          | `text-emerald-500`                               | `text-semantic-memory`                                              |
| VideoCard          | `text-purple-500`                                | `text-semantic-agent`                                               |
| AudioCard          | `text-amber-500`                                 | `text-status-warning`                                               |
| HtmlCard           | `text-orange-500`                                | `text-semantic-notify`                                              |
| PdfCard            | `text-red-500`                                   | `text-status-error`                                                 |
| MarkdownCard       | `text-teal-400`                                  | `text-semantic-memory`                                              |
| UrlCard            | `text-blue-500`                                  | `text-status-info`                                                  |
| MediaCardError     | `text-red-500`                                   | `text-status-error`                                                 |
| MermaidBlock       | `text-red-500`, `bg-red-50`, `border-red-300/30` | `text-status-error`, `bg-status-error/10`, `border-status-error/30` |
| BlockErrorBoundary | `border-red-400`, `bg-red-50`, `text-red-600`    | `border-status-error/50`, `bg-status-error/10`, `text-status-error` |

#### 3.6 其他

| 文件                | 当前                                                                     | 建议改为                                    |
| ------------------- | ------------------------------------------------------------------------ | ------------------------------------------- |
| SessionJumpButton   | `text-blue-600 dark:text-blue-400`                                       | `text-accent`                               |
| ExplorerSidebar     | `bg-indigo-100/50 dark:bg-indigo-900/30`                                 | `bg-accent-muted`                           |
| ExplorerSidebar     | `border-indigo-500/50`                                                   | `border-accent/50`                          |
| ContextMenu         | `text-red-400` (删除)                                                    | `text-status-error`                         |
| QueueCards          | `text-amber-600 dark:text-amber-400`, `text-blue-600 dark:text-blue-400` | `text-status-warning`, `text-status-info`   |
| CoordinatorRenderer | `border-blue-500/25`, `text-blue-500`                                    | `border-status-info/25`, `text-status-info` |
| SideNav             | `bg-pink-400` (scrollbar)                                                | `bg-semantic-agent`                         |

### 问题 4：UsagePanel MODEL_COLORS 硬编码

- **现状**: `["#4196f3", "#45c477", "#7c5ce6", "#ff6b6b", "#ff9f43", "#48d1cc"]` 硬编码在 TSX 中
- **建议**: 定义为 CSS 变量或统一使用语义色

### 问题 5：ThemeMenu dark 预览色不一致

- **现状**: `bg-[#101722]` vs `--color-bg-primary: #0b111a`
- **建议**: 改为 `bg-bg-primary`

### 问题 6：agent-color.ts 硬编码

- **现状**: 6 个 hex 值硬编码 `["#EF4444", "#3B82F6", "#22C55E", "#EAB308", "#7C3AED", "#F97316"]`
- **建议**: 使用语义 token 中的对应色

### 问题 7：`--color-text-inverse` 语义模糊

- **现状**: light 为亮色 `#f7fafc`，dark 为深色 `#0a0c10`
- **建议**: 命名改为 `--color-text-on-accent` 或保持不变但添加注释

### 问题 8：Tailwind `gray-950` 与 `--color-text-inverse` dark 重复

- **现状**: `gray-950: #0a0c10` = `--color-text-inverse: #0a0c10` (dark)
- **建议**: `gray-950` 直接引用 `var(--color-text-inverse)`

### 问题 9：语法高亮色未自定义

- **现状**: 使用 `prism-react-renderer` 内置 `nightOwl` 主题
- **建议**: 可保持现状（内置主题质量较高），或后续自定义

---

## 三、推荐的颜色规范（修正版）

以下是修正后的完整颜色定义，解决上述所有问题。设计系统应使用这些值。

### 修正 1：`--color-info` 与 `--color-accent` 区分

```
--color-info:    light #3b82f6 / dark #2db6e8   (蓝色系，信息)
--color-accent:  light #746cff / dark #746cff   (violet，品牌/选中)
```

让 accent 在两个模式下都使用 violet，info 始终使用蓝色。

### 修正 2：删除 `--color-semantic-accent`，统一使用 `--color-info`

```
--color-semantic-accent -> 删除，所有引用改为 --color-status-info
```

### 修正 3：新增 `--color-semantic-media` 用于预览类组件

```
--color-semantic-media:  light 236 72 153 (RGB) / dark 244 114 182 (RGB)
```

### 修正 4：所有裸色替换映射

（直接使用上面的替换表，共 51+ 处）

### 修正后的完整语义色映射：

| 语义类型 | Dark Hex  | 用途                     | Tailwind                     |
| -------- | --------- | ------------------------ | ---------------------------- |
| Agent    | `#ae7aff` | Agent/思考/委托/thinking | `text-semantic-agent`        |
| Tool     | `#2dd4e8` | Bash/终端/LSP执行        | `text-semantic-tool`         |
| Memory   | `#2dd4bf` | 记忆/知识库/bookmark     | `text-semantic-memory`       |
| Info     | `#2db6e8` | Read/Write/Search/Web    | `text-status-info`           |
| Success  | `#46dd89` | 完成/写入/确认           | `text-status-success`        |
| Warning  | `#eab308` | 编辑/Grep/等待           | `text-status-warning`        |
| Error    | `#f87171` | 错误/失败/删除           | `text-status-error`          |
| Notify   | `#fb923c` | Git/分支/通知/操作       | `text-semantic-notify`       |
| Media    | `#f472b6` | 图片/视频/音频/PDF       | `text-semantic-media` (新增) |
| Idle     | `#46dd89` | 空闲状态                 | `text-accent-idle`           |

---

## 四、Dark 模式色板总览（设计系统应使用的值）

```
背景层级:
  bg-base:      #0b111a  (最深，页面底色)
  bg-secondary: #111827  (侧边栏)
  bg-tertiary:  #142033  (三级)
  bg-elevated:  #121b28  (卡片/弹窗)
  bg-overlay:   rgba(0,0,0,0.6)

文本层级:
  text-primary:   #f2f6fb  (标题/正文)
  text-secondary: #c1cad6  (描述/标签)
  text-tertiary:  #8a96a8  (辅助/占位)
  text-inverse:   #0a0c10  (反转背景上的文字)

边框:
  border-primary:   #334155
  border-secondary: #475569
  border-focus:     #746cff

强调色:
  accent:         #746cff  (violet，品牌/选中)
  accent-hover:   #8d88ff
  accent-muted:   rgba(116,108,255,0.18)
  accent-text:    #a8b0ff
  accent-idle:    #46dd89

状态色:
  success:  #46dd89  (完成)
  warning:  #eab308  (警告/等待)
  error:    #f87171  (错误/失败)
  info:     #2db6e8  (信息/读取)

语义色:
  agent:  #ae7aff  (Agent/思考)
  tool:   #2dd4e8  (Bash/终端)
  memory: #2dd4bf  (记忆)
  notify: #fb923c  (Git/通知)
  media:  #f472b6  (预览/媒体) <- 新增

Surface:
  surface-code: #0e1724  (代码块)
  surface-hover: #1a2638  (悬停)
  surface-dim:   #121b28  (弱化)
```

---

## 五、.design 页面审计报告（2026-07-05）

对 `.design/pages/` 下 9 个 HTML 页面的全面审计结果。**所有页面都存在同一个核心问题：使用旧版 AI 生成的颜色令牌，与项目实际颜色系统不一致。**

### 5.1 审计总览

| 页面                  | 行数  | 颜色系统    | 字体              | Dark 模式 | data-dom-id | 状态       |
| --------------------- | ----- | ----------- | ----------------- | --------- | ----------- | ---------- |
| `main-chat.html`      | 5,227 | 旧 `--pi-*` | Inter + JetBrains | 有        | 2 个        | **需修复** |
| `settings-modal.html` | 932   | 旧 `--pi-*` | Inter + JetBrains | 有        | 8 个        | **需修复** |
| `tablet-chat.html`    | 4,681 | 旧 `--pi-*` | Inter + JetBrains | 有        | 3 个        | **需修复** |
| `mobile-chat.html`    | 4,486 | 旧 `--pi-*` | Inter + JetBrains | 有        | 11 个       | **需修复** |
| `login.html`          | 815   | 旧 `--pi-*` | Inter + JetBrains | 有        | 0 个        | **需修复** |
| `welcome.html`        | 878   | 旧 `--pi-*` | Inter + JetBrains | 有        | 0 个        | **需修复** |
| `variant-linear.html` | 4,044 | 旧 `--pi-*` | Inter + JetBrains | 有        | 0 个        | **待定**   |
| `variant-cursor.html` | 3,890 | 旧 `--pi-*` | Inter + JetBrains | 有        | 0 个        | **待定**   |
| `variant-apple.html`  | 3,332 | 旧 `--pi-*` | Inter + JetBrains | 有        | 0 个        | **待定**   |

### 5.2 发现的问题

#### 问题 A：颜色令牌完全过时（严重 — 9/9 页面）

**现状**：所有 9 个页面的 `<style id="theme-vars">` 区域（第 7-268 行，共 262 行）完全相同，使用旧版 AI 生成的 `--pi-blue-*`、`--pi-violet-*` 等 10 级色阶变量体系。

**应该用**：`colors_and_type.css` 中已修正的项目实际变量 `--color-bg-primary`、`--color-text-primary` 等体系（136 个 token，light/dark 双模式）。

**具体差异**：

| 项目         | 旧值（页面中）                                           | 新值（项目实际）                                      | 说明                                    |
| ------------ | -------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------- |
| 背景色变量名 | `--background: var(--pi-neutral-50)`                     | `--color-bg-primary: #edf1f6`                         | 命名体系完全不同                        |
| 强调色       | `--color-primary: var(--pi-blue-500)` → `#246df3`        | `--color-accent: #746cff`                             | Light 模式 accent 错误（应该用 violet） |
| Dark 强调色  | `--color-primary-dark: var(--pi-violet-400)` → `#746cff` | `--color-accent: #746cff`                             | Dark 值正确，但变量名不对               |
| 字体         | Inter (Google CDN)                                       | 系统字体栈 (`-apple-system, BlinkMacSystemFont, ...`) | 项目不使用 Inter                        |
| 等宽字体     | JetBrains Mono (Google CDN)                              | 系统等宽栈 (`Menlo, Monaco, Consolas, ...`)           | 项目不使用 JetBrains                    |

#### 问题 B：字体依赖 Google Fonts CDN（严重 — 9/9 页面）

**现状**：所有页面 `@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap')`

**应该用**：系统字体栈，不依赖任何外部 CDN。

#### 问题 C：Lucide CDN 冗余加载（中等 — 8/9 页面）

**现状**：所有页面加载 `https://unpkg.com/lucide@1.8.0/dist/umd/lucide.min.js`，但仅 `settings-modal` 实际调用了 `lucide.createIcons()`。其他 8 个页面加载了但未使用。

**应该**：无 Lucide 依赖的页面移除该 CDN 引用。

#### 问题 D：HTML lang 属性不一致（低 — 1/9 页面）

**现状**：`settings-modal.html` 使用 `lang="en"`，其余 8 个使用 `lang="zh-CN"`。

**应该**：统一为 `lang="zh-CN"`。

#### 问题 E：令牌重复冗余（低 — 结构问题）

**现状**：9 个页面各自内联 262 行完全相同的设计令牌，共 2,358 行重复。

**说明**：这是 `.design` 页面的技术限制（每个页面需要自包含 HTML），无法直接引用外部 CSS。但可以通过脚本批量替换保持一致性。

### 5.3 修复方案

#### 需要替换的令牌块

所有 9 个页面的第 7-268 行 `<style id="theme-vars">` 内部内容需要整体替换为 `colors_and_type.css` 中的修正版令牌，同时：

1. **移除** Google Fonts `@import` 行
2. **移除** `--pi-blue-*`、`--pi-violet-*` 等旧色阶变量
3. **替换为** `--color-bg-primary` 等项目实际变量名
4. **字体**改为系统字体栈
5. **保留** `:root` + `.dark` 双模式结构
6. **保留**语义别名（`--bg`、`--text` 等消费者友好别名）

#### 旧令牌 → 新令牌映射表（用于 CSS 内 class 替换）

页面 body 中的 Tailwind 类也需要同步替换：

| 旧 class (页面中)                          | 新 class (应对齐)                      | 说明                           |
| ------------------------------------------ | -------------------------------------- | ------------------------------ |
| `bg-background` / `bg-[var(--background)]` | `bg-[var(--color-bg-primary)]`         | 主背景                         |
| `bg-surface` / `bg-[var(--surface)]`       | `bg-[var(--color-bg-elevated)]`        | 卡片/面板背景                  |
| `text-[var(--text-primary)]`               | `text-[var(--color-text-primary)]`     | 主文本                         |
| `text-[var(--text-secondary)]`             | `text-[var(--color-text-secondary)]`   | 次文本                         |
| `border-[var(--border)]`                   | `border-[var(--color-border-primary)]` | 边框                           |
| `bg-[var(--color-primary)]`                | `bg-[var(--color-accent)]`             | 强调色                         |
| `bg-[var(--accent)]`                       | `bg-[var(--color-accent)]`             | 强调色（名称一致但值可能不同） |

### 5.4 修复优先级

1. **P0 — 颜色令牌替换**：6 个主页面（main-chat、settings-modal、tablet-chat、mobile-chat、login、welcome）的 `<style>` 令牌块替换为修正版
2. **P1 — 字体替换**：移除 Google Fonts，改用系统字体栈
3. **P2 — CDN 清理**：移除未使用的 Lucide CDN
4. **P3 — Variant 页面**：3 个风格变体页面（linear/cursor/apple）暂保留各自的风格令牌，待用户选定风格后再统一
5. **P4 — Body CSS class 替换**：替换页面内容中的旧变量引用
