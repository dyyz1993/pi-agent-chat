import { vi } from "vitest";
import { buildDelegateSyncTimeoutRecoveryText } from "../../src/shared/agent/coordinator-delegate-operations";

export type SyncResult = {
  sessionId: string;
  status: string;
  exitCode: number;
  finalText: string;
  error?: string;
};

export type SyncResolver = {
  resolve: (result: SyncResult) => void;
  timeout: ReturnType<typeof setTimeout>;
  parentSessionId: string;
};

export interface DelegateSyncDeps {
  start: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
  ) => Promise<{ status: string }>;
  send: (sessionId: string, prompt: string) => void;
  setSessionName: (sessionId: string, name: string) => Promise<void>;
  broadcastEvent: (
    event: string,
    payload: Record<string, unknown>,
    opts?: { parentSessionId?: string },
  ) => Promise<void>;
  stop: (sessionId: string) => void;
}

export interface SubagentSessionInfo {
  sessionId: string;
  sessionPath: string;
  description: string;
  instruction: string;
  startedAt?: number;
  completedAt?: number;
  exitCode?: number;
  finalText?: string;
  provider?: string;
  model?: string;
}

export type SessionStatus = "idle" | "streaming" | "compacting" | "retrying" | "stopped";

export interface ChatMessage {
  id?: string;
  role: string;
  content: Array<Record<string, unknown>>;
  isStreaming?: boolean;
  stopReason?: string | null;
  provider?: string;
  model?: string;
  tokenUsage?: Record<string, unknown>;
}

export interface MockSubagentState {
  subsessionsByParent: Record<string, SubagentSessionInfo[]>;
  messagesBySubsession: Record<string, ChatMessage[]>;
  subagentStatusMap: Record<string, SessionStatus>;
  subagentContextMap: Record<string, { tokens: number | null; contextWindow: number }>;
}

export class MockSubagentStore {
  state: MockSubagentState = {
    subsessionsByParent: {},
    messagesBySubsession: {},
    subagentStatusMap: {},
    subagentContextMap: {},
  };

  updateSubagentStatus(subId: string, status: SessionStatus): void {
    this.state.subagentStatusMap[subId] = status;
  }

  upsertLiveSubagent(
    parentSessionPath: string,
    subId: string,
    partial: Partial<SubagentSessionInfo>,
  ): void {
    const existing = this.state.subsessionsByParent[parentSessionPath] || [];
    const idx = existing.findIndex((e) => e.sessionId === subId);
    const base =
      idx >= 0
        ? existing[idx]
        : {
            sessionId: subId,
            sessionPath: "",
            description: "",
            instruction: "",
            startedAt: Date.now(),
          };
    const merged: SubagentSessionInfo = { ...base, ...partial };
    let updated: SubagentSessionInfo[];
    if (idx >= 0) {
      updated = [...existing];
      updated[idx] = merged;
    } else {
      updated = [...existing, merged];
    }
    this.state.subsessionsByParent[parentSessionPath] = updated;
  }

  setSubMessages(subId: string, msgs: ChatMessage[]): void {
    this.state.messagesBySubsession[subId] = msgs;
  }

  reset(): void {
    this.state = {
      subsessionsByParent: {},
      messagesBySubsession: {},
      subagentStatusMap: {},
      subagentContextMap: {},
    };
  }
}

export class SyncDelegateHarness {
  syncDelegateResolvers = new Map<string, SyncResolver>();
  subagentSyncChildren = new Set<string>();
  syncDelegateLastText = new Map<string, string>();
  parentChildMap = new Map<string, Set<string>>();
  delegateCreatedAt = new Map<string, number>();
  delegateReplyCount = new Map<string, number>();

  constructor(private deps: DelegateSyncDeps) {}

  private generateSessionId(): string {
    return `sess_sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }

  startDelegateSync(
    parentSessionId: string,
    msg: { task: string; title?: string; agent?: string; timeoutMs?: number },
  ): { sessionId: string; resultPromise: Promise<SyncResult> } {
    const { task, title, agent, timeoutMs = 300000 } = msg;

    const newSessionId = this.generateSessionId();

    this.delegateCreatedAt.set(newSessionId, Date.now());
    this.delegateReplyCount.set(newSessionId, 0);

    let children = this.parentChildMap.get(parentSessionId);
    if (!children) {
      children = new Set<string>();
      this.parentChildMap.set(parentSessionId, children);
    }
    children.add(newSessionId);

    const rawTitle = title ?? task.slice(0, 60);

    const syncPromise = new Promise<SyncResult>((resolve) => {
      const timeout = setTimeout(() => {
        this.syncDelegateResolvers.delete(newSessionId);
        this.subagentSyncChildren.delete(newSessionId);
        this.syncDelegateLastText.delete(newSessionId);
        resolve({
          sessionId: newSessionId,
          status: "timeout",
          exitCode: 1,
          finalText: buildDelegateSyncTimeoutRecoveryText({
            sessionId: newSessionId,
            timeoutMs,
            lastText: this.syncDelegateLastText.get(newSessionId),
          }),
        });
      }, timeoutMs);

      this.syncDelegateResolvers.set(newSessionId, { resolve, timeout, parentSessionId });
    });

    this.subagentSyncChildren.add(newSessionId);

    const sessionTitle = `子代理: ${rawTitle}`;
    const delegatePrompt = [
      `[系统提示] 你是一个子代理任务会话。`,
      agent ? `**Agent 角色:** ${agent}` : "",
      `**任务:** ${rawTitle}`,
      ``,
      `要求：`,
      `1. 专注于完成委派给你的任务`,
      `2. 执行完毕后，明确总结你的工作成果`,
      `3. 如果遇到问题无法继续，说明原因`,
      ``,
      `---`,
      ``,
      task,
    ]
      .filter(Boolean)
      .join("\n");

    const resultPromise = this.deps
      .start(newSessionId, "/fake/project", `/fake/sessions/${newSessionId}.jsonl`)
      .then(() => this.deps.setSessionName(newSessionId, sessionTitle))
      .then(() => {
        this.deps.send(newSessionId, delegatePrompt);
        return this.deps.broadcastEvent("subagent.event", {
          parentSessionId,
          parentSessionPath: `/fake/sessions/${parentSessionId}.jsonl`,
          subSessionId: newSessionId,
          event: {
            type: "subagent_start",
            toolCallId: "",
            description: rawTitle,
            instruction: task,
          },
        });
      })
      .then(() => syncPromise);

    return { sessionId: newSessionId, resultPromise };
  }

  simulateAgentStart(sessionId: string, parentId: string): void {
    if (!this.subagentSyncChildren.has(sessionId)) return;
    this.deps
      .broadcastEvent("subagent.event", {
        parentSessionId: parentId,
        parentSessionPath: `/fake/sessions/${parentId}.jsonl`,
        subSessionId: sessionId,
        event: { type: "agent_start" },
      })
      .catch(() => {});
  }

  simulateMessageStart(sessionId: string, parentId: string, messageId?: string): void {
    if (!this.subagentSyncChildren.has(sessionId)) return;
    this.deps
      .broadcastEvent("subagent.event", {
        parentSessionId: parentId,
        parentSessionPath: `/fake/sessions/${parentId}.jsonl`,
        subSessionId: sessionId,
        event: {
          type: "message_start",
          message: { id: messageId ?? "msg-1", role: "assistant", content: [] },
        },
      })
      .catch(() => {});
  }

  simulateMessageUpdate(sessionId: string, parentId: string, textDelta: string): void {
    if (!this.subagentSyncChildren.has(sessionId)) return;
    this.deps
      .broadcastEvent("subagent.event", {
        parentSessionId: parentId,
        parentSessionPath: `/fake/sessions/${parentId}.jsonl`,
        subSessionId: sessionId,
        event: {
          type: "message_update",
          message: {
            role: "assistant",
            content: [{ type: "text", text: textDelta }],
          },
        },
      })
      .catch(() => {});
  }

  simulateToolExecutionStart(
    sessionId: string,
    parentId: string,
    toolCallId: string,
    toolName: string,
  ): void {
    if (!this.subagentSyncChildren.has(sessionId)) return;
    this.deps
      .broadcastEvent("subagent.event", {
        parentSessionId: parentId,
        parentSessionPath: `/fake/sessions/${parentId}.jsonl`,
        subSessionId: sessionId,
        event: { type: "tool_execution_start", toolCallId, toolName },
      })
      .catch(() => {});
  }

  simulateMessageEnd(sessionId: string, textContent: string): void {
    if (this.subagentSyncChildren.has(sessionId)) {
      this.syncDelegateLastText.set(sessionId, textContent.slice(0, 2000));
    }
  }

  simulateAgentEnd(sessionId: string): void {
    const resolver = this.syncDelegateResolvers.get(sessionId);
    if (resolver) {
      clearTimeout(resolver.timeout);
      this.syncDelegateResolvers.delete(sessionId);
      this.subagentSyncChildren.delete(sessionId);
      const finalText = this.syncDelegateLastText.get(sessionId) ?? "(completed)";
      this.syncDelegateLastText.delete(sessionId);
      resolver.resolve({
        sessionId,
        status: "completed",
        exitCode: 0,
        finalText: finalText || "(completed)",
      });
    }
  }

  simulateCrash(sessionId: string, errorText: string): void {
    const resolver = this.syncDelegateResolvers.get(sessionId);
    if (resolver) {
      clearTimeout(resolver.timeout);
      this.syncDelegateResolvers.delete(sessionId);
      this.subagentSyncChildren.delete(sessionId);
      this.syncDelegateLastText.delete(sessionId);
      resolver.resolve({
        sessionId,
        status: "error",
        exitCode: 1,
        finalText: errorText,
        error: errorText,
      });
    }
  }

  stopSession(sessionId: string): void {
    this.deps.stop(sessionId);

    for (const [, childSet] of this.parentChildMap) {
      childSet.delete(sessionId);
    }
    this.delegateReplyCount.delete(sessionId);
    this.delegateCreatedAt.delete(sessionId);

    const syncResolver = this.syncDelegateResolvers.get(sessionId);
    if (syncResolver) {
      clearTimeout(syncResolver.timeout);
      this.syncDelegateResolvers.delete(sessionId);
      this.subagentSyncChildren.delete(sessionId);
      this.syncDelegateLastText.delete(sessionId);
      syncResolver.resolve({ sessionId, status: "aborted", exitCode: 1, finalText: "(stopped)" });
    }
  }

  findParentSession(childSessionId: string): string | null {
    for (const [parentId, children] of this.parentChildMap.entries()) {
      if (children.has(childSessionId)) return parentId;
    }
    return null;
  }
}

export function createMockDeps(): DelegateSyncDeps & {
  _mocks: Record<string, ReturnType<typeof vi.fn>>;
} {
  const start = vi.fn().mockResolvedValue({ status: "started" });
  const send = vi.fn();
  const setSessionName = vi.fn().mockResolvedValue(undefined);
  const broadcastEvent = vi.fn().mockResolvedValue(undefined);
  const stop = vi.fn();
  return {
    start,
    send,
    setSessionName,
    broadcastEvent,
    stop,
    _mocks: { start, send, setSessionName, broadcastEvent, stop },
  };
}

export function feedEventToStore(
  store: MockSubagentStore,
  subId: string,
  event: Record<string, unknown>,
  parentPath?: string,
): void {
  const eventType = event.type as string;

  if (eventType === "agent_start" || eventType === "subagent_start") {
    store.updateSubagentStatus(subId, "streaming");
    if (eventType === "subagent_start" && parentPath) {
      store.upsertLiveSubagent(parentPath, subId, {
        description: (event.description as string) ?? "",
        instruction: (event.instruction as string) ?? "",
      });
    }
    return;
  }

  if (eventType === "agent_end") {
    for (const [path, subs] of Object.entries(store.state.subsessionsByParent)) {
      const match = subs.find((s) => s.sessionId === subId);
      if (match && !match.completedAt) {
        store.upsertLiveSubagent(path, subId, {
          completedAt: Date.now(),
          exitCode: 0,
          finalText: match.finalText ?? "(completed)",
        });
        break;
      }
    }
    store.updateSubagentStatus(subId, "idle");
    return;
  }

  if (eventType === "message_start") {
    const msg = event.message as Record<string, unknown> | undefined;
    if (msg) {
      const existing = store.state.messagesBySubsession[subId] || [];
      store.setSubMessages(subId, [
        ...existing,
        {
          role: String(msg.role ?? "assistant"),
          content: (msg.content as Array<Record<string, unknown>>) ?? [],
          isStreaming: true,
        },
      ]);
    }
    return;
  }

  if (eventType === "message_update") {
    const existing = store.state.messagesBySubsession[subId] || [];
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const blocks = [...(lastMsg.content as Array<Record<string, unknown>>)];
    const msgContent = (event.message as Record<string, unknown>)?.content as
      | Array<Record<string, unknown>>
      | undefined;
    if (!msgContent) return;

    for (const block of msgContent) {
      if (block.type === "text") {
        const lastIdx = blocks.length - 1;
        const lastBlock = blocks[lastIdx];
        if (lastIdx >= 0 && lastBlock?.type === "text") {
          blocks[lastIdx] = { type: "text", text: lastBlock.text + block.text };
        } else {
          blocks.push(block);
        }
      } else {
        blocks.push(block);
      }
    }

    store.setSubMessages(subId, [...existing.slice(0, -1), { ...lastMsg, content: blocks }]);
    return;
  }

  if (eventType === "message_end") {
    const existing = store.state.messagesBySubsession[subId] || [];
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const msg = event.message as Record<string, unknown> | undefined;
    let finalText = "";
    const content = msg?.content as Array<{ type: string; text?: string }> | undefined;
    if (Array.isArray(content)) {
      for (const part of content) {
        if (part.type === "text" && typeof part.text === "string") finalText += part.text;
      }
    }

    store.setSubMessages(subId, [
      ...existing.slice(0, -1),
      { ...lastMsg, isStreaming: false, stopReason: (msg?.stopReason as string) ?? null },
    ]);

    if (finalText) {
      for (const [path, subs] of Object.entries(store.state.subsessionsByParent)) {
        if (subs.some((s) => s.sessionId === subId)) {
          store.upsertLiveSubagent(path, subId, {
            completedAt: Date.now(),
            exitCode: 0,
            finalText: finalText.slice(0, 200),
          });
          break;
        }
      }
    }
    return;
  }

  if (eventType === "tool_execution_start") {
    const existing = store.state.messagesBySubsession[subId] || [];
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const blocks = [...(lastMsg.content as Array<Record<string, unknown>>)];
    blocks.push({
      type: "toolExecution",
      toolCallId: event.toolCallId as string,
      toolName: event.toolName as string,
      args: "",
      status: "running",
    });

    store.setSubMessages(subId, [...existing.slice(0, -1), { ...lastMsg, content: blocks }]);
    return;
  }

  if (eventType === "tool_execution_end") {
    const existing = store.state.messagesBySubsession[subId] || [];
    const lastMsg = existing[existing.length - 1];
    if (!lastMsg) return;

    const blocks = [...(lastMsg.content as Array<Record<string, unknown>>)];
    const targetIdx = blocks.findIndex(
      (b): b is Record<string, unknown> & { toolCallId: string } =>
        b.type === "toolExecution" && b.toolCallId === (event.toolCallId as string),
    );

    if (targetIdx >= 0) {
      const isError = Boolean(event.isError);
      blocks[targetIdx] = {
        ...blocks[targetIdx],
        status: isError ? "error" : "done",
        output: event.result ? JSON.stringify(event.result) : "",
      };
    }

    store.setSubMessages(subId, [...existing.slice(0, -1), { ...lastMsg, content: blocks }]);
    return;
  }
}
