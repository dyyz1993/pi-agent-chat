# LLM 错误静默丢失修复计划

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 确保 LLM 调用失败时，用户能在聊天界面 inline 看到错误提示，而不是只能看到一个永远不消失的"搜索中…"或一个空白的 assistant 消息。

**Architecture:** 在 `agent_end` 和 `message_end` 处理器中检测"空回合"场景（用户发了消息但没收到任何 assistant 内容），并注入一条 error 级别的 inline 消息到聊天列表。同时修复 `sendMessage` catch 块中未清理乐观更新消息的问题。Prefetch fallback timer 在超时时显示失败状态而非永久加载。

**Tech Stack:** React 18, TypeScript, Zustand, WebSocket RPC

---

## 复现路径（已验证）

使用 `baiduqianfan/minimax-m2.5` 模型发送消息：

1. `agent.send` RPC 返回 `{ ok: true }`
2. JSONL 写入了 user message + 空 assistant message（stopReason=undefined）
3. **0 条 WebSocket 事件推送**（既没有 `agent_end`，也没有 `extension_llm_error`）
4. 前端停留在 streaming 状态 → 超时后 watchdog 恢复为 idle
5. 用户看到：自己的消息 + "搜索中…" prefetch 卡片，没有任何错误提示

---

### Task 1: `sendMessage` catch 块清理乐观更新消息

**问题：** `use-chat-store.ts:344-350` — `sendMessage` 的 catch 块推送了错误通知，但没有移除乐观添加的用户消息（line 310-322）。导致消息残留。

**Files:**

- Modify: `src/mainview/stores/use-chat-store.ts:344-350`

**Step 1: 修改 catch 块**

在 `catch (err)` 块中，在推送通知之前，移除乐观添加的 `_local` 用户消息：

```typescript
} catch (err) {
  set((s) => {
    const msgs = s.messagesBySession[sessionId] || [];
    return {
      isStreaming: false,
      messagesBySession: {
        ...s.messagesBySession,
        [sessionId]: msgs.filter((m) => !m._local),
      },
    };
  });
  useSessionStore.getState().updateSessionStatus(sessionId, "idle");
  const msg = err instanceof Error ? err.message : String(err);
  useAppStore.getState().addLog(`Send error: ${msg}`);
  useNotificationStore.getState().push({ message: `Send failed: ${msg}`, level: "error" });
  set({ inputText: text });
}
```

注意：catch 块中 `text` 变量在 try 外部声明（line 266），所以可以在 catch 中访问。

**Step 2: 运行 lint 检查**

Run: `npx eslint src/mainview/stores/use-chat-store.ts`
Expected: No errors

**Step 3: Commit**

```bash
git add src/mainview/stores/use-chat-store.ts
git commit -m "fix: clean up optimistic user message on send failure"
```

---

### Task 2: `agent_end` 检测空回合并显示 inline 错误

**问题：** `agent-event-handler.ts:56-91` — `agent_end` 无 reason 时只弹一个 5 秒就消失的 info toast。如果上一轮用户发了消息但 assistant 没有内容，用户看不到任何错误。

**Files:**

- Modify: `src/mainview/stores/agent-event-handler.ts:56-91`

**Step 1: 在 `agent_end` handler 中添加空回合检测**

在 `agent_end` 处理器的 status 更新之后、通知之前，检测是否有"孤立"的用户消息（最后一条是 user 且没有对应的 assistant 响应）：

```typescript
if (event.type === "agent_end") {
  storeGet().updateSessionStatus(sessionId, "idle");
  useUIDialogStore.getState().clearPendingBySession(sessionId);
  useChangeReviewStore.getState().fetchPending();
  const currentQueue = storeGet().queueBySession;
  if (currentQueue[sessionId]) {
    const { [sessionId]: _removed, ...rest } = currentQueue;
    useSessionStore.setState({ queueBySession: rest });
  }
  const allSessions = storeGet().sessionsByProject;
  for (const sessList of Object.values(allSessions)) {
    const session = sessList.find((s) => s.sessionId === sessionId);
    if (session) {
      useMemoryStore.getState().loadFiles(session.projectPath, sessionId);
      break;
    }
  }

  const crashReason = (event as { reason?: string }).reason;
  if (crashReason) {
    notificationGateway.emit({
      type: "session_complete",
      sessionId,
      title: "Agent 进程异常退出",
      body: crashReason,
      level: "error",
    });
  } else {
    // 检测空回合：最后一条消息是 user，且没有 assistant 响应
    const chat = useChatStore.getState();
    const msgs = chat.messagesBySession[sessionId] || [];
    const lastMsg = msgs[msgs.length - 1];
    const lastIsUser = lastMsg && (lastMsg.role === "user" || lastMsg.role === "custom");

    if (lastIsUser) {
      // 注入 inline error message
      chat.setMessagesForSession(sessionId, [
        ...msgs,
        {
          id: `error_${Date.now()}`,
          role: "error" as const,
          content: "Agent 未返回响应，可能是 LLM 服务异常或网络问题",
          timestamp: Date.now(),
        },
      ]);
      notificationGateway.emit({
        type: "session_error",
        sessionId,
        title: "响应失败",
        body: "Agent 未返回任何响应，请检查模型配置或重试",
        level: "error",
      });
    } else {
      notificationGateway.emit({
        type: "session_complete",
        sessionId,
        title: "会话完成",
        body: `会话 ${sessionId.slice(0, 8)}... 执行完毕`,
        level: "info",
      });
    }
  }
  return;
}
```

**Step 2: 添加 `error` role 到 ChatMessage 类型**

检查 `src/mainview/types/index.ts` 中的 `ChatMessage` 类型，确认 `role` 是否支持 `"error"`。如果不支持，添加：

在 `ChatMessage` 的 `role` 联合类型中添加 `"error"`：

```typescript
role: "user" | "assistant" | "error" | "custom";
```

**Step 3: 添加 error 消息的渲染组件**

在 `src/mainview/components/chat/message/` 中检查是否有 error role 的渲染支持。如果没有，在 `MessageBubble.tsx` 或消息渲染的 switch 中添加：

```tsx
if (message.role === "error") {
  return (
    <div className="flex justify-center my-2">
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 text-sm text-red-400">
        <AlertTriangle className="w-4 h-4 shrink-0" />
        <span>{message.content as string}</span>
      </div>
    </div>
  );
}
```

**Step 4: 运行 lint 和类型检查**

Run: `npx eslint src/mainview/stores/agent-event-handler.ts src/mainview/types/index.ts`
Expected: No errors

**Step 5: Commit**

```bash
git add src/mainview/stores/agent-event-handler.ts src/mainview/types/index.ts src/mainview/components/chat/message/
git commit -m "fix: detect empty turns on agent_end and show inline error"
```

---

### Task 3: `message_end` 空助手消息时注入错误而非静默删除

**问题：** `agent-event-handler.ts:466-468` — 当 assistant 消息为空时直接删除，用户看到自己消息后什么都没有。

**Files:**

- Modify: `src/mainview/stores/agent-event-handler.ts:456-469`

**Step 1: 修改 `message_end` 的空内容处理**

将"静默删除"改为"替换为 error 提示"：

```typescript
if (!hasContent) {
  // 不再静默删除空 assistant 消息
  // 而是替换为一条 error 提示
  chat.setMessagesForSession(sessionId, [
    ...existing.slice(0, -1),
    {
      ...lastMsg,
      role: "error" as const,
      content: "LLM 未返回有效响应",
      isStreaming: false,
    },
  ]);
  notificationGateway.emit({
    type: "session_error",
    sessionId,
    title: "响应为空",
    body: "LLM 返回了空响应，可能是模型配置问题或 API 错误",
    level: "warning",
  });
  return;
}
```

**Step 2: 运行 lint**

Run: `npx eslint src/mainview/stores/agent-event-handler.ts`

**Step 3: Commit**

```bash
git add src/mainview/stores/agent-event-handler.ts
git commit -m "fix: show inline error instead of silently removing empty assistant messages"
```

---

### Task 4: Prefetch fallback timer 显示失败状态

**问题：** `agent-event-handler.ts:676-690` — Prefetch fallback timer 在 5 秒后创建一个永远显示"搜索中…"的卡片，因为 `memory_prefetch_result` 永远不会到来。

**Files:**

- Modify: `src/mainview/stores/agent-event-handler.ts:676-693`

**Step 1: 在 fallback timer 创建的 prefetch 卡片中标记超时状态**

修改 fallback timer，在创建卡片时添加 `_timedOut: true` 标记：

```typescript
const timer = setTimeout(() => {
  sessionMap.delete(eventId);
  if (sessionMap.size === 0) pendingPrefetchMap.delete(sessionId);
  const chat = useChatStore.getState();
  const msgs = chat.messagesBySession[sessionId] || [];
  chat.setMessagesForSession(sessionId, [
    ...msgs,
    {
      id: eventId,
      role: "custom" as const,
      content: [
        {
          type: "custom" as const,
          customType: "memory_prefetch",
          data: { ...event.data, _timedOut: true },
        },
      ],
      timestamp: Date.now(),
    },
  ]);
}, PREFETCH_FALLBACK_MS);
```

**Step 2: 在 MemoryPrefetch UI 组件中渲染超时状态**

找到渲染 `memory_prefetch` 卡片的组件（搜索 `memory_prefetch` 在 `MessageBubble.tsx` 或 `TimelineTurn.tsx` 中的渲染逻辑），在 `data._timedOut === true` 时显示：

```tsx
if (data._timedOut) {
  return (
    <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-text-tertiary opacity-50">
      <Search className="w-3.5 h-3.5" />
      <span>记忆搜索超时</span>
    </div>
  );
}
```

**Step 3: 运行 lint**

Run: `npx eslint src/mainview/stores/agent-event-handler.ts`

**Step 4: Commit**

```bash
git add src/mainview/stores/agent-event-handler.ts src/mainview/components/chat/
git commit -m "fix: show timeout state for stalled prefetch instead of infinite loading"
```

---

### Task 5: `compaction_end` 检查失败状态

**问题：** `agent-event-handler.ts:99-106` — `compaction_end` 无条件转到 idle，不检查是否有错误。

**Files:**

- Modify: `src/mainview/stores/agent-event-handler.ts:99-106`

**Step 1: 添加 compaction 失败检测**

```typescript
if (event.type === "compaction_end") {
  log.info("compaction_end → force reload", { sessionId });
  const tokensAfter = event.result?.tokensAfter;
  storeGet().updateSessionContext(sessionId, { tokens: tokensAfter ?? null });

  if (event.error || event.result?.success === false) {
    const errMsg = event.error || event.result?.error || "压缩失败";
    notificationGateway.emit({
      type: "session_error",
      sessionId,
      title: "上下文压缩失败",
      body: errMsg,
      level: "warning",
    });
  }

  storeGet().updateSessionStatus(sessionId, "idle");
  useChatStore.getState().loadSessionMessages(sessionId, { force: true });
  return;
}
```

**Step 2: 运行 lint**

Run: `npx eslint src/mainview/stores/agent-event-handler.ts`

**Step 3: Commit**

```bash
git add src/mainview/stores/agent-event-handler.ts
git commit -m "fix: check compaction_end for errors and notify user"
```

---

### Task 6: 通知中心 inline toast（可选增强）

**问题：** 错误通知只出现在通知中心下拉里（需要点铃铛才能看到），不够显眼。

**Files:**

- Create: `src/mainview/components/chat/InlineToast.tsx`
- Modify: `src/mainview/components/chat/ChatPanel.tsx`

**Step 1: 创建 InlineToast 组件**

```tsx
import { useNotificationStore } from "../../stores/use-notification-store";
import { AlertTriangle, X } from "lucide-react";

export function InlineToast() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismiss);

  const errorNotifs = notifications.filter((n) => n.level === "error" && !n.read);

  if (errorNotifs.length === 0) return null;

  return (
    <div className="absolute top-3 left-3 right-3 z-50 flex flex-col gap-2">
      {errorNotifs.slice(0, 3).map((n) => (
        <div
          key={n.id}
          className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/20 backdrop-blur-sm"
        >
          <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span className="text-sm text-red-300 flex-1">{n.message}</span>
          <button
            onClick={() => dismiss(n.id)}
            className="shrink-0 p-0.5 hover:bg-red-500/20 rounded"
          >
            <X className="w-3.5 h-3.5 text-red-400" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

**Step 2: 在 ChatPanel 中添加 InlineToast**

在 `ChatPanel.tsx` 的聊天区域（`<div className="flex-1 min-w-0 flex flex-col">`）中添加 `<InlineToast />`，放在 `<RetryNotification />` 之后：

```tsx
<RetryNotification />
<InlineToast />
```

**Step 3: 运行 lint 和类型检查**

Run: `npx eslint src/mainview/components/chat/InlineToast.tsx src/mainview/components/chat/ChatPanel.tsx`

**Step 4: Commit**

```bash
git add src/mainview/components/chat/InlineToast.tsx src/mainview/components/chat/ChatPanel.tsx
git commit -m "feat: add inline error toast overlay in chat panel"
```

---

### Task 7: 清理临时文件

**Step 1: 删除复现脚本**

```bash
rm /Users/xuyingzhou/Project/temporary/pi-agent-chat/reproduce-error.mjs
rm -rf /tmp/pi-error-test-*
```

**Step 2: Commit**

```bash
git add -A
git commit -m "chore: clean up error reproduction scripts"
```

---

## 修复效果总结

| 场景                   | 修复前                  | 修复后                         |
| ---------------------- | ----------------------- | ------------------------------ |
| LLM 返回空响应         | 静默删除 assistant 消息 | inline error 卡片 + error 通知 |
| `agent_end` 无 reason  | 5 秒 info toast 消失    | 检测空回合 → inline error      |
| `sendMessage` RPC 失败 | 乐观消息残留            | 清理乐观消息 + 恢复输入框      |
| Prefetch 超时          | 永远"搜索中…"           | "记忆搜索超时"                 |
| `compaction_end` 失败  | 静默                    | warning 通知                   |
| error 通知可见性       | 只有铃铛下拉            | chat 区域 inline toast overlay |
