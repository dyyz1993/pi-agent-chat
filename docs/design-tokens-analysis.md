# pi-agent-chat Design Tokens 完整分析 (含移动端与层级扩展)

> 本文档梳理了项目 `src/mainview/index.css` 和 `tailwind.config.js` 中定义的全部设计 Token。
> 已针对**移动端响应式场景**与**复杂会话层级（子会话）**进行了 Token 更新与规则扩展，可用于 UI/UX 审查、视觉一致性检查、间距/排版/颜色配比分析。

---

## 目录

1. [主题概览](#1-主题概览)
2. [颜色系统 (Colors)](#2-颜色系统-colors)
3. [间距系统 (Spacing)](#3-间距系统-spacing)
4. [圆角系统 (Border Radius)](#4-圆角系统-border-radius)
5. [阴影系统 (Shadows)](#5-阴影系统-shadows)
6. [排版系统 (Typography)](#6-排版系统-typography)
7. [触摸目标 (Touch Target) & 移动端适配](#7-触摸目标-touch-target--移动端适配)
8. [过渡/动画 (Transitions & Animations)](#8-过渡动画-transitions--animations)
9. [层级系统 (Z-Index)](#9-层级系统-z-index)
10. [子会话与状态表示](#10-子会话与状态表示)
11. [Diff 颜色系统](#11-diff-颜色系统)
12. [Tailwind 映射速查表](#12-tailwind-映射速查表)
13. [Token 变更日志](#13-token-变更日志)

---

## 1. 主题概览

项目支持 **8 个主题**，每个主题通过 `html[data-theme="xxx"]` 覆盖 CSS 变量（`dark` 通过 `html.dark` 类名切换）：

| 主题名               | 风格             | 基调        |
| -------------------- | ---------------- | ----------- |
| `:root` (默认 Light) | 标准浅色         | 冷灰白      |
| `dark`               | 深色             | Zinc 深灰黑 |
| `nord`               | Nord 色调深色    | 冷蓝灰      |
| `solarized`          | Solarized 浅色   | 暖黄        |
| `warm-dark`          | 暖色深色         | 棕褐暖调    |
| `rose`               | Rosé Pine 风格   | 粉紫暗调    |
| `latte`              | Catppuccin Latte | 暖奶白      |
| `sunset`             | 日落铜琥珀       | 深琥珀暖色  |

---

## 2. 颜色系统 (Colors)

### 2.1 背景色 (Background)

| Token                  | Light             | Dark              | 用途场景                                     |
| ---------------------- | ----------------- | ----------------- | -------------------------------------------- |
| `--color-bg-primary`   | `#ffffff`         | `#09090b`         | 主背景、核心对话区（移动端唯一常驻背景色）   |
| `--color-bg-secondary` | `#f3f4f6`         | `#111113`         | 侧边栏、工具面板栏背景（大屏专属或抽屉菜单） |
| `--color-bg-tertiary`  | `#e5e7eb`         | `#1e1e24`         | 选中态背景、子会话区域底色                   |
| `--color-bg-elevated`  | `#ffffff`         | `#27272a`         | 浮出面板、移动端底部操作栏、模态框           |
| `--color-bg-overlay`   | `rgba(0,0,0,0.5)` | `rgba(0,0,0,0.7)` | 移动端侧边栏展开时的全屏遮罩                 |

### 2.2 文字色 (Text)

| Token                    | Light     | Dark      | 用途场景                       |
| ------------------------ | --------- | --------- | ------------------------------ |
| `--color-text-primary`   | `#111827` | `#e4e4e7` | 核心内容、对话正文             |
| `--color-text-secondary` | `#6b7280` | `#a1a1aa` | 侧边栏辅助文字、属性信息       |
| `--color-text-tertiary`  | `#9ca3af` | `#71717a` | 时间戳、嵌套层级引导线、占位符 |
| `--color-text-inverse`   | `#ffffff` | `#09090b` | 高亮徽标上的文字               |

### 2.3 边框色 (Border)

| Token                      | Light     | Dark      | 用途场景              |
| -------------------------- | --------- | --------- | --------------------- |
| `--color-border-primary`   | `#e5e7eb` | `#18181b` | 默认分割线、卡片边框  |
| `--color-border-secondary` | `#d1d5db` | `#27272a` | 强调分割、输入框边框  |
| `--color-border-focus`     | `#6366f1` | `#818cf8` | 焦点环、active 输入框 |

### 2.4 强调色 (Accent)

| Token                  | Light                   | Dark                     | 用途场景           |
| ---------------------- | ----------------------- | ------------------------ | ------------------ |
| `--color-accent`       | `#6366f1`               | `#818cf8`                | 主按钮、链接、高亮 |
| `--color-accent-hover` | `#4f46e5`               | `#6366f1`                | 按钮悬停态         |
| `--color-accent-muted` | `rgba(99,102,241,0.15)` | `rgba(129,140,248,0.15)` | 浅底高亮、Tag 背景 |
| `--color-accent-text`  | `#4f46e5`               | `#a5b4fc`                | 强调色文字         |

### 2.5 语义标识色 (Accent Identity) — 新增

用于区分不同功能模块和状态：

| Token                   | Light     | Dark      | 用途场景                       |
| ----------------------- | --------- | --------- | ------------------------------ |
| `--color-accent-brand`  | `#3b82f6` | `#3b82f6` | 品牌主色、选中态指示器、主按钮 |
| `--color-accent-idle`   | `#10b981` | `#10b981` | 空闲状态点、就绪指示           |
| `--color-accent-agent`  | `#a855f7` | `#a855f7` | Agent / 助手身份标识           |
| `--color-semantic-line` | `#e5e7eb` | `#27272a` | 极弱分隔线（子会话缩进线）     |

### 2.6 语义状态色 (Status)

| Token             | Light     | Dark      | 用途场景         |
| ----------------- | --------- | --------- | ---------------- |
| `--color-success` | `#22c55e` | `#4ade80` | 成功状态、确认   |
| `--color-warning` | `#f59e0b` | `#fbbf24` | 警告提示、待处理 |
| `--color-error`   | `#ef4444` | `#f87171` | 错误、删除、危险 |
| `--color-info`    | `#3b82f6` | `#60a5fa` | 信息提示、帮助   |

### 2.7 语义分类色 (Semantic Category)

| Token                     | Light (RGB)  | Dark (RGB)    | 用途场景      |
| ------------------------- | ------------ | ------------- | ------------- |
| `--color-semantic-agent`  | `124 58 237` | `192 132 252` | Agent 相关 UI |
| `--color-semantic-tool`   | `14 116 144` | `34 211 238`  | 工具执行块    |
| `--color-semantic-memory` | `15 118 110` | `45 212 191`  | 记忆系统      |
| `--color-semantic-accent` | `79 70 229`  | `129 140 248` | 品牌色        |
| `--color-semantic-notify` | `194 65 12`  | `251 146 60`  | 通知徽章      |

### 2.8 组件表面色 (Surface)

| Token             | Light     | Dark      | 用途场景     |
| ----------------- | --------- | --------- | ------------ |
| `--surface-code`  | `#f1f3f5` | `#151921` | 代码块背景   |
| `--surface-hover` | `#f3f4f6` | `#1f2937` | 悬停态背景   |
| `--surface-dim`   | `#f9fafb` | `#111827` | 弱化区域背景 |

---

## 3. 间距系统 (Spacing)

### 3.1 CSS 变量间距

| Token           | 值        | px   | 用途场景       |
| --------------- | --------- | ---- | -------------- |
| `--spacing-xs`  | `0.25rem` | 4px  | 图标与文字间距 |
| `--spacing-sm`  | `0.5rem`  | 8px  | 按钮内边距     |
| `--spacing-md`  | `1rem`    | 16px | 卡片内边距     |
| `--spacing-lg`  | `1.5rem`  | 24px | 面板内边距     |
| `--spacing-xl`  | `2rem`    | 32px | 页面区块间距   |
| `--spacing-2xl` | `3rem`    | 48px | 大型区块分隔   |

### 3.2 子会话缩进 — 新增

| Token                   | 值              | 用途                           |
| ----------------------- | --------------- | ------------------------------ |
| `--spacing-indent-base` | `1.5rem` (24px) | 子会话相对于父级的左侧缩进距离 |

### 3.3 移动端响应式断点

| Breakpoint | 值          | 布局策略                          |
| ---------- | ----------- | --------------------------------- |
| `base`     | `< 768px`   | 移动端：隐藏侧边栏，全屏 MainChat |
| `md`       | `>= 768px`  | 平板：左侧边栏展开                |
| `lg`       | `>= 1024px` | 桌面：双侧边栏完全展开            |

---

## 4. 圆角系统 (Border Radius)

| Token           | 值        | px   | 用途场景                     |
| --------------- | --------- | ---- | ---------------------------- |
| `--radius-sm`   | `0.25rem` | 4px  | 微小徽章、状态点包围盒       |
| `--radius-md`   | `0.5rem`  | 8px  | 子会话项、侧边栏 hover 区块  |
| `--radius-lg`   | `0.75rem` | 12px | 聊天气泡输入框、工具面板卡片 |
| `--radius-xl`   | `1rem`    | 16px | 对话气泡、移动端 Drawer 边缘 |
| `--radius-full` | `9999px`  | 圆形 | 头像、圆形按钮               |

---

## 5. 阴影系统 (Shadows)

### 5.1 基础阴影 (保持兼容)

| Token         | Light                                   | Dark                                    |
| ------------- | --------------------------------------- | --------------------------------------- |
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)`            | `0 1px 2px rgba(0,0,0,0.3)`             |
| `--shadow-md` | `0 4px 6px -1px rgba(0,0,0,0.1), ...`   | `0 4px 6px -1px rgba(0,0,0,0.4), ...`   |
| `--shadow-lg` | `0 10px 15px -3px rgba(0,0,0,0.1), ...` | `0 10px 15px -3px rgba(0,0,0,0.4), ...` |
| `--shadow-xl` | `0 20px 25px -5px rgba(0,0,0,0.1), ...` | `0 20px 25px -5px rgba(0,0,0,0.5), ...` |

### 5.2 语义阴影 — 新增

| Token               | Light                                   | Dark                               | 用途场景                     |
| ------------------- | --------------------------------------- | ---------------------------------- | ---------------------------- |
| `--shadow-subtle`   | `0 1px 2px rgba(0,0,0,0.05)`            | `0 1px 2px rgba(0,0,0,0.4)`        | 当前选中会话项的浮起感       |
| `--shadow-floating` | `0 10px 25px -5px rgba(0,0,0,0.1), ...` | `0 10px 25px -5px rgba(0,0,0,0.6)` | 底部悬浮按钮、移动端抽屉面板 |

---

## 6. 排版系统 (Typography)

### 字体族

| Token         | 值                                  | 用途             |
| ------------- | ----------------------------------- | ---------------- |
| `--font-sans` | `ui-sans-serif, system-ui, ...`     | 正文、UI 文字    |
| `--font-mono` | `ui-monospace, SFMono-Regular, ...` | 代码块、等宽内容 |

### 字号

| Token         | 值         | px   | 用途场景         |
| ------------- | ---------- | ---- | ---------------- |
| `--text-xs`   | `0.75rem`  | 12px | 时间戳、辅助信息 |
| `--text-sm`   | `0.875rem` | 14px | 正文、列表项     |
| `--text-base` | `1rem`     | 16px | 默认字号         |
| `--text-lg`   | `1.125rem` | 18px | 标题、强调文字   |

### 行高

| Token               | 值     | 用途       |
| ------------------- | ------ | ---------- |
| `--leading-tight`   | `1.25` | 标题、单行 |
| `--leading-normal`  | `1.5`  | 正文默认   |
| `--leading-relaxed` | `1.75` | 长文段落   |

### 排版使用对照

| 场景       | 字体          | Mobile           | Desktop           |
| ---------- | ------------- | ---------------- | ----------------- |
| 阅读正文   | `--font-sans` | 14px (`text-sm`) | 14px (`text-sm`)  |
| 对话标题   | `--font-sans` | 20px (`text-xl`) | 24px (`text-2xl`) |
| 会话列表   | `--font-sans` | 14px (`text-sm`) | 14px (`text-sm`)  |
| 子会话层级 | `--font-sans` | 12px (`text-xs`) | 12px (`text-xs`)  |
| 代码标签   | `--font-mono` | 11px             | 11px              |

---

## 7. 触摸目标 (Touch Target) & 移动端适配

| Token                | 值     | 说明                                            |
| -------------------- | ------ | ----------------------------------------------- |
| `--touch-target-min` | `44px` | 移动端所有可点击元素的物理范围下限（Apple HIG） |
| `--input-font-size`  | `16px` | 移动端输入框字号下限，防止 iOS Safari 自动放大  |

---

## 8. 过渡/动画 (Transitions & Animations)

### 过渡时长

| Token                 | 值                  | 用途场景                            |
| --------------------- | ------------------- | ----------------------------------- |
| `--transition-fast`   | `150ms ease-out`    | 按钮 hover、图标变色、选中态切换    |
| `--transition-normal` | `250ms ease-in-out` | 移动端侧边栏滑出/抽屉、折叠面板展开 |
| `--transition-slow`   | `300ms ease`        | 页面切换、大型动画                  |

### 滑入动画

| 动画名           | 效果            | 时长  | 缓动     | 用途            |
| ---------------- | --------------- | ----- | -------- | --------------- |
| `slide-in-left`  | 从左滑入 + 渐显 | 200ms | ease-out | 左侧边栏打开    |
| `slide-in-right` | 从右滑入 + 渐显 | 200ms | ease-out | 右侧面板打开    |
| `slide-in-up`    | 从下滑入 + 渐显 | 250ms | ease-out | 底部弹窗、Toast |

---

## 9. 层级系统 (Z-Index)

### 新体系（推荐使用）

| Token         | 值   | 用途                 |
| ------------- | ---- | -------------------- |
| `--z-base`    | `0`  | 主界面元素           |
| `--z-float`   | `10` | 底部悬浮动作按钮组   |
| `--z-header`  | `20` | 顶栏（盖过内容滚动） |
| `--z-drawer`  | `40` | 移动端滑出侧边栏     |
| `--z-modal`   | `50` | 遮罩层及全屏弹窗     |
| `--z-popover` | `60` | 悬浮提示、Tooltip    |
| `--z-toast`   | `70` | Toast 通知（最高层） |

### 旧体系（兼容别名，逐步迁移）

| Token          | 值    | 对应新 Token                        |
| -------------- | ----- | ----------------------------------- |
| `--z-overlay`  | `10`  | `--z-float`                         |
| `--z-dropdown` | `50`  | `--z-modal`                         |
| `--z-sticky`   | `100` | (已废弃，使用 `--z-modal` 或硬编码) |

---

## 10. 子会话与状态表示 (Sub-Sessions & Status)

### 状态指示器

| 状态               | 颜色                          | 样式                    | 用途     |
| ------------------ | ----------------------------- | ----------------------- | -------- |
| Idle (空闲)        | `bg-emerald-400` + 半透明绿底 | 静态极小圆点            | 就绪指示 |
| Running / Building | `bg-blue-400`                 | 跳动点（animate-pulse） | 正在执行 |
| Error              | `bg-red-500`                  | 静态圆点                | 错误提示 |

### 子会话连接线

| 元素       | 样式                                           | 说明                 |
| ---------- | ---------------------------------------------- | -------------------- |
| 缩进线     | `border-l border-[var(--color-semantic-line)]` | 左侧缩进分隔         |
| 分支节点   | `w-1 h-1 rounded-full bg-neutral-700`          | 原点表示分支         |
| 子会话标题 | `text-xs text-[var(--color-text-tertiary)]`    | 默认辅色，Hover 高亮 |
| 缩进距离   | `pl-[var(--spacing-indent-base)]`              | 24px 左缩进          |

---

## 11. Diff 颜色系统

| Token                  | Light     | Dark      | 用途场景      |
| ---------------------- | --------- | --------- | ------------- |
| `--diff-bg`            | `#f3f4f6` | `#1a1f2e` | Diff 面板背景 |
| `--diff-color`         | `#1f2937` | `#d1d5db` | Diff 正文     |
| `--diff-added-bg`      | `#dcfce7` | _(继承)_  | 新增行背景    |
| `--diff-added-color`   | `#15803d` | _(继承)_  | 新增行文字    |
| `--diff-removed-bg`    | `#fee2e2` | _(继承)_  | 删除行背景    |
| `--diff-removed-color` | `#dc2626` | _(继承)_  | 删除行文字    |
| `--diff-gutter-bg`     | `#e5e7eb` | `#1f2937` | 行号栏背景    |
| `--diff-gutter-color`  | `#6b7280` | _(继承)_  | 行号文字      |

---

## 12. Tailwind 映射速查表

### 颜色

| Tailwind 类名           | 对应 CSS 变量                            | 示例           |
| ----------------------- | ---------------------------------------- | -------------- |
| `bg-bg-primary`         | `var(--color-bg-primary)`                | 页面背景       |
| `text-text-primary`     | `var(--color-text-primary)`              | 正文           |
| `border-border-primary` | `var(--color-border-primary)`            | 边框           |
| `text-accent-brand`     | `var(--color-accent-brand)`              | 品牌色文字     |
| `bg-accent-idle`        | `var(--color-accent-idle)`               | 空闲状态背景   |
| `text-accent-agent`     | `var(--color-accent-agent)`              | Agent 标识色   |
| `border-semantic-line`  | `var(--color-semantic-line)`             | 子会话分隔线   |
| `bg-status-success/10`  | `rgb(var(--color-status-success) / 0.1)` | 10% 透明成功色 |

### 阴影

| Tailwind 类名     | 对应 CSS 变量            |
| ----------------- | ------------------------ |
| `shadow-subtle`   | `var(--shadow-subtle)`   |
| `shadow-floating` | `var(--shadow-floating)` |

### Z-Index

| Tailwind 类名 | 对应 CSS 变量     |
| ------------- | ----------------- |
| `z-float`     | `var(--z-float)`  |
| `z-header`    | `var(--z-header)` |
| `z-drawer`    | `var(--z-drawer)` |

### 间距

| Tailwind 类名            | 对应 CSS 变量                |
| ------------------------ | ---------------------------- |
| `p-indent` / `pl-indent` | `var(--spacing-indent-base)` |
| `p-safe-top`             | `var(--safe-area-top)`       |

### 字号

| Tailwind 类名 | 对应 CSS 变量            |
| ------------- | ------------------------ |
| `text-input`  | `var(--input-font-size)` |

---

## 13. Token 变更日志

### 2026-05 v2 (本次变更)

**Dark 主题色值更新（Zinc 色系）**：

| Token                             | 旧值              | 新值              |
| --------------------------------- | ----------------- | ----------------- |
| `--color-bg-primary` (Dark)       | `#090c14`         | `#09090b`         |
| `--color-bg-secondary` (Dark)     | `#111827`         | `#111113`         |
| `--color-bg-tertiary` (Dark)      | `#1a1f2e`         | `#1e1e24`         |
| `--color-bg-elevated` (Dark)      | `#242d3b`         | `#27272a`         |
| `--color-bg-overlay` (Dark)       | `rgba(0,0,0,0.6)` | `rgba(0,0,0,0.7)` |
| `--color-text-primary` (Dark)     | `#f9fafb`         | `#e4e4e7`         |
| `--color-text-secondary` (Dark)   | `#9ca3af`         | `#a1a1aa`         |
| `--color-text-tertiary` (Dark)    | `#6b7280`         | `#71717a`         |
| `--color-text-inverse` (Dark)     | `#111827`         | `#09090b`         |
| `--color-border-primary` (Dark)   | `#161c26`         | `#18181b`         |
| `--color-border-secondary` (Dark) | `#222d38`         | `#27272a`         |

**新增 Token**：

| Token                   | 值 (Light)                                                                              | 用途                 |
| ----------------------- | --------------------------------------------------------------------------------------- | -------------------- |
| `--color-accent-brand`  | `#3b82f6`                                                                               | 品牌主色标识         |
| `--color-accent-idle`   | `#10b981`                                                                               | 空闲状态标识         |
| `--color-accent-agent`  | `#a855f7`                                                                               | Agent 身份标识       |
| `--color-semantic-line` | `#e5e7eb` / `#27272a`                                                                   | 子会话缩进分隔线     |
| `--spacing-indent-base` | `1.5rem`                                                                                | 子会话缩进距离       |
| `--input-font-size`     | `16px`                                                                                  | 移动端输入框字号下限 |
| `--shadow-subtle`       | Light: `0 1px 2px rgba(0,0,0,0.05)` / Dark: `0 1px 2px rgba(0,0,0,0.4)`                 | 轻微浮起感           |
| `--shadow-floating`     | Light: `0 10px 25px -5px rgba(0,0,0,0.1)...` / Dark: `0 10px 25px -5px rgba(0,0,0,0.6)` | 悬浮面板             |
| `--z-float`             | `10`                                                                                    | 悬浮按钮             |
| `--z-header`            | `20`                                                                                    | 顶栏                 |
| `--z-drawer`            | `40`                                                                                    | 移动端抽屉           |
| `--z-popover` (新值)    | `60`                                                                                    | Tooltip              |
| `--z-toast` (新值)      | `70`                                                                                    | Toast                |

**过渡更新**：

| Token                 | 旧值         | 新值                |
| --------------------- | ------------ | ------------------- |
| `--transition-fast`   | `150ms ease` | `150ms ease-out`    |
| `--transition-normal` | `200ms ease` | `250ms ease-in-out` |

**Z-Index 重构**：

| 旧 Token       | 旧值 | →   | 新 Token             | 新值 |
| -------------- | ---- | --- | -------------------- | ---- |
| `--z-overlay`  | 10   | →   | `--z-float`          | 10   |
| —              | —    | →   | `--z-header`         | 20   |
| —              | —    | →   | `--z-drawer`         | 40   |
| `--z-modal`    | 200  | →   | `--z-modal`          | 50   |
| `--z-popover`  | 300  | →   | `--z-popover`        | 60   |
| `--z-toast`    | 400  | →   | `--z-toast`          | 70   |
| `--z-dropdown` | 50   | →   | _(合并到 --z-modal)_ | —    |
| `--z-sticky`   | 100  | →   | _(合并到 --z-modal)_ | —    |

旧 Token 作为兼容别名保留，逐步迁移。

---

## 附录：完整 Token 清单

```
颜色 (50+)
├── 背景: --color-bg-primary/secondary/tertiary/elevated/overlay
├── 文字: --color-text-primary/secondary/tertiary/inverse
├── 边框: --color-border-primary/secondary/focus
├── 强调: --color-accent/hover/muted/text
├── 标识: --color-accent-brand/idle/agent
├── 分隔: --color-semantic-line
├── 状态: --color-success/warning/error/info
├── 状态 RGB: --color-status-success/error/warning/info
├── 分类 RGB: --color-semantic-agent/tool/memory/accent/notify
├── 表面: --surface-code/hover/dim
├── Diff: --diff-bg/color/added-bg/added-color/removed-bg/removed-color/...

间距 (8)
├── --spacing-xs/sm/md/lg/xl/2xl
├── --spacing-indent-base

圆角 (5)
├── --radius-sm/md/lg/xl/full

阴影 (6)
├── 基础: --shadow-sm/md/lg/xl
├── 语义: --shadow-subtle/floating

排版 (9)
├── 字体: --font-sans/mono
├── 字号: --text-xs/sm/base/lg
├── 行高: --leading-tight/normal/relaxed

触摸 (2)
├── --touch-target-min
├── --input-font-size

过渡 (3)
├── --transition-fast/normal/slow

层级 (7 + 3 兼容)
├── 新: --z-base/float/header/drawer/modal/popover/toast
├── 旧: --z-overlay/dropdown/sticky

安全区域 (4)
├── --safe-area-top/bottom/left/right

合计: ~100 个 CSS 变量 Token
```
