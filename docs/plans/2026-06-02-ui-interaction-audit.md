# UI 与交互审计优化方案

> 状态：Phase 1-2 部分实施
> 日期：2026-06-02
> 影响范围：`src/mainview/layouts/`、`src/mainview/components/`、`src/mainview/hooks/use-focus-trap.ts`、`src/mainview/index.css`
> 目标：让 Pi Agent Chat 更像一个高频使用的工程工作台，而不是多个局部功能拼接出来的界面。

## 结论摘要

当前项目的 UI 问题不主要是“某个页面不好看”，而是几个基础交互机制没有统一：

1. 弹层、全屏页、预览页、确认框各自实现 z-index、Esc、focus trap、safe-area 和关闭按钮尺寸。
2. 状态提示分散在顶部横幅、消息区、Tab、pending center、toast、右侧栏里，优先级不够清晰。
3. 颜色和视觉语义部分绕过设计 token，长期会造成主题不一致。
4. 移动端响应式逻辑会改写用户的面板偏好，窗口尺寸变化后可能出现“我明明关了它，它又回来”的体验。
5. 消息流里工具卡、预览卡、侧边导航、队列提示都很丰富，但密度层级还没有形成一套稳定阅读节奏。

建议先做“交互底座”而不是直接逐页美化。第一批应该收敛弹层/按钮/状态/断点行为，后面再处理视觉细节和消息流密度。

## 当前已落地范围

2026-06-02 第一批已开始收敛：

- 新增 `Button`、`IconButton`、`ModalDialog`、`FullscreenOverlay` primitives。
- 新增 `cx` className 合并 helper。
- `ConfirmDialog`、`SettingsPanel`、`RollbackOverlay`、`UIPendingCenter` 已迁移到统一 modal/button primitive。
- `ForkDialog`、`MarkdownExpandOverlay`、`CodeExpandOverlay`、`MermaidFullscreen` 已迁移到统一 fullscreen primitive。
- `ProjectPickerDialog` 的关闭按钮和 modal/fullscreen 层级已接入统一 primitive/token。
- preview fullscreen、图片 lightbox、popover、toast、connection banner 已替换为语义化 z-index token。
- `use-focus-trap.ts` 已改为 topmost-only，避免多层弹窗同时响应 Esc。
- `tailwind.config.js` 已补齐 `z-overlay`、`z-modal`、`z-popover`、`z-toast`、`z-fullscreen`、`z-system` alias。
- `CopyButton` 已接入统一 `IconButton`，补齐自定义 `title`、`aria-label` 和复制成功态。
- `InlineErrorToast` 的关闭按钮已接入统一 `IconButton`，避免局部手写过小点击区。
- 新增 `Tooltip`、`CopyAction`、`ToastViewport` 和 `useCopyFeedback`。
- preview header、`UrlCard`、`HtmlCard`、`PdfCard` 的复制链接已接入 `CopyAction`，刷新/全屏/打开按钮接入 `IconButton`。
- `GitPanel`、`ExplorerSidebar` 的右键复制已接入 `useCopyFeedback`，Explorer 原有局部 `copyToast` 已移除。
- `AgentPanel`、`StatusPanel`、`RpcPanel` 继续保留原有 copied 状态，同时通过 `useClipboard(..., { showToast: true })` 接入统一短反馈。
- `SessionSidebar` 的 Copy ID 已接入 `useCopyFeedback`。

尚未完成：

- `OverlayHost`/overlay stack provider 还未抽出，目前先通过 focus trap stack 解决 Esc 冲突。
- preview fullscreen 还未抽出 `PreviewFullscreenFrame`，目前先完成层级 token 化。
- `FileOverlay`、`DiffOverlay` 仍是 chat 区域内的独立 overlay，需要下一批统一。
- 状态/Action Center、tool color token、响应式 preference/runtime 拆分还未实施。
- Tooltip/Toast/CopyAction 已有底座；消息流内部和 timeline 的局部复制仍默认不弹 toast，以免高频复制造成噪音。

## P0：需要优先处理

### 1. 弹层系统碎片化

**证据**

- `MainLayout.tsx` 同时挂载 `FileOverlay`、`DiffOverlay`、`CodeExpandOverlay`、`MarkdownExpandOverlay`。
- `RollbackOverlay.tsx` 使用 `fixed inset-0 z-50`，关闭按钮约 26px，没有 safe-area 处理。
- `SettingsPanel.tsx` 使用 `fixed inset-0 z-50`，没有统一 focus trap，关闭按钮约 24px。
- `UIPendingCenter.tsx` 使用 `fixed inset-0 z-[100]`，关闭按钮约 24px。
- 预览卡使用 `z-[200]`，`ConnectionBanner` 使用 `z-[300]`，同时 `index.css` 已经定义了 `--z-modal`、`--z-popover`、`--z-toast` 等 token。

**风险**

- 多个弹层叠加时，Esc 可能同时触发多个监听器。
- z-index 规则靠记忆维护，后续功能容易互相压住。
- iOS/移动浏览器上，部分全屏/半屏弹层会碰到刘海、安全区或底部手势区。
- 关闭按钮和底部操作按钮不稳定满足 44px touch target。

**优化方案**

新增一组基础组件，先把弹层规则集中：

```text
src/mainview/components/primitives/overlay/
  OverlayProvider.tsx
  OverlayHost.tsx
  ModalDialog.tsx
  FullscreenOverlay.tsx
  PopoverSurface.tsx
  overlay-stack.ts
```

组件职责：

- `OverlayHost` 管理当前打开栈，只有最上层响应 Esc 和 backdrop click。
- `ModalDialog` 统一 `role="dialog"`、`aria-modal`、初始 focus、返回 focus、滚动锁定。
- `FullscreenOverlay` 内置 safe-area header/footer，强制可见关闭入口。
- `PopoverSurface` 用于菜单、轻量 dropdown，不进入 modal 栈。
- 所有 overlay 只使用 token 化 z-index，例如 `z-[var(--z-modal)]` 或新增 Tailwind alias。

**第一批迁移目标**

1. `RollbackOverlay.tsx`
2. `SettingsPanel.tsx`
3. `ConfirmDialog.tsx`
4. `UIPendingCenter.tsx`

验收标准：

- 同时打开多个弹层时，Esc 只关闭最上层。
- 所有 modal 都有 `role="dialog"` 和明确 accessible name。
- 移动端 close/button 最小点击区不小于 44px。
- 除极少数全局例外外，不再新增 `z-[100]`、`z-[200]`、`z-[300]` 这类硬编码层级。

### 2. 全屏和移动端 touch target 不一致

**证据**

- `ForkDialog.tsx`、`BashPanel.tsx`、`ProjectPickerDialog.tsx` 已经按 safe-area 模式处理，说明项目里有正确范式。
- `RollbackOverlay.tsx`、`SettingsPanel.tsx`、`ConfirmDialog.tsx`、`UIPendingCenter.tsx` 仍然用小按钮和局部 padding。
- `TabBar.tsx` 的 tab close 按钮偏小，移动端虽然有“常显关闭按钮”，但点击区域仍需要复核。

**优化方案**

新增统一按钮 primitive：

```text
src/mainview/components/primitives/IconButton.tsx
src/mainview/components/primitives/Button.tsx
```

建议尺寸：

| 类型      | 视觉尺寸 | 点击区 | 场景                 |
| --------- | -------- | ------ | -------------------- |
| icon-sm   | 28px     | 36px   | 桌面工具栏、tab 内部 |
| icon-md   | 36px     | 44px   | modal header、移动端 |
| button-sm | 32px     | 36px   | 桌面次级操作         |
| button-md | 40px     | 44px   | 移动端和关键操作     |

验收标准：

- modal/header/footer/移动端关键操作不再手写 `p-1`、`p-1.5`。
- destructive action 的按钮样式统一来自 `variant="danger"`。
- 所有 icon-only button 必须有 `aria-label` 或 tooltip。

### 3. 状态提示和行动入口优先级不清晰

**证据**

- 连接状态在 `ConnectionBanner.tsx` 顶部全局显示。
- 会话启动失败在 `ChatPanel.tsx` 中央显示。
- UI pending 在 `UIPendingCenter.tsx` 里以 tab 区域小按钮加 modal 显示。
- rollback、retry、inline error、notification center 各自维护反馈。
- 右侧栏也承载 change review、todos、subagent、supervisor 等状态。

**风险**

用户最需要知道的是“现在能不能输入、是否需要我处理、当前 agent 正在做什么”。这些信息分布过散时，高频工作流会多扫很多区域。

**优化方案**

建立一个统一的“当前会话行动模型”：

```typescript
type AttentionLevel = "blocking" | "actionRequired" | "running" | "background" | "info";

interface SessionAttention {
  sessionId: string;
  level: AttentionLevel;
  title: string;
  detail?: string;
  primaryAction?: Action;
  secondaryAction?: Action;
}
```

落地方式：

- 顶部只放全局连接和项目级异常。
- 输入框附近只放“影响当前输入”的状态，例如 streaming、stopping、session starting。
- 需要用户处理的 UI request 汇总到一个 Action Center，不要只靠角落小按钮。
- 右侧栏显示详细状态和历史，不承担当下必须点击的唯一入口。

验收标准：

- 有 UI pending 时，用户不需要看右侧栏也能明确知道要处理。
- 网络断开、agent streaming、approval pending、session failed 的优先级有明确顺序。
- 同一事件不会同时以 toast、banner、modal 三种强提示出现。

## P1：体验和设计系统优化

### 4. 颜色 token 漂移

**证据**

`src/mainview/index.css` 已经定义了主题 token，但组件里仍有很多直接 Tailwind 颜色：

- `ThemeMenu.tsx`、`TierSwitcher.tsx` 使用 `indigo-*`。
- `CoordinatorRenderer.tsx`、`PreviewRenderer.tsx`、`BlockErrorBoundary.tsx` 使用 `blue-*`、`red-*`。
- `tool-icon-map.ts`、`UICardRenderer.tsx`、`memory-config.ts` 直接返回 `text-blue-400`、`text-purple-400` 等。
- `AnsiText.tsx` 需要保留 ANSI 色彩映射，这类可以作为明确例外。

**优化方案**

把颜色从“视觉颜色”改成“语义角色”：

```text
--color-tool-read
--color-tool-write
--color-tool-execute
--color-tool-search
--color-attention-running
--color-attention-required
--color-attention-blocking
```

迁移策略：

1. 先新增 token，不立刻全量替换。
2. 抽 `toolVisuals.ts`，所有工具图标颜色从这里拿。
3. 保留 `AnsiText.tsx`、markdown prose syntax 这类内容色彩例外。
4. 加一个轻量 lint/rg 检查，防止核心 UI 继续新增 raw palette。

### 5. 响应式布局会改写用户偏好

**证据**

`use-layout-store.ts` 在进入 mobile 时把 pinned panel 写成 hidden，离开 mobile 时又把 hidden 写回 pinned。

```text
desktop pinned -> mobile hidden -> desktop pinned
```

这对“因为 viewport 变小所以临时隐藏”和“用户真的想隐藏”没有区分。

**优化方案**

拆分两类状态：

```typescript
interface LayoutState {
  sessionPreference: "pinned" | "overlay" | "hidden";
  statusPreference: "pinned" | "overlay" | "hidden";
  sessionRuntime: "visible" | "hidden";
  statusRuntime: "visible" | "hidden";
}
```

规则：

- localStorage 只保存 preference。
- breakpoint 只影响 runtime resolution，不直接覆盖 preference。
- mobile/tablet 上 panel 默认 overlay，关闭后只关闭 runtime。

验收标准：

- 用户在桌面手动隐藏右栏，缩到移动端再回来，右栏仍保持隐藏。
- 用户在桌面 pin 左栏，缩到移动端时自动变 overlay/hidden，回到桌面恢复 pinned。
- 断点切换不写 localStorage，除非用户主动点击 pin/hide。

### 6. 消息流密度和阅读节奏需要统一

**现状**

消息流已经有很多能力：工具卡、预览卡、markdown expand、side nav、queue cards、selection bar、quick actions。能力丰富是优势，但现在不同卡片的标题、状态、颜色、折叠规则、错误展示不完全一致。

**优化方案**

定义消息流的三层信息：

| 层级        | 默认展示                              | 交互             |
| ----------- | ------------------------------------- | ---------------- |
| Timeline    | 用户/assistant 消息、关键状态、失败项 | 快速扫读         |
| Tool Row    | 工具名、目标文件/命令、状态、耗时     | 默认紧凑，可展开 |
| Detail Pane | stdout、diff、preview、长错误         | 右侧栏或局部展开 |

第一步可以先统一工具卡 header：

- 左侧固定 icon + tool label。
- 中间显示资源名或摘要。
- 右侧显示 status、duration、expand。
- 失败态只用 `status-error`，不再每个 renderer 单独拼 red palette。

## P2：后续可排期优化

### 7. 大组件拆分

建议按交互边界拆，不按视觉区域硬拆：

- `ChatPanel.tsx`：拆出 `ChatViewport`、`ChatInputDock`、`SessionFailureState`。
- `MessageBubble.tsx`：拆出 attachment preview、image lightbox、role chrome。
- `ProjectPickerDialog.tsx`：拆出 mobile shell、desktop shell、project list、recent projects。
- `StatusPanel` 相关：按 tabs 的数据订阅和展示拆开。

### 8. 文案和 i18n 一致性

当前已有 `useTranslation`，但还有部分硬编码英文 aria label、fallback 文案和状态文本。建议建立规则：

- 可见文案都进 i18n。
- `aria-label` 也进 i18n，尤其 icon-only button。
- 技术错误可保留英文原文，但外层解释用当前语言。

### 9. 复制、Tooltip 和轻提示反馈

**证据**

- `CopyButton.tsx`、preview `useClipboard.ts`、`ExplorerSidebar.tsx`、`GitPanel.tsx`、`StatusPanel.tsx` 都有复制逻辑。
- `ExplorerSidebar.tsx` 原先自己维护 `copyToast`，`GitPanel.tsx` 复制路径/commit 后没有明确反馈。
- 大量 icon-only button 使用原生 `title`，例如 `TabBar`、`GitPanel`、`ProjectPickerDialog`、`QuickActionToolbar`、preview header。
- 通知相关组件分散在 `NotificationCenter`、`InlineErrorToast`、`RetryNotification` 和各 store 的 `useNotificationStore.push`。

**当前已落地**

- `Tooltip`：提供 hover/focus 可见提示，使用 `z-tooltip` token。
- `CopyAction`：统一复制按钮、成功态、失败态和可选全局 toast。
- `useCopyFeedback`：给 context menu 这类非按钮场景复用复制反馈。
- `ToastViewport`：基于 notification 队列展示 info/warning/error 短反馈。
- `CopyButton` 保留旧 API，但内部已改为 `CopyAction(showToast=false)`。
- `AgentPanel`、`StatusPanel`、`RpcPanel`、`SessionSidebar`、`GitPanel`、`ExplorerSidebar` 已接入统一反馈。

**优化方案**

建议继续按调用点逐步迁移，不必一次重画界面：

```text
src/mainview/components/primitives/
  Tooltip.tsx
  CopyAction.tsx
  ToastViewport.tsx
```

职责：

- `Tooltip`：替代 icon-only button 上的原生 `title`，支持 hover/focus、延迟展示、移动端不遮挡。
- `CopyAction`：统一 `copyToClipboard`、成功态、失败态、可选 toast，不再每个模块各写一次复制反馈。
- `ToastViewport`：承接短反馈，例如“已复制路径”“保存失败”，并和 `NotificationCenter` 区分：toast 是短暂反馈，notification 是可追溯事件。

下一批迁移建议：

1. `MessageCard`、timeline 内联复制根据是否需要 toast 决定使用 `CopyButton` 或 `CopyAction`。
2. `MarkdownExpandOverlay` 的复制内容可评估是否打开 toast。
3. icon-only button 从原生 `title` 逐步替换为 `Tooltip + aria-label`。

### 10. 视觉回归测试

建议新增 Playwright 截图矩阵：

| 场景                     | 桌面亮色 | 桌面暗色 | 移动亮色 | 移动暗色 |
| ------------------------ | -------- | -------- | -------- | -------- |
| 空会话                   | 是       | 是       | 是       | 是       |
| streaming                | 是       | 是       | 是       | 是       |
| UI pending               | 是       | 是       | 是       | 是       |
| rollback modal           | 是       | 是       | 是       | 是       |
| file/html/pdf fullscreen | 是       | 是       | 是       | 是       |

每个场景至少校验：

- 没有横向溢出。
- 顶部和底部 safe-area 没有遮挡。
- 弹层关闭按钮可见。
- 关键按钮文本没有挤压或截断。

## 推荐实施顺序

### Phase 1：Overlay 与按钮底座

范围：

- 新增 `OverlayHost`、`ModalDialog`、`FullscreenOverlay`、`IconButton`、`Button`。
- 迁移 `RollbackOverlay`、`SettingsPanel`、`ConfirmDialog`、`UIPendingCenter`。
- 修正 `use-focus-trap.ts` 的 topmost-only 行为。

验证：

- Vitest 覆盖 Esc、Tab trap、return focus。
- Playwright 覆盖移动端 safe-area、close button 可点击。

### Phase 2：状态和行动入口

范围：

- 定义 `SessionAttention` 派生层。
- 统一 connection、pending、session failed、streaming 的展示优先级。
- 将 UI pending 从“角落 badge”升级为清晰的当前会话 action required。

验证：

- 构造 pending、streaming、offline、failed 组合状态，确认只有最高优先级强提示。

### Phase 3：Token 清理

范围：

- 新增 tool/status semantic token。
- 抽 `toolVisuals.ts`。
- 替换核心 UI raw palette，保留 ANSI/markdown 例外。

验证：

- `rg` 检查核心组件不再新增 raw `red/blue/indigo/purple` palette。
- 多主题下工具卡和状态色仍清晰。

### Phase 4：响应式偏好与消息密度

范围：

- 重构 `use-layout-store.ts` 的 preference/runtime 状态。
- 统一工具卡 header 和折叠规则。
- 收敛消息流里重复的错误、预览、运行中状态样式。

验证：

- 桌面/移动来回切换不丢用户偏好。
- 大会话切换性能不退化。

## 第一张 PR 建议

建议第一张 PR 只做“弹层和按钮底座”，不要混入大面积视觉重绘。

包含：

1. 新增 overlay/button primitives。
2. 迁移 `RollbackOverlay`、`SettingsPanel`、`ConfirmDialog`。
3. 修复 `use-focus-trap.ts` 的多弹层 Esc 冲突。
4. 补最小测试和移动端截图验证。

不包含：

- 大规模换色。
- 改消息卡视觉。
- 重构会话 store。
- 调整业务状态模型。

这样风险最小，也能最快把 UI 的交互一致性打牢。
