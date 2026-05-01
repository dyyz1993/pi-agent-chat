# 滚动意图检测优化计划

## 背景

参考 CodeNomad 项目的滚动意图检测方案，优化当前项目的滚动体验。

### 当前问题

1. **蒙层拦截触摸**（ChatPanel.tsx:330-336）— 右侧 10px 透明蒙层手动拦截 touchmove，遮挡内容、手感生硬
2. **全局 touchmove/touchstart hack**（main.tsx:21-53）— `passive:false` 阻塞浏览器滚动优化，每帧遍历 DOM
3. **缺少滚动意图检测** — `use-active-scroll-tracker` 只看 scrollTop 位置，无时间窗口概念，自动跟随恢复时机不智能
4. **programmaticCountRef 计数器方案** — 用计数器区分用户滚动 vs 代码滚动，容易出错

### 目标

- 删除所有 JS 层面的滚动 hack（蒙层、全局 touch 拦截）
- 用 CSS `overscroll-behavior-y: contain` 解决滚动冒泡
- 新增滚动意图检测（600ms 时间窗口 + 多输入源监听）
- 重构自动跟随逻辑，用意图检测替代计数器

---

## 实施步骤

### Step 1：新建 `use-scroll-intent` hook

**文件**：`src/mainview/hooks/use-scroll-intent.ts`

实现：
- `intentUntilRef` — 记录意图过期时间戳（`performance.now() + 600ms`）
- 监听 `wheel`（passive:true）、`pointerdown`、`touchstart`（passive:true）、`keydown`（方向键等）
- 导出 `hasIntent()` — 判断当前是否在意图窗口内
- 导出 `markIntent()` — 手动标记意图（供外部调用）
- 导出 `intentDirectionRef` — 记录最后一次滚动方向（up/down）

```typescript
const INTENT_WINDOW_MS = 600;
const SCROLL_INTENT_KEYS = new Set(['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']);
```

### Step 2：重构 `use-active-scroll-tracker`

**文件**：`src/mainview/hooks/use-active-scroll-tracker.ts`

改动：
1. 集成 `useScrollIntent`，传入 scrollElement
2. 在 `handleScroll` 中用 `hasIntent()` 判断用户是否在主动滚动：
   - 有意图 + 不在底部 → 暂停自动跟随
   - 有意图 + 在底部 → 恢复自动跟随
   - 无意图 → 保持当前状态（不因 scrollTop 微小变化误切换）
3. 用意图检测替代 `programmaticCountRef`：
   - 删除 `programmaticCountRef`、`markProgrammatic`、`markProgrammaticLong`
   - `doScrollToBottom` 等函数不再需要标记计数器
   - 因为代码触发的滚动不会产生 wheel/pointer/keyboard 事件，`hasIntent()` 自然为 false
4. 保留 `userScrolledUpRef` 作为补充状态（基于位置判断），意图检测作为主要判断

### Step 3：删除蒙层代码（ChatPanel.tsx）

**文件**：`src/mainview/components/chat/ChatPanel.tsx`

删除：
- `scrollCaptureRef` ref 定义（96行）
- 整个 touch 事件 useEffect（225-268行）
- 蒙层 div JSX（330-336行）

保留：
- `overscroll-y-contain` class（MessageListView 中已有）
- 其他所有滚动逻辑不变

### Step 4：删除全局 touch hack（main.tsx）

**文件**：`src/mainview/main.tsx`

删除：
- 全局 `touchstart` 事件监听（21-35行）— 边界偏移 1px hack，`overscroll-behavior: contain` 已解决
- 全局 `touchmove` 事件监听（37-53行）— `passive:false` + DOM 遍历，CSS 已解决

### Step 5：CSS 优化

**文件**：`src/mainview/index.css`

新增：
```css
html {
  overscroll-behavior-y: none;        /* 已有，保留 */
}
```

**文件**：`src/mainview/components/chat/MessageListView.tsx`

在滚动容器 class 中新增：
- `overflow-anchor-none` — 防止 Chrome scroll anchoring 干扰虚拟列表

### Step 6：验证

- 编译通过（`npm run build` 或 `tsc --noEmit`）
- 聊天面板滚动正常：鼠标滚轮、触摸滑动、键盘方向键
- 自动跟随：新消息到来时自动滚动到底部
- 手动滚动时暂停自动跟随，滚回底部后恢复
- 嵌套滚动（代码块等）不冒泡到父容器

---

## 涉及文件清单

| 文件 | 操作 |
|------|------|
| `src/mainview/hooks/use-scroll-intent.ts` | 新建 |
| `src/mainview/hooks/use-active-scroll-tracker.ts` | 重构 |
| `src/mainview/components/chat/ChatPanel.tsx` | 删除蒙层代码 |
| `src/mainview/main.tsx` | 删除全局 touch hack |
| `src/mainview/components/chat/MessageListView.tsx` | 新增 overflow-anchor-none |
| `src/mainview/index.css` | 无改动（已有 overscroll-behavior-y: none）|

## 风险点

1. **删除 programmaticCountRef 后的边界情况**：代码触发的 `scrollToBottom` 不会产生 wheel 事件，但可能触发 scroll 事件。需要确认 scroll 事件处理中意图检测不会误判。
   - 解决：在 scroll 回调中，如果 `hasIntent()` 为 false，不修改 autoScroll 状态即可

2. **iOS 弹性回弹**：删除全局 touchstart 边界 hack 后，需确认 `overscroll-behavior-y: contain` 在 iOS Safari 上生效（iOS 16+ 支持）
   - 降级方案：如需兼容旧 iOS，可保留一个简化版的 touchstart 处理

---

## 参考资源

- CodeNomad 滚动意图检测文档：`/docs/features/scroll-intent-detection/README.md`（另一个项目）
- MDN: overscroll-behavior: https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior
- virtua 虚拟列表库：https://github.com/inokawa/virtua
