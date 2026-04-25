# pi-agent-chat 性能优化方案

> 调研日期：2026-04-25
> 涉及 12 个优化点，按 P0/P1/P2 三档优先级排列
> 每项包含：问题描述、根因分析、优化方案、验证步骤、风险评估

---

## 目录

- [P0 — 高优先级（直接影响用户体验）](#p0--高优先级)
  - [P0-1: 消息列表虚拟化](#p0-1-消息列表虚拟化)
  - [P0-2: 流式更新全量数组拷贝](#p0-2-流式更新全量数组拷贝)
  - [P0-3: 前端未使用分页](#p0-3-前端未使用分页)
  - [P0-4: Subagent 状态直接变异（Bug）](#p0-4-subagent-状态直接变异bug)
- [P1 — 中优先级（影响局部性能）](#p1--中优先级)
  - [P1-5: selectedIds Set 引用导致批量重渲染](#p1-5-selectedids-set-引用导致批量重渲染)
  - [P1-6: debugLog 每条 RPC 消息都触发](#p1-6-debuglog-每条-rpc-消息都触发)
  - [P1-7: streamVersion O(n) 遍历全部消息](#p1-7-streamversion-on-遍历全部消息)
  - [P1-8: NavDot/NavSubDot 未 memo 化](#p1-8-navdotnavsubdot-未-memo-化)
  - [P1-9: ReactMarkdown 无解析缓存](#p1-9-reactmarkdown-无解析缓存)
- [P2 — 低优先级（长期优化）](#p2--低优先级)
  - [P2-10: 服务端 JSONL 全量读取](#p2-10-服务端-jsonl-全量读取)
  - [P2-11: Explorer 树更新全量拷贝](#p2-11-explorer-树更新全量拷贝)
  - [P2-12: TokenStatusBar/ContextRing 未 memo 化](#p2-12-tokenstatusbarcontextring-未-memo-化)

---

## P0 — 高优先级

### P0-1: 消息列表虚拟化

**问题**: `ChatPanel.tsx:200,220` 的 `MessagesArea` 和 `SubagentMessagesArea` 用 `.map()` 渲染全部消息。长会话（100+ 消息 × 多个 ContentBlock）导致 DOM 节点爆炸。

**根因**:
- `@tanstack/react-virtual` 已安装但仅用于 `VirtualizedCodeView.tsx`（文件预览），聊天列表完全未用
- 每条 assistant 消息含 1 thinking + N toolExecution + 1 text = 7+ 个重度 ContentBlock
- 50 条 assistant 消息 = 350+ 个 block，全部挂载在 DOM

**方案**:

1. 在 `ChatPanel.tsx` 中用 `useVirtualizer` 替换 `.map()` 渲染
2. 使用 `measureElement` 动态测量真实高度，配合 `estimateSize` 启发式估算
3. 改造 `use-active-scroll-tracker.ts` 的 `scrollToMessage`，从 DOM `querySelector` 改为 `virtualizer.scrollToIndex(index)`
4. 可选：将正在流式更新的最后一条消息从虚拟列表中分离，独立渲染

**修改文件**:
- `src/mainview/components/chat/ChatPanel.tsx` — 新增 `VirtualizedMessagesArea`
- `src/mainview/hooks/use-active-scroll-tracker.ts` — `scrollToMessage` 改为 index-based

**关键代码** (`ChatPanel.tsx`):

```tsx
import { useVirtualizer } from "@tanstack/react-virtual";

function estimateMessageSize(msg: ChatMessage): number {
  if (msg.role === "user") return 60;
  let h = 48;
  for (const block of msg.content) {
    switch (block.type) {
      case "text": h += Math.min(200, Math.max(40, (block.text.length / 80) * 22)); break;
      case "thinking": h += 80; break;
      case "toolExecution": h += block.status === "running" ? 180 : 120; break;
      default: h += 60;
    }
  }
  return h;
}

function VirtualizedMessagesArea({ messages, scrollRef, onScroll }: Props) {
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateMessageSize(messages[index]),
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  });

  // 新消息自动滚到底部
  const prevCountRef = useRef(0);
  useEffect(() => {
    if (messages.length > prevCountRef.current) {
      virtualizer.scrollToIndex(messages.length - 1, { align: "end" });
    }
    prevCountRef.current = messages.length;
  }, [messages.length, virtualizer]);

  return (
    <div ref={scrollRef as React.Ref<HTMLDivElement>} className="h-full overflow-y-auto px-4 py-3" onScroll={onScroll}>
      <div style={{ height: virtualizer.getTotalSize(), width: "100%", position: "relative" }}>
        {virtualizer.getVirtualItems().map((vr) => {
          const msg = messages[vr.index];
          return (
            <div
              key={msg.id}
              data-index={vr.index}
              ref={virtualizer.measureElement}
              style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: `translateY(${vr.start}px)` }}
            >
              <div className="py-1"><MessageBubble message={msg} /></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**验证步骤**:
1. Chrome DevTools Elements → 搜索 `data-msg-id`，对比优化前后 DOM 节点数（100条消息: 优化前≈100+节点 → 优化后≈10-15节点）
2. React DevTools Profiler 录制流式对话，对比 MessageBubble render 次数
3. 功能回归：自动滚到底部、手动上滚不跳回、SideNav 点击跳转、SideNav 同步高亮
4. 边界场景：空消息列表、单条消息、超长单条消息、快速切换会话

**风险**:
- `scrollToMessage` 依赖 virtualizer index 而非 DOM querySelector，需同时改造 `useActiveScrollTracker`
- 流式更新时高度频繁变化可能导致 virtualizer 频繁重测量 → 建议分离 streaming 消息独立渲染
- 切换会话时需给 virtualizer 加 `key={sessionId}` 重置缓存

---

### P0-2: 流式更新全量数组拷贝

**问题**: 每个 `message_update`/`tool_execution_update` 事件都 `[...messages]` 替换整个消息数组。200 条消息 × 30 次/秒 = 6000 次浅拷贝/秒。

**根因**:
- `use-session-store.ts:571,664` — `chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), {...lastMsg}])`
- `use-subagent-store.ts:133,247` — 同样模式
- `use-chat-store.ts:162` — `setMessagesForSession` 每次创建新 `messagesBySession` 对象

**方案**: rAF 批次合并 + store 层 streamVersion 增量计算

**新增文件 `src/mainview/stores/message-batcher.ts`**:

```typescript
type Update = { sessionId: string; apply: () => void };
let queue: Update[] = [];
let rafId: number | null = null;

function flush() {
  rafId = null;
  const batch = queue;
  queue = [];
  const latest = new Map<string, Update>();
  for (const u of batch) latest.set(u.sessionId, u);
  for (const u of latest.values()) u.apply();
}

export function batchMessageUpdate(sessionId: string, apply: () => void) {
  queue.push({ sessionId, apply });
  if (!rafId) rafId = requestAnimationFrame(flush);
}

export function flushNow() {
  if (rafId) { cancelAnimationFrame(rafId); flush(); }
}
```

**修改 `use-session-store.ts`** — 在 `message_update` 和 `tool_execution_*` 处理中包裹 batch:

```typescript
if (event.type === "message_update") {
  batchMessageUpdate(sessionId, () => {
    // ... 原有逻辑不变 ...
    chat.setMessagesForSession(sessionId, [...]);
  });
  return;
}
// message_start / message_end 使用 flushNow() 立即执行
```

**在 `use-chat-store.ts` 新增 streamContentVersion 计数器**:

```typescript
streamContentVersion: 0,
incrementStreamVersion: () => set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),
```

**验证步骤**:
1. 在 `flush()` 中临时加 `console.log` 验证合并效果：batch 前可能 30+ 次/秒 → batch 后 ~16 次/秒
2. React DevTools Profiler 对比优化前后 ChatPanel render 耗时
3. 功能回归：流式文本输出、工具执行输出、message_end 正确结束、快速切换 session
4. Chrome Memory tab 对比 10 秒流式对话的内存增长

**风险**:
- batch 合并可能丢弃 tool_execution_update 的增量 output → 需在 batch 回调中累积增量而非只保留最后一次
- `message_end` 必须 `flushNow()` 立即执行，不能进 batch

---

### P0-3: 前端未使用分页

**问题**: 后端 `session.getEntries` 支持 cursor 分页，但前端一次性加载 200/500 条消息，无"加载更多"机制。

**根因**:
- `use-chat-store.ts:184` — `apiClient.call("session.getEntries", { sessionPath, limit: 200 })` 不传 cursor
- `use-subagent-store.ts:66` — `limit: 500`，同样不传 cursor
- 后端 `session.ts:34` 虽然支持 cursor 但每次仍全量 readFile

**方案**: 前端增量分页 + "加载更多" UI

**修改 `use-chat-store.ts`** — 新增分页状态:

```typescript
interface ChatState {
  // ... 现有字段
  hasMoreBySession: Record<string, boolean>;
  cursorBySession: Record<string, string | null>;
  loadingMoreBySession: Record<string, boolean>;
  loadMoreMessages: (sessionPath: string) => Promise<void>;
}
```

**修改 `loadSessionMessages`** — 初始只加载最新 50 条:

```typescript
const result = await apiClient.call("session.getEntries", { sessionPath, limit: 50 });
// ... 解析后设置 hasMore、cursor ...
```

**新增 `loadMoreMessages`** — 向上加载历史:

```typescript
loadMoreMessages: async (sessionPath) => {
  const { hasMoreBySession, cursorBySession, loadingMoreBySession } = get();
  if (!hasMoreBySession[sessionId] || loadingMoreBySession[sessionId]) return;
  const result = await apiClient.call("session.getEntries", { sessionPath, limit: 50, cursor });
  // ... prepend 到现有消息前 ...
}
```

**修改 `ChatPanel.tsx` MessagesArea** — 检测滚动到顶部时触发加载:

```tsx
const handleScrollInternal = useCallback(() => {
  const el = scrollRef.current;
  if (!el) return;
  if (el.scrollTop < 40 && hasMore && !loadingMore) {
    prevHeightRef.current = el.scrollHeight;
    useChatStore.getState().loadMoreMessages(meta.sessionPath);
  }
  onScroll();
}, [hasMore, loadingMore]);
```

**验证步骤**:
1. 构造 300+ 条消息的 JSONL fixture，验证首次只加载 50 条
2. 滚到顶部触发加载更多，验证 prepend 后滚动位置不跳动
3. 流式新消息正常追加到末尾，不受分页影响
4. 切换会话后切回，使用缓存不重新加载

**风险**:
- cursor 在流式写入期间行号可能偏移 → 加载历史时暂停 cursor 更新
- `normalizeToolBlocks` 依赖全量消息做 toolCall→toolResult 匹配，分页后可能跨批次 → 需跨批次保留 `toolCallNameMap`
- 滚动位置跳动 → 用 `prevHeightRef` 补偿

---

### P0-4: Subagent 状态直接变异（Bug）

**问题**: `use-subagent-store.ts:124` 直接修改 zustand state 对象，绕过不可变更新。

**根因**:

```typescript
// line 119-131
const updated: ContentBlock[] = [...blocks];  // 浅拷贝数组
for (const block of content) {
  if (block.type === "text") {
    const lastBlock = updated[updated.length - 1];
    if (lastBlock?.type === "text") {
      (lastBlock as { text: string }).text += block.text;  // ⚠️ 直接变异！
    }
  }
}
```

`[...blocks]` 只拷贝了数组，内部元素仍是同一引用。对 `lastBlock.text` 的 `+=` 直接修改了 zustand state 中的 ContentBlock 对象。

**可能引发的 Bug**:
- React memo 浅比较失效（block 对象引用没变，memo 跳过渲染，UI 不更新）
- zustand devtools 时间旅行失效
- 并发事件竞态导致不一致

**方案**: 创建新的 text block 对象代替直接修改

```typescript
// line 119-131 改为:
const updated: ContentBlock[] = [...blocks];
for (const block of content) {
  if (block.type === "text") {
    const lastIdx = updated.length - 1;
    const lastBlock = updated[lastIdx];
    if (lastIdx >= 0 && lastBlock?.type === "text") {
      updated[lastIdx] = { type: "text", text: lastBlock.text + block.text };
    } else {
      updated.push({ type: "text", text: block.text });
    }
  } else {
    updated.push(block);
  }
}
```

**额外发现**: `use-chat-store.ts:83` 的 `normalizeToolBlocks` 中 `splice` 操作在 store 外部（局部变量），风险低但建议后续重构为纯函数。

**验证步骤**:
1. 单元测试：模拟连续两个 `message_update` 事件，验证 `stateBefore !== stateAfter1 !== stateAfter2`（引用不等）
2. 手动测试：启动 subagent 任务，观察 streaming 文本是否实时更新
3. React DevTools Profiler 确认 `SubagentExecutionCard` 在每次 message_update 后有重渲染

**风险**: 极低。仅将直接变异改为创建新对象，逻辑不变。

---

## P1 — 中优先级

### P1-5: selectedIds Set 引用导致批量重渲染

**问题**: `use-chat-nav-store.ts:8,26` 中 `selectedIds` 是 `Set<string>`，每次 toggle 都 `new Set(prev)`。所有订阅 `selectedIds` 的 MessageBubble（可达数十上百个）全部重渲染。

**根因**: `MessageBubble.tsx:19` 直接订阅 `s.selectedIds` 整体引用。Zustand selector 默认用 `Object.is` 比较，Set 引用必变 → 全部重渲染。

**方案**: selector 精确订阅（只订阅自己 id 的布尔值）

```typescript
// MessageBubble.tsx 改前:
const selectedIds = useChatNavStore((s) => s.selectedIds);
const isSelected = selectedIds.has(message.id);

// 改后:
const isSelected = useChatNavStore(
  useCallback((s) => s.selectedIds.has(message.id), [message.id])
);
// activeId 同理:
const isActive = useChatNavStore(
  useCallback((s) => s.activeId === message.id, [message.id])
);
```

**原理**: selector 返回 `boolean`，`Object.is(true, true)` 直接通过，toggle 不相关 id 不会触发重渲染。

**验证步骤**:
1. React DevTools Profiler 录制 → 右键 toggle 一条消息 → 改前所有 MessageBubble 高亮，改后仅 1 个高亮
2. 临时加 `console.count('render-' + message.id)` 确认只有被操作的 bubble count++

**风险**: 极低。`useCallback` 包裹 selector 防止每次渲染创建新函数（Zustand 反模式）。`message.id` 是稳定引用。

---

### P1-6: debugLog 每条 RPC 消息都触发

**问题**: `api-client.ts:176-185` 每次调用/事件都执行动态 `import()` + zustand store 写入，生产环境无开关。

**根因**: `debugLog` 无条件执行，即使 RPC Panel 未渲染也持续产生开销。动态 import 的 Promise + 微任务 + store 更新在流式场景下每秒触发上百次。

**方案**: 运行时开关 + 静态 import

```typescript
// api-client.ts
import { useRpcDebugStore } from "../stores/use-rpc-debug-store";

class APIClientImpl {
  private _debugEnabled = false;

  setDebugEnabled(enabled: boolean): void {
    this._debugEnabled = enabled;
  }

  private debugLog(direction: string, method: string, payload: unknown): void {
    if (!this._debugEnabled) return;
    useRpcDebugStore.getState().addEntry({ direction, method, payload });
  }
}
```

RpcPanel 挂载时开启、卸载时关闭:

```typescript
// RpcPanel.tsx
useEffect(() => {
  apiClient.setDebugEnabled(true);
  return () => apiClient.setDebugEnabled(false);
}, []);
```

**验证步骤**:
1. 不打开 RPC Panel → 执行对话 → `debugLog` 不执行（加临时计数器验证）
2. 打开 RPC Panel → 执行对话 → 调试数据正常显示
3. 关闭 Panel → 确认计数器不再增长

**风险**: 低。Panel 关闭时丢失调试数据是预期行为。

---

### P1-7: streamVersion O(n) 遍历全部消息

**问题**: `ChatPanel.tsx:54-65` 的 `streamVersion` 用 `useMemo` 遍历全部消息计算版本号，流式期间每次更新都重算。

**根因**: `streamVersion` 遍历了所有历史消息的 `content.length`，但只有最后一条流式消息在变化。历史消息的贡献每次都一样，属于无效计算。

**方案**: 在 store 层维护 `streamContentVersion` 计数器

```typescript
// use-chat-store.ts 新增
streamContentVersion: 0,
incrementStreamVersion: () =>
  set((s) => ({ streamContentVersion: s.streamContentVersion + 1 })),
```

在 `use-session-store.ts` 的流式事件处理中调用:

```typescript
// message_update、tool_execution_start/update/end 末尾添加:
chat.incrementStreamVersion();
```

ChatPanel 中直接读取:

```typescript
// 删除 useMemo 计算，改为:
const streamVersion = useChatStore((s) => s.streamContentVersion);
```

**验证步骤**:
1. 流式自动滚动正常（发送消息后自动滚到底部）
2. 用户上滚后不自动跳回（手动上滚暂停自动滚动）
3. 用户滚回底部后恢复自动滚动
4. 50+ 条消息后流式无卡顿

**风险**: 低。计数器只在流式事件中递增，非流式操作不触发。

---

### P1-8: NavDot/NavSubDot 未 memo 化

**问题**: `SideNav.tsx:174,224` 的 `NavDot`/`NavSubDot` 是普通 function component。流式输出时 `messages` 每收到一个 token 就产生新引用 → SideNav 重渲染 → 所有 NavDot/NavSubDot 重渲染。

**根因**: 组件未 memo 化 + 内联回调（7 个 `onClick={() => ...}` 每次渲染创建新函数）。

**收益估算**: 30~80 个实例 × 流式频率 10~30 次/秒 = 占帧预算 9~25%。

**方案**: 提取 `NavDotGroup` 为 memo 组件 + `useCallback` 消除内联回调

```tsx
const NavDotGroup = memo(function NavDotGroup({ id, Icon, color, subs, isActive, isSelected, subActiveKey, onDotClick, onSubDotClick, onContextMenu, onDoubleClick }) {
  return (
    <div className="flex flex-col items-center w-full">
      <NavDot ... />
      {subs.map((sub, i) => <NavSubDot key={`${id}-${i}`} ... />)}
    </div>
  );
});

const NavDot = memo(function NavDot({ ... }) { ... });
const NavSubDot = memo(function NavSubDot({ ... }) { ... });
```

**验证步骤**:
1. 临时在 memo 组件内加 `console.log`，流式时只有 active 的 NavDotGroup 输出
2. React DevTools Profiler 确认非 active NavDotGroup 跳过渲染

**风险**: 极低。纯渲染优化，不涉及状态变更。

---

### P1-9: ReactMarkdown 无解析缓存

**问题**: `MessageBubble.tsx:143` 每个 text block 独立实例化 `<ReactMarkdown remarkPlugins={[remarkGfm]}>`，无解析缓存。流式结束时所有 block 同时解析 markdown，造成峰值。

**根因**:
- ReactMarkdown v10 每次调用都 `createProcessor` + `parse` + `runSync` + `toJsxRuntime`
- `remarkPlugins={[remarkGfm]}` 每次创建新数组
- 流式结束 `isStreaming: true → false` 时，所有 text block 同时切换到 ReactMarkdown

**方案**: 全局 Processor 单例 + AST 缓存

**新增文件 `src/mainview/components/chat/CachedReactMarkdown.tsx`**:

```tsx
import { memo } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { VFile } from "vfile";

const MAX_CACHE = 200;

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype);

const cache = new Map<string, ReturnType<typeof processor.runSync>>();

function parseToHast(text: string) {
  const cached = cache.get(text);
  if (cached) return cached;
  const file = new VFile();
  file.value = text;
  const tree = processor.parse(file);
  const hast = processor.runSync(tree, file);
  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(text, hast);
  return hast;
}

export const CachedReactMarkdown = memo(function CachedReactMarkdown({
  children,
}: { children: string }) {
  const hast = parseToHast(children);
  return toJsxRuntime(hast, {
    Fragment,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
  });
});
```

**接入方式** (`MessageBubble.tsx`):

```diff
- <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
+ <CachedReactMarkdown>{block.text}</CachedReactMarkdown>
```

**验证步骤**:
1. 发送长消息（5+ text block），用 `performance.now()` 测量 message_end 后首帧渲染时间
2. 滚动回看历史消息，验证缓存命中率（cache.size 增长但解析时间接近 0）
3. 测试 GFM 表格、删除线、代码块渲染正确性
4. Memory tab 观察 cache 内存占用（200 条 ≈ ~2-5MB）

**风险**: 需补充 URL 安全过滤（`toJsxRuntime` 绕过了 ReactMarkdown 的 URL 安全检查），对 `href` 属性做 sanitize。

---

## P2 — 低优先级

### P2-10: 服务端 JSONL 全量读取

**问题**: `session.ts:34` 使用 `readFile` 将整个 JSONL 文件加载到内存再分页。实测最大文件 54MB。

**根因**: `readFile(sessionPath, "utf-8")` + `content.split("\n")` 全量读取 + split，即使只需要 200 条。

**方案**: 使用 `readline.createInterface` 逐行流式读取

```typescript
import { createReadStream } from "fs";
import * as readline from "readline";

r("session.getEntries", async (params) => {
  const { sessionPath, limit = 200, cursor } = params;
  const startIdx = cursor ? parseInt(cursor, 10) : 0;
  const entries: SessionEntry[] = [];
  let lineIdx = 0;
  let hasMore = false;

  const rl = readline.createInterface({
    input: createReadStream(sessionPath, "utf-8"),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) { lineIdx++; continue; }
    if (lineIdx < startIdx) { lineIdx++; continue; }
    if (entries.length >= limit) { hasMore = true; break; }
    try { entries.push(parseLine(line, lineIdx)); } catch {}
    lineIdx++;
  }
  rl.close();
  return { entries, hasMore };
});
```

**收益**: 54MB 文件首页请求 → 内存峰值从 ~160MB 降至 ~10MB。

**验证步骤**:
1. 单元测试：对比优化前后 `getEntries` 返回结果完全一致
2. 大文件基准：对比内存峰值和响应延迟
3. `session-scanner.ts` 中的 `parseJsonlHeader`/`parseJsonlMeta` 同步优化

**风险**: 低。Bun 官方支持 Node `readline` 模块。API 无变更。

---

### P2-11: Explorer 树更新全量拷贝

**问题**: `use-explorer-store.ts:66-80` 的 `updateExpanded`/`loadChildren` 等函数对同层兄弟节点也做了不必要的浅拷贝，导致 `TreeNodeItem` 的 `memo` 全部失效。

**根因**: `.map()` 对同一目录下所有节点都执行 `{ ...n, children: [...] }`，即使兄弟节点无变化。

**方案（最小改动）**: 未修改则返回原引用

```typescript
function updateExpanded(nodes: TreeNode[], path: string, expanded: boolean): TreeNode[] {
  let changed = false;
  const result = nodes.map((n) => {
    if (n.path === path) { changed = true; return { ...n, expanded }; }
    if (n.children) {
      const newChildren = updateExpanded(n.children, path, expanded);
      if (newChildren !== n.children) { changed = true; return { ...n, children: newChildren }; }
    }
    return n;
  });
  return changed ? result : nodes;
}
```

**验证步骤**:
1. 展开一个目录，React DevTools 确认只有该目录节点的子树 re-render
2. 同层其他文件夹节点不 re-render

**风险**: 低。如仍有性能问题，可后续引入 `immer`。

---

### P2-12: TokenStatusBar/ContextRing 未 memo 化

**问题**: `TokenStatusBar.tsx:74,38` 未使用 `memo`。

**调研结论**: **不建议优先优化**。原因：
- Zustand selector `s.sessionContextMap[sessionId]` 已经隔离了无关 session 更新
- 重渲染频率低（每轮对话仅 3-4 次，非流式高频事件）
- DOM 极轻量（1 个 18×18 SVG + 5 个 span）
- 如果顺手加 `memo` 也无妨，但不应投入过多精力

**可选方案**: 给 `ContextRing` 和 `TokenStatusBar` 加 `memo`，提取 `STATUS_CONFIGS` 为模块级常量。

**验证步骤**: 临时加 render 计数器，确认每轮对话仅 3-4 次 render。

---

## 实施建议

### 执行顺序（推荐）

| 批次 | 优化项 | 预计改动量 | 预计收益 |
|------|--------|-----------|---------|
| **Batch 1** (Bug Fix) | P0-4 Subagent 变异 | ~10 行 | 修复潜在 Bug |
| **Batch 2** (Quick Wins) | P1-5 selectedIds、P1-6 debugLog、P1-7 streamVersion | ~30 行 | 减少 40-50% 无效渲染 |
| **Batch 3** (Memo) | P1-8 NavDot memo、P2-12 TokenStatusBar memo | ~80 行 | 减少 9-25% 帧预算浪费 |
| **Batch 4** (Batching) | P0-2 流式批次合并 | 新增 1 文件 + 修改 ~20 行 | 减少 40-50% 无效更新 |
| **Batch 5** (Virtualization) | P0-1 消息列表虚拟化 | ~100 行 | DOM 节点减少 90%+ |
| **Batch 6** (Pagination) | P0-3 前端分页 | ~80 行 | 首屏加载减少 60%+ |
| **Batch 7** (Cache) | P1-9 ReactMarkdown 缓存 | 新增 1 文件 + 改 1 行 | 解析时间减少 80-95% |
| **Batch 8** (Backend) | P2-10 JSONL 流式读取 | ~30 行 | 内存峰值减少 95%+ |
| **Batch 9** (Explorer) | P2-11 树拷贝优化 | ~20 行 | 减少不必要 re-render |

### 注意事项

1. **每项优化独立** — 不依赖其他项，可单独实施和验证
2. **每项优化前先测量 baseline** — 用 React DevTools Profiler / Chrome Performance 录制优化前数据
3. **P0-1 和 P0-2 有协同效应** — 虚拟化 + 批次合并一起做效果最佳
4. **P0-3 分页与 P0-1 虚拟化互补** — 分页减少初始加载量，虚拟化减少 DOM 节点
5. **P0-4 是 Bug 而非性能优化** — 应最先修复
