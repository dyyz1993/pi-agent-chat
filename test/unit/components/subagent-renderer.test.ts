/**
 * @vitest-environment happy-dom
 *
 * SubagentRenderer 进度提取测试
 *
 * 验证内容：
 * 1. handleSubagentEvent 将事件流正确转换为 messagesBySubsession
 * 2. 从 messagesBySubsession 提取的工具调用列表 + 最新消息摘要
 * 3. 各种状态（running/done/error）下的事件处理
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useSubagentStore, handleSubagentEvent } from "../../../src/mainview/stores/use-subagent-store";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";

// Mock apiClient
vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../src/mainview/stores/message-batcher", () => ({
  batchMessageUpdate: vi.fn((_id: string, fn: () => void) => fn()),
}));

vi.mock("../../../src/mainview/lib/message-mapper", () => ({
  messageToChatMessage: (msg: { id?: string; role: string; content: unknown[] }, entryId?: string) => ({
    id: msg.id ?? `msg-${Date.now()}`,
    role: msg.role,
    content: (msg.content ?? []) as never[],
    timestamp: Date.now(),
    entryId,
    isStreaming: true,
  }),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      sessionContextMap: {},
    })),
    subscribe: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/message-batcher", () => ({
  batchMessageUpdate: vi.fn((_id: string, fn: () => void) => fn()),
}));

const PARENT_SESSION_ID = "sess_parent_001";
const SUB_SESSION_ID = "sess_sub_test_001";
const PARENT_SESSION_PATH = "/fake/parent.jsonl";

function resetStore() {
  useSubagentStore.setState({
    subsessionsByParent: {},
    activeSubsessionId: null,
    messagesBySubsession: {},
    loadingByParent: {},
    subagentStatusMap: {},
    subagentContextMap: {},
  });
}

function seedSubagent() {
  useSubagentStore.getState().upsertLiveSubagent(PARENT_SESSION_PATH, SUB_SESSION_ID, {
    sessionId: SUB_SESSION_ID,
    sessionPath: "/fake/sub.jsonl",
    description: "Refactor module",
    instruction: "Refactor the auth module",
    startedAt: Date.now() - 5000,
    toolCallId: "tc-sub-001",
  });
}

describe("SubagentRenderer — 进度提取（store 层）", () => {
  beforeEach(() => {
    resetStore();
    seedSubagent();
  });

  afterEach(() => {
    resetStore();
  });

  it("subagent_start 事件设置 streaming 状态", () => {
    handleSubagentEvent(SUB_SESSION_ID, {
      type: "subagent_start",
      description: "Refactor module",
      instruction: "Refactor the auth module",
    } as AgentEvent, PARENT_SESSION_ID);

    expect(useSubagentStore.getState().subagentStatusMap[SUB_SESSION_ID]).toBe("streaming");
  });

  it("message_start → message_update → message_end 正确累积消息", () => {
    handleSubagentEvent(SUB_SESSION_ID, {
      type: "message_start",
      message: { id: "msg-1", role: "assistant", content: [] },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    handleSubagentEvent(SUB_SESSION_ID, {
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "Analyzing" }] },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    handleSubagentEvent(SUB_SESSION_ID, {
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: " files..." }] },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    const msgs = useSubagentStore.getState().messagesBySubsession[SUB_SESSION_ID];
    expect(msgs).toBeDefined();
    expect(msgs.length).toBe(1);
    expect(msgs[0].content.some((b: { type: string; text?: string }) => b.type === "text" && b.text === "Analyzing files...")).toBe(true);
  });

  it("tool_execution_start/end 添加工具调用到消息", () => {
    // 先有 message_start 才能附加工具
    handleSubagentEvent(SUB_SESSION_ID, {
      type: "message_start",
      message: { id: "msg-1", role: "assistant", content: [] },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    handleSubagentEvent(SUB_SESSION_ID, {
      type: "tool_execution_start",
      toolCallId: "tc-read-1",
      toolName: "read",
      args: { filePath: "src/auth.ts" },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    handleSubagentEvent(SUB_SESSION_ID, {
      type: "tool_execution_start",
      toolCallId: "tc-edit-1",
      toolName: "edit",
      args: { filePath: "src/auth.ts" },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    const msgs = useSubagentStore.getState().messagesBySubsession[SUB_SESSION_ID];
    const toolBlocks = msgs[0].content.filter((b: { type: string }) => b.type === "toolExecution");
    expect(toolBlocks.length).toBe(2);
    expect((toolBlocks[0] as { toolName: string }).toolName).toBe("read");
    expect((toolBlocks[1] as { toolName: string }).toolName).toBe("edit");
  });

  it("从 messagesBySubsession 能提取工具调用列表和最新消息摘要", () => {
    // 模拟完整事件流
    handleSubagentEvent(SUB_SESSION_ID, {
      type: "message_start",
      message: { id: "msg-1", role: "assistant", content: [] },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    handleSubagentEvent(SUB_SESSION_ID, {
      type: "tool_execution_start",
      toolCallId: "tc-read-1",
      toolName: "read",
      args: { filePath: "src/auth.ts" },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    handleSubagentEvent(SUB_SESSION_ID, {
      type: "tool_execution_end",
      toolCallId: "tc-read-1",
      toolName: "read",
      result: { content: [{ type: "text", text: "file contents" }] },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    handleSubagentEvent(SUB_SESSION_ID, {
      type: "message_update",
      message: { role: "assistant", content: [{ type: "text", text: "Found 3 issues in auth module" }] },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    handleSubagentEvent(SUB_SESSION_ID, {
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Found 3 issues in auth module" }],
        stopReason: "end_turn",
      },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    const msgs = useSubagentStore.getState().messagesBySubsession[SUB_SESSION_ID];

    // 提取工具调用
    const tools = msgs.flatMap((m: { content: Array<{ type: string; toolName?: string; status?: string }> }) =>
      m.content.filter((b) => b.type === "toolExecution"),
    );
    expect(tools.length).toBe(1);
    expect((tools[0] as { toolName: string }).toolName).toBe("read");
    expect((tools[0] as { status: string }).status).toBe("done");

    // 提取最新 assistant 文本
    let latestText = "";
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role !== "assistant") continue;
      const textBlock = msgs[i].content.find((b: { type: string }) => b.type === "text");
      if (textBlock && (textBlock as { text?: string }).text?.trim()) {
        latestText = (textBlock as { text: string }).text.trim();
        break;
      }
    }
    expect(latestText).toBe("Found 3 issues in auth module");
  });

  it("agent_end 事件标记子代理为已完成（exitCode=0）", () => {
    handleSubagentEvent(SUB_SESSION_ID, {
      type: "agent_end",
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    const sub = useSubagentStore.getState().subsessionsByParent[PARENT_SESSION_PATH]
      .find((s) => s.sessionId === SUB_SESSION_ID);
    expect(sub?.completedAt).toBeDefined();
    expect(sub?.exitCode).toBe(0);
    expect(useSubagentStore.getState().subagentStatusMap[SUB_SESSION_ID]).toBe("idle");
  });

  it("多个工具调用（5+）正确累积，供 SubagentProgress 组件截取前5个", () => {
    handleSubagentEvent(SUB_SESSION_ID, {
      type: "message_start",
      message: { id: "msg-1", role: "assistant", content: [] },
    } as unknown as AgentEvent, PARENT_SESSION_ID);

    // 添加 7 个工具调用
    for (let i = 0; i < 7; i++) {
      handleSubagentEvent(SUB_SESSION_ID, {
        type: "tool_execution_start",
        toolCallId: `tc-${i}`,
        toolName: `tool_${i}`,
        args: {},
      } as unknown as AgentEvent, PARENT_SESSION_ID);
    }

    const msgs = useSubagentStore.getState().messagesBySubsession[SUB_SESSION_ID];
    const tools = msgs[0].content.filter((b: { type: string }) => b.type === "toolExecution");
    expect(tools.length).toBe(7);

    // 模拟 SubagentProgress 的截取逻辑
    const visibleTools = tools.slice(0, 5);
    const remainingCount = tools.length - visibleTools.length;
    expect(visibleTools.length).toBe(5);
    expect(remainingCount).toBe(2);
  });
});
