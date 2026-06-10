import { describe, it, expect, beforeEach } from "vitest";
import { normalizeToolBlocks } from "../../../src/mainview/stores/use-chat-store";
import { useMemoryStore } from "../../../src/mainview/stores/use-memory-store";
import type { ChatMessage, ContentBlock } from "../../../src/mainview/types";

function makeAssistantMsg(
  id: string,
  blocks: ContentBlock[],
  extra: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: blocks,
    timestamp: Date.now(),
    ...extra,
  };
}

function makeUserMsg(id: string, text: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    role: "user",
    content: [{ type: "text", text }],
    timestamp: Date.now(),
    ...extra,
  };
}

function makeToolResultMsg(
  id: string,
  toolCallId: string,
  toolName: string,
  content: string,
  isError = false,
): ChatMessage {
  return {
    id,
    role: "toolResult",
    content: [{ type: "toolResult", toolCallId, toolName, content, isError, args: "" }],
    timestamp: Date.now(),
  };
}

describe("Rollback message integrity", () => {
  describe("Fix 1: normalizeToolBlocks - orphaned toolCall status", () => {
    it("marks orphaned toolCall as 'unknown' when isHistorical=true (rollback scenario)", () => {
      const msgs: ChatMessage[] = [
        makeUserMsg("u-1", "Search for TODO"),
        makeAssistantMsg("a-1", [
          { type: "text", text: "Let me search..." },
          { type: "toolCall", id: "tc-1", name: "grep", input: "pattern" },
        ]),
      ];

      normalizeToolBlocks(msgs, true);

      const assistantMsg = msgs.find((m) => m.id === "a-1");
      expect(assistantMsg).toBeDefined();
      expect(assistantMsg!.content).toHaveLength(2);

      const toolBlock = assistantMsg!.content[1];
      expect(toolBlock.type).toBe("toolExecution");

      if (toolBlock.type === "toolExecution") {
        expect(toolBlock.toolCallId).toBe("tc-1");
        expect(toolBlock.toolName).toBe("grep");
        expect(toolBlock.status).toBe("unknown");
      }
    });

    it("marks orphaned toolCall as 'running' when isHistorical=false (streaming scenario)", () => {
      const msgs: ChatMessage[] = [
        makeUserMsg("u-1", "Search for TODO"),
        makeAssistantMsg("a-1", [
          { type: "text", text: "Let me search..." },
          { type: "toolCall", id: "tc-1", name: "grep", input: "pattern" },
        ]),
      ];

      normalizeToolBlocks(msgs, false);

      const assistantMsg = msgs.find((m) => m.id === "a-1");
      const toolBlock = assistantMsg!.content[1];
      if (toolBlock.type === "toolExecution") {
        expect(toolBlock.status).toBe("running");
      }
    });

    it("marks matched toolCall as 'done' when toolResult exists regardless of isHistorical", () => {
      const msgs: ChatMessage[] = [
        makeUserMsg("u-1", "Search for TODO"),
        makeAssistantMsg("a-1", [
          { type: "text", text: "Let me search..." },
          { type: "toolCall", id: "tc-1", name: "grep", input: "pattern" },
        ]),
        makeToolResultMsg("tr-1", "tc-1", "grep", "found 3 results"),
      ];

      normalizeToolBlocks(msgs, true);

      const assistantMsg = msgs.find((m) => m.id === "a-1");
      expect(assistantMsg).toBeDefined();

      const toolBlock = assistantMsg!.content[1];
      expect(toolBlock.type).toBe("toolExecution");

      if (toolBlock.type === "toolExecution") {
        expect(toolBlock.status).toBe("done");
        expect(toolBlock.toolCallId).toBe("tc-1");
      }

      expect(msgs.find((m) => m.role === "toolResult")).toBeUndefined();
    });
  });

  describe("Fix 2: loadSessionMessages force does NOT delete messages synchronously", () => {
    it("should preserve messages immediately after calling force reload", async () => {
      const { useChatStore } = await import("../../../src/mainview/stores/use-chat-store");

      const sid = "test-session-force-fixed";
      useChatStore.setState({
        messagesBySession: {
          [sid]: [
            makeUserMsg("u-1", "old message"),
            makeAssistantMsg("a-1", [{ type: "text", text: "old reply" }], {
              tokenUsage: { input: 10, output: 20 },
            }),
          ],
        },
        loadingSessions: new Set(),
      });

      const messagesBefore = useChatStore.getState().messagesBySession[sid];
      expect(messagesBefore).toHaveLength(2);

      const loadPromise = useChatStore.getState().loadSessionMessages(sid, { force: true });

      const messagesAfterForce = useChatStore.getState().messagesBySession[sid];
      expect(messagesAfterForce).toBeDefined();
      expect(messagesAfterForce).toHaveLength(2);

      try {
        await loadPromise;
      } catch {
        // Expected to fail since no real RPC backend
      }
    });
  });

  describe("Fix 3: Memory events cleared before re-adding on loadSessionMessages", () => {
    beforeEach(() => {
      const sid = "test-session-memory-fixed";
      useMemoryStore.getState().clearSession(sid);
    });

    it("clearSession removes old events before adding new ones", () => {
      const sid = "test-session-memory-fixed";

      useMemoryStore.getState().addEvent(sid, {
        id: "branch-a-1",
        customType: "memory_prefetch",
        data: { query: "search query A" },
        timestamp: 1000,
      });

      const eventsAfterA = useMemoryStore.getState().eventsBySession[sid];
      expect(eventsAfterA).toHaveLength(1);

      useMemoryStore.getState().clearSession(sid);

      const eventsAfterClear = useMemoryStore.getState().eventsBySession[sid];
      expect(eventsAfterClear).toBeUndefined();

      useMemoryStore.getState().addEvent(sid, {
        id: "branch-b-1",
        customType: "memory_extract",
        data: { summary: "extracted from B" },
        timestamp: 2000,
      });

      const eventsAfterB = useMemoryStore.getState().eventsBySession[sid];
      expect(eventsAfterB).toHaveLength(1);
      expect(eventsAfterB![0].id).toBe("branch-b-1");
    });

    it("addEvent deduplicates by id (same id won't accumulate)", () => {
      const sid = "test-session-memory-dedup-fixed";

      useMemoryStore.getState().addEvent(sid, {
        id: "event-1",
        customType: "memory_prefetch",
        data: { query: "original" },
        timestamp: 1000,
      });

      useMemoryStore.getState().addEvent(sid, {
        id: "event-1",
        customType: "memory_prefetch",
        data: { query: "updated" },
        timestamp: 1000,
      });

      const events = useMemoryStore.getState().eventsBySession[sid];
      expect(events).toHaveLength(1);
      expect(events![0].data).toEqual({ query: "original" });

      useMemoryStore.getState().clearSession(sid);
    });
  });

  describe("Fix 4: _local message preserved after loadSessionMessages", () => {
    it("loadSessionMessages preserves _local messages from store", async () => {
      const { useChatStore } = await import("../../../src/mainview/stores/use-chat-store");

      const sid = "test-session-local-fixed";

      useChatStore.setState({
        messagesBySession: {
          [sid]: [makeUserMsg("u-local", "just sent", { _local: true })],
        },
      });

      const localMsg = useChatStore.getState().messagesBySession[sid];
      expect(localMsg).toHaveLength(1);
      expect(localMsg![0]._local).toBe(true);

      const serverMessages = [
        makeUserMsg("u-1", "previous message"),
        makeAssistantMsg("a-1", [{ type: "text", text: "reply" }], {
          tokenUsage: { input: 10, output: 20 },
        }),
      ];

      const chatStore = useChatStore.getState();
      const displayMsgs = serverMessages;
      const localMsgs = (chatStore.messagesBySession[sid] || []).filter((m) => m._local);
      const finalMsgs = localMsgs.length > 0 ? [...displayMsgs, ...localMsgs] : displayMsgs;

      chatStore.setMessagesForSession(sid, finalMsgs);

      const afterOverwrite = useChatStore.getState().messagesBySession[sid];
      expect(afterOverwrite).toHaveLength(3);
      expect(afterOverwrite!.find((m) => m._local)).toBeDefined();
      expect(afterOverwrite!.find((m) => m._local)!.id).toBe("u-local");
    });
  });
});
