# 会话切换渲染缓存设计

> 状态：待实施
> 日期：2026-06-01
> 影响范围：`MessageListView.tsx`、`SideNav.tsx`、`ChatPanel.tsx`
> 前置依赖：session-switch-experience Phase 1-3（已完成）

## 问题现象

在完成 RPC 层优化（agent.start 跳过、fetchInitialState 热切换跳过）之后，会话切换的性能瓶颈转移到 **React 重渲染期间的 JavaScript 计算** 上。

对于大型会话（3443 条消息，每条含 100+ content blocks），切换时主线程阻塞 500-800ms，用户感知为 UI "卡死"。

### 瓶颈定位：4 次全量遍历

| 计算函数                                 | 位置                      | 复杂度 | 说明                                             |
| ---------------------------------------- | ------------------------- | ------ | ------------------------------------------------ |
| `buildCardMeta(messages, t)`             | `MessageListView.tsx:155` | O(n×m) | 遍历所有消息，为每条消息生成卡片标签和分隔线颜色 |
| `buildProcessedMessages(messages)`       | `MessageListView.tsx:156` | O(n)   | 遍历所有消息，处理 memory_prefetch 隐藏逻辑      |
| `buildFlatItems(messages, showThinking)` | `SideNav.tsx:196`         | O(n×m) | 遍历所有消息，为侧边导航构建 NavDot 列表         |
| `messages.map(m => m.id)`                | `ChatPanel.tsx:125`       | O(n)   | 遍历所有消息，提取 ID 列表                       |

n = 消息数量（最大 3443），m = 每条消息的 content blocks 数量（最大 100+）。

总计约 14000 次操作，在主线程上串行执行。

### 当前渲染链路

```
set({activeSessionId: id})
  → ChatPanel re-render
    → messages = useChatStore(s => s.messagesBySession[id])   ← 新数组引用
    → messageIds = messages.map(m => m.id)                     ← O(n) 重算
    → SideNav re-render
      → buildFlatItems(messages, showThinking)                  ← O(n×m) 重算
      → Virtualizer NavDot 渲染
    → MessageListView re-render (memo'd，但 source 变了)
      → useStableMessages(source)                               ← 从 store 读取
      → buildCardMeta(messages, t)                              ← O(n×m) 重算
      → buildProcessedMessages(messages)                        ← O(n) 重算
      → Virtualizer (bufferSize=800)                            ← DOM 没问题
```

**核心洞察**：当 A → B → A 切换时，会话 A 的消息数据没有变化。`messagesBySession[A]` 是同一个引用。但中间计算结果（cardMeta、processedMessages、flatItems、messageIds）每次都从头重算。

## 设计方案：Per-Session 计算缓存

### 核心思路

将计算结果以 `(sessionId, messagesRef)` 为键缓存。当切回一个消息数组引用未变的会话时，直接返回缓存结果。

**为什么用 `messagesRef`（引用相等性）而不是深度比较？**

- `messagesBySession[id]` 的更新总是产生新数组（spread + sort），引用变化意味着内容一定变了
- 引用比较是 O(1)，深度比较是 O(n)
- 流式推送、backgroundRefresh 差异合并都会产生新引用，缓存自然失效

### 缓存结构

```typescript
// 模块级缓存（不在 React state 中，避免触发额外渲染）
interface CacheEntry<T> {
  ref: ChatMessage[];
  result: T;
}

interface FlatItemCacheEntry extends CacheEntry<FlatItem[]> {
  showThinking: boolean;
}

const _processedCache = new Map<string, CacheEntry<ProcessedMessage[]>>();
const _cardMetaCache = new Map<string, CacheEntry<Map<string, CardMetaEntry>>>();
const _flatItemsCache = new Map<string, FlatItemCacheEntry>();
const _messageIdsCache = new Map<string, CacheEntry<string[]>>();
```

### 缓存失效

| 场景                       | 缓存行为 | 原因                                 |
| -------------------------- | -------- | ------------------------------------ |
| 新消息到达（流式）         | 自动失效 | `messagesBySession[id]` 产生新引用   |
| backgroundRefresh 差异合并 | 自动失效 | spread 产生新引用                    |
| 会话删除                   | 手动清除 | 防止内存泄漏                         |
| `t` 函数变化（i18n 切换）  | 自动失效 | `t` 在 useMemo 依赖中，变化时重算    |
| `showThinking` 切换        | 自动失效 | flatItems 缓存包含 showThinking 比对 |

### 内存管理

LRU 淘汰策略，最多保留 10 个会话的缓存。实际场景中不太可能同时有 10 个会话各自持有独立缓存数据。

```typescript
const MAX_CACHE_SIZE = 10;

function evictIfNeeded(cache: Map<string, unknown>): void {
  if (cache.size <= MAX_CACHE_SIZE) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}
```

## 具体修改

### 1. MessageListView — buildCardMeta + buildProcessedMessages

**文件**：`src/mainview/components/chat/MessageListView.tsx`

```typescript
// 新增模块级缓存（文件顶部，组件外）
interface CardMetaEntry {
  cardLabel: string | undefined;
  prevBarColor: string | undefined;
}

const _cardMetaCache = new Map<
  string,
  { ref: ChatMessage[]; result: Map<string, CardMetaEntry> }
>();
const _processedCache = new Map<string, { ref: ChatMessage[]; result: ProcessedMessage[] }>();

// 修改组件内 useMemo
const cardMeta = useMemo(() => {
  const sid = useSessionStore.getState().activeSessionId ?? "";
  const cached = _cardMetaCache.get(sid);
  if (cached && cached.ref === messages) return cached.result;
  const result = buildCardMeta(messages, t);
  _cardMetaCache.set(sid, { ref: messages, result });
  return result;
}, [messages, t]);

const processedMessages = useMemo(() => {
  const sid = useSessionStore.getState().activeSessionId ?? "";
  const cached = _processedCache.get(sid);
  if (cached && cached.ref === messages) return cached.result;
  const result = buildProcessedMessages(messages);
  _processedCache.set(sid, { ref: messages, result });
  return result;
}, [messages]);
```

### 2. SideNav — buildFlatItems

**文件**：`src/mainview/components/chat/SideNav.tsx`

```typescript
// 新增模块级缓存（文件顶部）
const _flatItemsCache = new Map<
  string,
  { ref: ChatMessage[]; showThinking: boolean; result: FlatItem[] }
>();

// 修改 useMemo
const items = useMemo(() => {
  const sid = useSessionStore.getState().activeSessionId ?? "";
  const cached = _flatItemsCache.get(sid);
  if (cached && cached.ref === messages && cached.showThinking === showThinking)
    return cached.result;
  const result = buildFlatItems(messages, showThinking);
  _flatItemsCache.set(sid, { ref: messages, showThinking, result });
  return result;
}, [messages, showThinking]);
```

### 3. ChatPanel — messageIds

**文件**：`src/mainview/components/chat/ChatPanel.tsx`

```typescript
// 新增模块级缓存（文件顶部）
const _messageIdsCache = new Map<string, { ref: ChatMessage[]; result: string[] }>();

// 修改 useMemo
const messageIds = useMemo(() => {
  const sid = activeSessionId ?? "";
  const cached = _messageIdsCache.get(sid);
  if (cached && cached.ref === messages) return cached.result;
  const result = messages.map((m) => m.id);
  _messageIdsCache.set(sid, { ref: messages, result });
  return result;
}, [messages, activeSessionId]);
```

### 4. 缓存清理

**文件**：`src/mainview/stores/use-session-store.ts`（或 `use-chat-store.ts`）

在会话删除逻辑中添加缓存清理：

```typescript
import { clearRenderCache } from "../components/chat/render-cache";

// 在 deleteSession / cleanupSession 中调用
clearRenderCache(sessionId);
```

**新增文件**：`src/mainview/components/chat/render-cache.ts`

```typescript
const MAX_CACHE_SIZE = 10;

export const cardMetaCache = new Map<
  string,
  {
    ref: ChatMessage[];
    result: Map<string, { cardLabel: string | undefined; prevBarColor: string | undefined }>;
  }
>();
export const processedCache = new Map<string, { ref: ChatMessage[]; result: ProcessedMessage[] }>();
export const flatItemsCache = new Map<
  string,
  { ref: ChatMessage[]; showThinking: boolean; result: FlatItem[] }
>();
export const messageIdsCache = new Map<string, { ref: ChatMessage[]; result: string[] }>();

const allCaches = [cardMetaCache, processedCache, flatItemsCache, messageIdsCache];

export function clearRenderCache(sessionId: string): void {
  for (const cache of allCaches) {
    cache.delete(sessionId);
  }
}

export function evictIfNeeded(cache: Map<string, unknown>): void {
  if (cache.size <= MAX_CACHE_SIZE) return;
  const oldest = cache.keys().next().value;
  if (oldest !== undefined) cache.delete(oldest);
}
```

> **注意**：也可以选择不抽取独立文件，直接在各自组件文件中定义模块级缓存。两种方案均可，取决于团队对内聚性的偏好。如果选择分散定义，`clearRenderCache` 需要从各模块导出并聚合。

## 预期性能

| 场景                              | 优化前      | 优化后             | 说明                         |
| --------------------------------- | ----------- | ------------------ | ---------------------------- |
| 热切换到小会话（33 条消息）       | ~50ms       | ~5ms               | 缓存命中，4 次遍历全部跳过   |
| 热切换到大会话（3443 条消息）     | 500-800ms   | **< 50ms**         | 缓存命中，跳过 ~14000 次操作 |
| 冷切换（新消息，缓存失效）        | 500-800ms   | ~500-800ms         | 缓存未命中，与优化前相同     |
| 流式推送（messages ref 持续变化） | 正常        | 正常               | 每次推送都是缓存未命中       |
| A → B → A（二次切回）             | 500-800ms×2 | 500-800ms + < 50ms | 首次冷启动 + 二次缓存命中    |

## 风险与缓解

### 1. 缓存过期（Stale Cache）

**风险**：如果 `messages` 数组被原地修改（in-place mutation）而非替换，引用不变但内容已变，导致返回过时数据。

**缓解**：确认 `messagesBySession` 的所有更新路径都使用新数组：

| 更新路径                     | 当前实现                                   | 是否安全           |
| ---------------------------- | ------------------------------------------ | ------------------ |
| `loadSessionMessages`        | 直接赋值从 RPC 获取的数组                  | ✅                 |
| `_backgroundRefreshMessages` | 差异合并时 `sorted.length ? sorted : prev` | ✅ 新引用          |
| 流式推送                     | 追加新消息到数组末尾                       | ✅ 需确认用 spread |

需逐一审计确认不存在 `push()` / `splice()` 等原地修改。

### 2. 内存泄漏

**风险**：缓存无限增长。

**缓解**：LRU 淘汰（最多 10 个会话）。每个缓存条目的内存开销：3443 条消息的 flatItems 约 200KB，4 种缓存合计约 500KB/会话，10 个会话约 5MB，完全可接受。

### 3. `t` 函数变化（i18n 切换语言）

**风险**：`buildCardMeta` 依赖 `t` 函数。如果用户切换语言，缓存中存储的 label 文本会过时。

**缓解**：`t` 已在 `useMemo` 依赖数组中。i18n 切换时 `t` 引用变化，useMemo 重算，但此时走的是"旧引用的 messages + 新 t"，仍然需要重算。但 `t` 的变化不会更新 `_cardMetaCache` 的 `ref`（messages 引用没变），所以重算结果会正确覆盖缓存。

需确认：`t` 变化时 useMemo 重算，会走 else 分支更新缓存，这是正确的。

### 4. showThinking 状态不一致

**风险**：flatItems 缓存依赖 `showThinking`，如果用户在会话 A 中切换了 showThinking，切到 B 再切回 A，需要用 A 的新 showThinking 值重算。

**缓解**：缓存条目包含 `showThinking` 字段，切换回来时比对此值。不匹配则重算。

## 测试计划

### 单元测试

| 测试用例                          | 验证点                        |
| --------------------------------- | ----------------------------- |
| 缓存命中：同引用二次调用          | 返回同一 result 对象引用      |
| 缓存失效：新引用调用              | 触发重算，返回新结果          |
| flatItems 缓存：showThinking 变化 | showThinking 不同时重算       |
| LRU 淘汰：超过 10 个会话          | 淘汰最早插入的条目            |
| clearRenderCache：会话删除        | 对应 sessionId 的所有缓存清空 |

### 集成测试

| 测试用例               | 验证点                         |
| ---------------------- | ------------------------------ |
| A → B → A 切换         | 第二次切 A 时计算时间 < 50ms   |
| 冷切换性能不退化       | 新会话首次渲染时间与优化前持平 |
| 流式推送期间缓存不干扰 | 新消息正确显示，无过时数据     |

### 性能基准

使用 3443 条消息的 fixture 数据，对比有/无缓存时 4 个计算函数的总耗时：

```
benchmark: buildCardMeta(3443 msgs)     →  cached: 0.1ms / uncached: 200ms
benchmark: buildProcessedMessages(3443) →  cached: 0.1ms / uncached: 50ms
benchmark: buildFlatItems(3443 msgs)    →  cached: 0.1ms / uncached: 250ms
benchmark: messages.map(m => m.id)      →  cached: 0.01ms / uncached: 5ms
```

## 可观测性

在缓存命中/未命中时输出 perfLog，便于线上排查：

```
[renderCache] sessionId=7ca855b3 cache HIT (cardMeta) ageMs=2340
[renderCache] sessionId=sess_coord cache MISS (processedMessages) msgCount=33 computeMs=2
[renderCache] sessionId=sess_large cache HIT (flatItems) ageMs=8901
[renderCache] LRU eviction: removed sessionId=sess_old from cardMetaCache
```

建议使用 `createLogger("renderCache")` 输出，遵循项目的日志规范。

## 实施顺序

| 阶段    | 内容                                                              | 改动范围                            |
| ------- | ----------------------------------------------------------------- | ----------------------------------- |
| Phase 1 | 抽取 `render-cache.ts`，实现缓存结构 + LRU + clearRenderCache     | 新文件                              |
| Phase 2 | 修改 `MessageListView.tsx` 接入 cardMeta + processedMessages 缓存 | 1 文件                              |
| Phase 3 | 修改 `SideNav.tsx` 接入 flatItems 缓存                            | 1 文件                              |
| Phase 4 | 修改 `ChatPanel.tsx` 接入 messageIds 缓存                         | 1 文件                              |
| Phase 5 | 会话删除时调用 clearRenderCache                                   | use-session-store 或 use-chat-store |
| Phase 6 | 添加 perfLog 可观测性                                             | 各组件                              |
| Phase 7 | 审计 messages 数组的原地修改风险                                  | use-chat-store 更新路径             |
| Phase 8 | 性能基准测试 + 单元测试                                           | 新测试文件                          |

每个阶段可独立提交，不影响现有功能。Phase 2-4 无先后依赖，可并行。
