# FollowUp 消息竞态丢失问题

> 仓库: `github.com/dyyz1993/pi-mono` (packages/agent)
> 包名: `@dyyz1993/pi-agent-core`

## 问题描述

当用户在 agent 即将完成（即将 idle）时发送 `followUp` 消息，有一定概率消息永远不会被消费，导致 followUp 卡在队列中丢失。

## 根因分析

有两个缺陷叠加导致：

### 缺陷 1：`agent-loop.ts` 的 `runLoop` 存在竞态窗口

在 `runLoop` 函数中，消费 followUp 的逻辑如下（`agent-loop.ts` ~line 136）：

```typescript
// Agent 内循环结束，检查 followUp
const followUpMessages = (await config.getFollowUpMessages?.()) || [];
if (followUpMessages.length > 0) {
  pendingMessages = followUpMessages;
  continue; // 回到外层循环继续处理
}
// No more messages, exit
break;
```

**竞态窗口**：`getFollowUpMessages()` 调用 `drain()` 取出所有消息后检查——如果队列为空就 `break` 退出。但从 `break` → 执行 `emit("agent_end")` → 回到 `runWithLifecycle` 的 `finally` → 执行 `finishRun()` 清除 `activeRun` 之间，存在一个时间窗口。

在这个窗口内如果 `followUp()` 被调用（消息被 `enqueue` 进 `followUpQueue`），**没有任何机制会再回去检查队列**，这条 followUp 就丢失了。

### 缺陷 2：`agent.ts` 的 `followUp()` 方法只管排队不管消费

```typescript
/** Queue a message to run only after the agent would otherwise stop. */
followUp(message: AgentMessage | string) {
    this.followUpQueue.enqueue(message);
    // 没有检查 agent 是否在运行，没有自动消费逻辑
}
```

它假设调用者一定在 agent 正在运行时才调用 `followUp()`。但缺陷 1 中的竞态窗口意味着调用可能在 run 已经"逻辑上结束"但还没 `finishRun()` 的时候发生。

### 缺陷 3（次要）：`continue()` 不会自动触发

`continue()` 方法虽然会 drain followUp 队列：

```typescript
async continue() {
    // ...
    if (lastMessage.role === "assistant") {
        const queuedSteering = this.steeringQueue.drain();
        if (queuedSteering.length > 0) { ... return; }
        const queuedFollowUps = this.followUpQueue.drain();
        if (queuedFollowUps.length > 0) {
            await this.runPromptMessages(queuedFollowUps);
            return;
        }
        throw new Error("Cannot continue from message role: assistant");
    }
    // ...
}
```

但 `continue()` 只有在被**显式调用**时才触发。run 结束后没有任何人自动调用它。

## 复现路径

1. Agent 在处理最后一个 turn，即将完成
2. 用户在 UI 上输入文字按发送 → 前端调用 `agent.followUp` RPC
3. Backend 调用 `managed.client.followUp(content)` → enqueue 到 `followUpQueue`
4. 但此时 `runLoop` 已经 `break` 退出外层循环（但还没执行到 `finishRun`）
5. Agent 发出 `agent_end` 事件，进入 idle 状态
6. followUp 消息在队列里没人处理

## 修复方案（推荐）

在 `agent.ts` 的 `followUp()` 方法中检测 agent 是否不在运行中，如果是 idle 状态则自动触发消费：

```typescript
/** Queue a message to run only after the agent would otherwise stop. */
followUp(message: AgentMessage | string) {
    this.followUpQueue.enqueue(message);
    // 如果 agent 不在运行状态，立即启动消费
    if (!this.activeRun) {
        this.continue().catch((err) => {
            console.warn("followUp auto-continue failed:", err);
        });
    }
}
```

## 备选方案

### 方案 B：在 `runLoop` 的 `emit("agent_end")` 前加一次最终检查

```typescript
// 在 emit agent_end 之前
const finalFollowUpMessages = (await config.getFollowUpMessages?.()) || [];
if (finalFollowUpMessages.length > 0) {
  pendingMessages = finalFollowUpMessages;
  continue;
}
```

但只能缩小竞态窗口，不能完全消除。

### 方案 C：在 `finishRun()` 中检查并消费

```typescript
finishRun() {
    // ... 原有逻辑 ...
    // 检查队列中是否有残留消息
    if (this.followUpQueue.hasItems()) {
        const queued = this.followUpQueue.drain();
        this.runPromptMessages(queued).catch(() => {});
    }
}
```

同样存在递归风险，需要注意。

## 建议优先级

- **严重程度**: Medium（不影响正常单次对话，但在快速连续输入时概率性触发）
- **建议** 优先采用方案 A，改动最小，逻辑最清晰
