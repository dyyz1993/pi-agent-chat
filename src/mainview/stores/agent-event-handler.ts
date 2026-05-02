import type { ContentBlock, ChatMessage, TokenUsage } from "../types";
import type { SessionMeta } from "../types";
import type { AgentEvent } from "../../shared/modules/agent";
import type { AssistantMessage, Message, Usage } from "@dyyz1993/pi-ai";
import { useChatStore } from "./use-chat-store";
import { useSessionStore } from "./use-session-store";
import { useMemoryStore } from "./use-memory-store";
import { useRetryStore } from "./use-retry-store";
import { notificationGateway } from "../lib/notification-gateway";
import { batchMessageUpdate, flushNow } from "./message-batcher";
import { messageToChatMessage, extractTokenUsage } from "../lib/message-mapper";
import { ALL_MEMORY_TYPE_KEYS } from "../components/chat/memory-config";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("event-handler");

export const toolCallNameMap: Record<string, string> = {};

export function buildTokenUsage(usage: Usage): { tokenUsage?: TokenUsage } {
  const result = extractTokenUsage(usage);
  return result ? { tokenUsage: result } : {};
}

export function handleAgentEvent(sessionId: string, event: AgentEvent) {
  const storeGet = () => useSessionStore.getState();

  if (event.type === "agent_start") {
    storeGet().updateSessionStatus(sessionId, "streaming");
    return;
  }

  if (event.type === "agent_end") {
    storeGet().updateSessionStatus(sessionId, "idle");
    const allSessions = storeGet().sessionsByProject;
    for (const sessList of Object.values(allSessions)) {
      const session = sessList.find((s) => s.sessionId === sessionId);
      if (session) {
        useMemoryStore.getState().loadFiles(session.projectPath, sessionId);
        break;
      }
    }
    notificationGateway.emit({
      type: "session_complete",
      sessionId,
      title: "会话完成",
      body: `会话 ${sessionId.slice(0, 8)}... 执行完毕`,
      level: "info",
    });
    return;
  }

  if (event.type === "compaction_start") {
    storeGet().updateSessionStatus(sessionId, "compacting");
    return;
  }

  if (event.type === "compaction_end") {
    log.info("compaction_end → force reload", { sessionId });
    const result = event.result as { tokensAfter?: number; tokensBefore?: number } | undefined;
    const tokensAfter = result?.tokensAfter;
    storeGet().updateSessionContext(sessionId, { tokens: tokensAfter ?? null });
    storeGet().updateSessionStatus(sessionId, "idle");
    useChatStore.getState().loadSessionMessages(sessionId, { force: true });
    return;
  }

  if (event.type === "auto_retry_start") {
    storeGet().updateSessionStatus(sessionId, "retrying");
    useRetryStore.getState().startRetry(sessionId, {
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      delayMs: event.delayMs,
      errorMessage: event.errorMessage,
    });
    notificationGateway.emit({
      type: "retry_start",
      sessionId,
      title: "自动重试",
      body: `第 ${event.attempt}/${event.maxAttempts} 次重试`,
      level: "warning",
    });
    return;
  }

  if (event.type === "auto_retry_end") {
    useRetryStore.getState().endRetry(sessionId);
    notificationGateway.emit({
      type: event.success ? "retry_success" : "retry_failed",
      sessionId,
      title: event.success ? "重试成功" : "重试失败",
      body: event.success ? "会话已恢复执行" : (event.finalError ?? "已达最大重试次数"),
      level: event.success ? "info" : "error",
    });
    const current = storeGet().sessionStatusMap[sessionId];
    if (current === "retrying") {
      storeGet().updateSessionStatus(sessionId, "streaming");
    }
    return;
  }

  if (event.type === "extension_ui_request") {
    if (event.method === "confirm" || event.method === "select" || event.method === "input") {
      storeGet().updateSessionStatus(sessionId, "permission");
      notificationGateway.emit({
        type: "permission_request",
        sessionId,
        title: "权限请求",
        body: "Agent 需要你的确认",
        level: "warning",
      });
    }
    return;
  }

  if (event.type === "message_start") {
    const raw = event.message;
    const msgObj = typeof raw === "object" && raw !== null ? raw : null;
    const role = msgObj && "role" in msgObj && typeof msgObj.role === "string" ? msgObj.role : "";

    if (role === "custom") {
      if (!msgObj) return;
      const customType = "customType" in msgObj && typeof msgObj.customType === "string" ? msgObj.customType : "unknown";

      const data = "details" in msgObj
        ? msgObj.details
        : "data" in msgObj
          ? msgObj.data
          : {};

      const chat = useChatStore.getState();
      const existing = chat.messagesBySession[sessionId] || [];
      const customMsg: ChatMessage = {
        id: `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "custom",
        content: [{ type: "custom", customType, data }],
        timestamp: Date.now(),
      };
      chat.setMessagesForSession(sessionId, [...existing, customMsg]);
      return;
    }

    if (role === "user") {
      const msg = messageToChatMessage(raw as Message);
      if (msg) {
        log.info("message_start user → adding to store", { sessionId });
        const chat = useChatStore.getState();
        const existing = chat.messagesBySession[sessionId] || [];
        const localIdx = existing.findIndex((m) => m.role === "user" && m._local);
        if (localIdx >= 0) {
          const updated = [...existing];
          updated[localIdx] = { ...msg };
          chat.setMessagesForSession(sessionId, updated);
        } else {
          chat.setMessagesForSession(sessionId, [...existing, msg]);
        }
      }
      return;
    }

    if (role !== "assistant") return;

    const msg = messageToChatMessage(raw as Message, undefined, toolCallNameMap);

    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    const lastMsg = existing[existing.length - 1];

    if (lastMsg && lastMsg.role === "assistant" && lastMsg.isStreaming === true) {
      const content = msg ? msg.content.map((b) => {
        if (b.type === "toolCall") {
          const args = typeof b.input === "string" ? b.input : b.input != null ? JSON.stringify(b.input, null, 2) : "";
          return { type: "toolExecution" as const, toolCallId: b.id, toolName: b.name, args, status: "running" as const };
        }
        return b;
      }) : lastMsg.content;
      chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), { ...lastMsg, content, isStreaming: true }]);
    } else if (msg) {
      msg.content = msg.content.map((b) => {
        if (b.type === "toolCall") {
          const args = typeof b.input === "string" ? b.input : b.input != null ? JSON.stringify(b.input, null, 2) : "";
          return { type: "toolExecution" as const, toolCallId: b.id, toolName: b.name, args, status: "running" as const };
        }
        return b;
      });
      chat.setMessagesForSession(sessionId, [...existing, { ...msg, isStreaming: true }]);
    } else {
      chat.setMessagesForSession(sessionId, [...existing, {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        role: "assistant",
        content: [],
        timestamp: Date.now(),
        isStreaming: true,
      }]);
    }
    return;
  }

  if (event.type === "message_update") {
    batchMessageUpdate(sessionId, () => {
      const chat = useChatStore.getState();
      const existing = chat.messagesBySession[sessionId] || [];
      const lastMsg = existing[existing.length - 1];

      const message = event.message as AssistantMessage;
      const incoming = message.content;
      if (!incoming || !Array.isArray(incoming)) return;

      if (!lastMsg || lastMsg.role !== "assistant" || !lastMsg.isStreaming) {
        const synthMsg: ChatMessage = {
          id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          role: "assistant",
          content: [],
          timestamp: Date.now(),
          isStreaming: true,
        };
        chat.setMessagesForSession(sessionId, [...existing, synthMsg]);
      }

      const currentMsgs = chat.messagesBySession[sessionId] || [];
      const currentLast = currentMsgs[currentMsgs.length - 1];

      const preservedToolExecs = (currentLast?.content || []).filter((b): b is Extract<ContentBlock, { type: "toolExecution" }> => b.type === "toolExecution");
      const execByCallId = new Map<string, Extract<ContentBlock, { type: "toolExecution" }>>();
      for (const exec of preservedToolExecs) {
        execByCallId.set(exec.toolCallId, exec);
      }
      const usedExecs = new Set<string>();

      const textBlocks: ContentBlock[] = [];
      const otherBlocks: ContentBlock[] = [];

      for (const block of incoming) {
        if (block.type === "toolCall" && block.id) {
          const exec = execByCallId.get(block.id);
          if (exec) {
            otherBlocks.push(exec);
            usedExecs.add(block.id);
          } else {
            const args = typeof block.arguments === "string"
              ? block.arguments
              : block.arguments != null ? JSON.stringify(block.arguments, null, 2) : "";
            const toolName = block.name;
            otherBlocks.push({
              type: "toolExecution",
              toolCallId: block.id,
              toolName,
              args,
              status: "running",
            });
            usedExecs.add(block.id);
          }
        } else if (block.type === "text") {
          textBlocks.push(block);
        } else if (block.type === "thinking") {
          otherBlocks.push(block);
        }
      }

      for (const exec of preservedToolExecs) {
        if (!usedExecs.has(exec.toolCallId)) {
          otherBlocks.push(exec);
        }
      }

      chat.setMessagesForSession(sessionId, [...currentMsgs.slice(0, -1), {
        ...currentLast,
        content: [...otherBlocks, ...textBlocks],
        ...buildTokenUsage(message.usage),
        ...(message.stopReason ? { stopReason: message.stopReason } : {}),
      }]);
      chat.incrementStreamVersion();
    });
    return;
  }

	if (event.type === "message_end") {
		const entryId = (event as { entryId?: string }).entryId;
		const message = event.message as Message;
		const role = message.role;

		if (role === "user" && entryId) {
			const chat = useChatStore.getState();
			const existing = chat.messagesBySession[sessionId] || [];
			const userMsg = existing.find((m) => m.role === "user" && !m.entryId);
			if (userMsg) {
				chat.setMessagesForSession(sessionId, existing.map((m) =>
					m.id === userMsg.id ? { ...m, entryId } : m
				));
			}
			return;
		}

		if (role !== "assistant") return;
		const chat = useChatStore.getState();
		const existing = chat.messagesBySession[sessionId] || [];
		const lastMsg = existing[existing.length - 1];
		if (!lastMsg || lastMsg.role !== "assistant") return;

		const assistantMsg = message as AssistantMessage;
		if (assistantMsg.usage) {
			const totalTokens = assistantMsg.usage.input + assistantMsg.usage.output + assistantMsg.usage.cacheRead + assistantMsg.usage.cacheWrite;
			if (totalTokens > 0) {
				storeGet().updateSessionContext(sessionId, { tokens: totalTokens });
			}
		}

		flushNow();

		const hasContent = lastMsg.content.some(
			(b) => (b.type === "text" && b.text.trim().length > 0)
				|| b.type === "thinking"
				|| b.type === "toolCall"
				|| b.type === "toolResult"
				|| b.type === "toolExecution"
				|| b.type === "custom",
		);

		if (!hasContent) {
			chat.setMessagesForSession(sessionId, existing.slice(0, -1));
			return;
		}

		chat.setMessagesForSession(sessionId, [...existing.slice(0, -1), {
			...lastMsg,
			isStreaming: false,
			stopReason: assistantMsg.stopReason ?? lastMsg.stopReason ?? null,
			provider: assistantMsg.api ?? lastMsg.provider,
			model: assistantMsg.model ?? lastMsg.model,
			...buildTokenUsage(assistantMsg.usage),
			entryId,
		}]);
		return;
	}

		if (event.type === "tool_execution_start" || event.type === "tool_execution_update") {
			const toolCallId = event.toolCallId;
			const toolName = event.toolName || "unknown";

			if (event.type === "tool_execution_start") {
					toolCallNameMap[toolCallId] = toolName;
			}

			type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;

			batchMessageUpdate(sessionId, () => {
				const chat = useChatStore.getState();
				const existing = chat.messagesBySession[sessionId] || [];
				const lastMsg = existing[existing.length - 1];
				if (!lastMsg || lastMsg.role !== "assistant") return;

				const blocks = [...lastMsg.content];
				const targetIdx = blocks.findIndex((b): b is ToolExecBlock =>
					b.type === "toolExecution" && b.toolCallId === toolCallId
				);

				if (event.type === "tool_execution_start") {
					const args = event.args;
					const argsStr = args && typeof args === "object" && "command" in args && typeof args.command === "string"
						? args.command
						: args ? JSON.stringify(args, null, 2) : "";
					if (targetIdx >= 0) {
						blocks[targetIdx] = { type: "toolExecution", toolCallId, toolName, args: argsStr, status: "running" };
					} else {
						blocks.push({ type: "toolExecution", toolCallId, toolName, args: argsStr, status: "running" });
					}
				} else if (event.type === "tool_execution_update") {
					const partial = event.partialResult as { content?: Array<{ type: string; text?: string }> } | undefined;
					let output = "";
					if (partial) {
						if (Array.isArray(partial.content)) {
							output = partial.content.map((c) => c.text ?? "").join("");
						}
					}
					if (targetIdx >= 0) {
						const prev = blocks[targetIdx] as ToolExecBlock;
						blocks[targetIdx] = { ...prev, output };
					}
				}

				const updated = [...existing];
				updated[existing.length - 1] = { ...lastMsg, content: blocks };
				chat.setMessagesForSession(sessionId, updated);
				chat.incrementStreamVersion();
			});
    return;
  }

  if (event.type === "tool_execution_end") {
    flushNow();
    const toolCallId = event.toolCallId;
    type ToolExecBlock = Extract<ContentBlock, { type: "toolExecution" }>;
    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];

    for (let i = existing.length - 1; i >= 0; i--) {
      const msg = existing[i];
      if (msg.role !== "assistant") continue;
      const blockIdx = msg.content.findIndex((b): b is ToolExecBlock =>
        b.type === "toolExecution" && b.toolCallId === toolCallId
      );
      if (blockIdx < 0) continue;

      const isError = event.isError;
      let output = "";
      const result = event.result as { content?: Array<{ type: string; text?: string }>; details?: unknown } | undefined;
      if (result) {
        if (Array.isArray(result.content)) {
          output = result.content.map((c) => c.text ?? "").join("");
        } else {
          output = JSON.stringify(result, null, 2);
        }
      }

      const blocks = [...msg.content];
      const prev = blocks[blockIdx] as ToolExecBlock;
      blocks[blockIdx] = { ...prev, status: isError ? "error" : "done", output, details: result?.details };

      const updated = [...existing];
      updated[i] = { ...msg, content: blocks };
      chat.setMessagesForSession(sessionId, updated);
      chat.incrementStreamVersion();
      return;
    }

    return;
  }

  if (event.type === "custom_entry") {
    if (!ALL_MEMORY_TYPE_KEYS.has(event.customType)) return;

    const memoryStore = useMemoryStore.getState();
    memoryStore.addEvent(sessionId, {
      id: event.id || `custom-${Date.now()}`,
      customType: event.customType,
      data: event.data,
      timestamp: Date.now(),
    });

    if (event.customType === "memory_prefetch_result") {
      const data = event.data as { summary?: string; snippet?: string } | undefined;
      if (data) {
        memoryStore.addInjected(sessionId, {
          summary: data.summary || "",
          snippet: data.snippet || "",
        });
      }
    }

    if (event.display === false) return;

    const chat = useChatStore.getState();
    const existing = chat.messagesBySession[sessionId] || [];
    const customMsg: ChatMessage = {
      id: event.id || `custom-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      role: "custom",
      content: [{ type: "custom", customType: event.customType, data: event.data }],
      timestamp: Date.now(),
    };
    chat.setMessagesForSession(sessionId, [...existing, customMsg]);

    return;
  }

  if (event.type === "session_rename") {
    const { newName } = event;
    useSessionStore.setState((s) => {
      const updated: Record<string, SessionMeta[]> = {};
      for (const [path, sessions] of Object.entries(s.sessionsByProject)) {
        updated[path] = sessions.map((sess) =>
          sess.sessionId === sessionId ? { ...sess, name: newName } : sess,
        );
      }
      return { sessionsByProject: updated };
    });
    return;
  }

  if (event.type === "queue_update") {
    useSessionStore.setState((s) => ({
      queueBySession: {
        ...s.queueBySession,
        [sessionId]: { steering: event.steering, followUp: event.followUp },
      },
    }));
    return;
  }
}

if (typeof window !== "undefined") {
  (window as unknown as Record<string, unknown>).__toolCallNameMap = toolCallNameMap;
}
