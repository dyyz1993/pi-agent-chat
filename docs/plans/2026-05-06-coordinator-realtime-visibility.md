# Coordinator 实时会话推送 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 当 coordinator 派发任务创建子会话后，前端实时显示子会话的动态（状态、消息、进度），复用 subagent 的成熟模式。

**Architecture:** 沿用 subagent 事件转发模式：pi-momo-fork handler emit 事件 → process-manager.ts 转发子会话 agent.event → 前端 coordinator store + UI 渲染。Coordinator 子会话与 subagent 共享 ChatPanel 的 `isViewingSubagent` 查看机制。

**Tech Stack:** TypeScript, Zustand, @dyyz1993/rpc-core (WebSocket events), React

---

## Phase 1: pi-momo-fork handler emit 事件

### Task 1.1: 在 handler.ts 中添加事件发射

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/coordinator/handler.ts`

**Step 1: 在 session_delegate handler 中 emit task_started**

在 `channel.handle("session_delegate", ...)` 回调里，`pm.delegate()` 成功后添加:

```typescript
channel.emit("task_started", {
  sessionId: result.sessionId,
  title: title || task.slice(0, 60),
  task,
});
```

**Step 2: 在 session_delegate_stop handler 中 emit task_stopped**

```typescript
channel.emit("task_stopped", { sessionId: params.sessionId });
```

**Step 3: 重新构建 pi-momo-fork**

Run: `cd /Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent && npm run build`

---

## Phase 2: process-manager.ts 转发子会话事件

### Task 2.1: 子会话 agent.event 转发为 coordinator.session.event

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/shared/agent/process-manager.ts`

**Step 1: 在 handleCoordinatorDelegate 中注册子会话事件转发**

在 `handleCoordinatorDelegate` 方法（约 line 1503）创建子会话后，为子会话的 agent event 建立转发：

```typescript
// 在 this.send(newSessionId, task) 之前
this.setupCoordinatorChildForwarding(parentSessionId, newSessionId);
```

**Step 2: 新增 setupCoordinatorChildForwarding 方法**

```typescript
private setupCoordinatorChildForwarding(parentSessionId: string, childSessionId: string): void {
  const child = this.clients.get(childSessionId);
  if (!child) return;

  // 子会话的 agent 事件桥接中，拦截并转发为 coordinator.session.event
  // 复用 subagent 模式：将子会话事件包装后广播
}
```

**关键设计**：子会话通过 `this.start()` 创建时已有 `bridge` 事件监听器（line 174-176）。需要在子会话的 event bridge 中，把 agent event 额外广播为 `coordinator.session.event`。

**方案**：在 `handleEvent` 方法中检查：如果当前 sessionId 是 coordinator 子会话，则额外广播一个 `coordinator.session.event`。

```typescript
// handleEvent 方法末尾，emitAgentEvent 之前
const parentId = this.findParentSession(sessionId);
if (parentId) {
  // 是 coordinator 子会话，额外转发
  await this.broadcastEvent(
    "coordinator.session.event",
    { parentSessionId: parentId, childSessionId: sessionId, event: sanitized },
    { parentSessionId: parentId },
  );
}
```

**Step 3: 新增 findParentSession 辅助方法**

```typescript
private findParentSession(childSessionId: string): string | null {
  for (const [parentId, children] of this.parentChildMap.entries()) {
    if (children.has(childSessionId)) return parentId;
  }
  return null;
}
```

### Task 2.2: handleCoordinatorCall 中转发 coordinator channel 事件

已有代码（line 1428）已经将非 `__call` 消息广播为 `coordinator.event`，无需修改。确保日志正确即可。

---

## Phase 3: 前端 coordinator store + 订阅

### Task 3.1: 创建 use-coordinator-store.ts

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/stores/use-coordinator-store.ts`

**结构**：复用 use-subagent-store 的模式：

```typescript
interface CoordinatorSessionInfo {
  sessionId: string;
  title: string;
  task: string;
  projectPath: string;
  dispatchedAt: number;
  status: "idle" | "streaming" | "stopped" | "completed";
  completedAt?: number;
  contextUsage?: ContextUsage;
}

interface CoordinatorState {
  sessionsByParent: Record<string, CoordinatorSessionInfo[]>; // parentSessionId → sessions
  activeCoordinatorSessionId: string | null;
  messagesByCoordinatorSession: Record<string, ChatMessage[]>;
  statusMap: Record<string, SessionStatus>;

  upsertSession: (
    parentId: string,
    sessionId: string,
    partial: Partial<CoordinatorSessionInfo>,
  ) => void;
  setActiveCoordinatorSession: (parentId: string, sessionId: string | null) => void;
  setMessages: (sessionId: string, msgs: ChatMessage[]) => void;
  updateStatus: (sessionId: string, status: SessionStatus) => void;
}
```

### Task 3.2: 创建 handleCoordinatorSessionEvent

在 `use-coordinator-store.ts` 中导出：

```typescript
export function handleCoordinatorSessionEvent(
  childSessionId: string,
  event: AgentEvent,
  parentSessionId: string,
) {
  // 复用 handleSubagentEvent 的消息处理逻辑
  // 处理 agent_start → status streaming
  // 处理 message_start/update/end → 构建 ChatMessage[]
  // 处理 agent_end → status idle, completedAt
}
```

### Task 3.3: 在 session-subscriptions.ts 中添加 coordinator 订阅

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/stores/session-subscriptions.ts`

添加 `coordinatorSubscriptions` 到 `SubscriptionMaps` 和 `setupSubscriptions`:

```typescript
// 订阅 coordinator.event（channel emit 的事件）
if (!coordinatorSubscriptions[id]) {
  coordinatorSubscriptions[id] = apiClient.subscribe(
    "coordinator.event",
    (payload) => {
      if (payload.sessionId !== id) return;
      const event = payload.event as CoordinatorEvent;
      // 处理 task_started → 创建 coordinator session 条目
      // 处理 task_stopped/completed/error → 更新状态
    },
    { sessionId: id },
  );
}

// 订阅 coordinator.session.event（子会话 agent event 转发）
if (!coordinatorSessionSubscriptions[id]) {
  coordinatorSessionSubscriptions[id] = apiClient.subscribe(
    "coordinator.session.event",
    (payload) => {
      if (payload.parentSessionId !== id) return;
      handleCoordinatorSessionEvent(payload.childSessionId, payload.event, payload.parentSessionId);
    },
    { parentSessionId: id },
  );
}
```

### Task 3.4: 在 use-session-store.ts 添加 coordinatorSubscriptions

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/stores/use-session-store.ts`

在 `SubscriptionMaps` 接口和 session state 中添加:

- `coordinatorSubscriptions: Record<string, string>`
- `coordinatorSessionSubscriptions: Record<string, string>`

---

## Phase 4: 前端 UI 展示

### Task 4.1: 创建 CoordinatorRenderer.tsx

**Files:**

- Create: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/components/chat/tool-renderers/CoordinatorRenderer.tsx`

**结构**：复用 SubagentRenderer 模式，但样式区分（用不同颜色，如 amber/teal）

```typescript
// 检测 toolName === "session_delegate" 的 toolExecution block
// 显示：标题、状态、进度、"查看" 按钮
// 点击查看 → setActiveCoordinatorSession(parentId, sessionId)
```

### Task 4.2: 注册 CoordinatorRenderer

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/components/chat/tool-renderers/registry.ts`

```typescript
registerToolRenderer("session_delegate", coordinatorRenderer);
```

### Task 4.3: ChatPanel 支持 coordinator 会话查看

**Files:**

- Modify: `/Users/xuyingzhou/Project/temporary/pi-agent-chat/src/mainview/components/chat/ChatPanel.tsx`

扩展 `isViewingSubagent` 模式：

```typescript
const activeCoordSessionId = useCoordinatorStore((s) => s.activeCoordinatorSessionId);
const isViewingCoordinator = !!activeCoordSessionId;

// 消息源选择
const messages = isViewingCoordinator
  ? coordMessages
  : isViewingSubagent
    ? subMessages
    : mainMessages;
```

### Task 4.4: 返回主会话按钮

在 ChatPanel 的 header 区域，当 `isViewingCoordinator` 时显示"返回主会话"按钮（复用 subagent 的 ArrowLeft 按钮样式）。

---

## Phase 5: 端到端验证

### Task 5.1: 验证 coordinator 扩展加载

1. 重启服务
2. 检查日志无 coordinator 相关错误
3. 在聊天界面让 AI 调用 `session_delegate` 工具

### Task 5.2: 验证前端实时推送

1. 打开浏览器 DevTools → Network → WS
2. 让 AI 派发一个任务
3. 确认收到 `coordinator.event` (task_started)
4. 确认收到 `coordinator.session.event` (agent_start, message_update 等)
5. 确认 UI 显示委派任务卡片和实时进度
