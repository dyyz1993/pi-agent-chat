/**
 * @vitest-environment happy-dom
 *
 * 场景4：Coordinator 子任务场景
 *
 * 验证内容：
 * 1. 各种 coordinator 工具（delegate/fork/status/stop/remove/clear）有正确图标映射
 * 2. SideNav 主轴保持消息级粒度，不把工具块混入滚动导航
 * 3. 子任务工具在消息列表中的渲染不崩溃
 * 4. 混合场景：正常工具 + coordinator 工具在同一条消息中
 * 5. subagent 工具的特殊颜色
 */
import { describe, it, expect } from "vitest";
import { buildFlatItems } from "../../../src/mainview/components/chat/SideNav";
import { getToolIcon } from "../../../src/mainview/components/chat/tool-icon-map";
import { buildProcessedMessages } from "../../../src/mainview/components/chat/MessageListView";
import type { ChatMessage, ContentBlock } from "../../../src/mainview/types";

function assistantWithTools(id: string, tools: Array<{ name: string; status: string; details?: unknown }>): ChatMessage {
  const content: ContentBlock[] = [{ type: "text", text: "working" }];
  for (const t of tools) {
    content.push({
      type: "toolExecution",
      toolCallId: `tc-${t.name}-${Math.random()}`,
      toolName: t.name,
      args: "{}",
      status: t.status as "done" | "error" | "running",
      output: "result",
      details: t.details,
    });
  }
  return { id, role: "assistant", content, timestamp: 1 };
}

describe("Coordinator — tool icon mapping", () => {
  it("session_delegate → UserPlus icon + semantic-agent color", () => {
    const entry = getToolIcon("session_delegate");
    expect(entry.icon.displayName).toBe("UserPlus");
    expect(entry.color).toBe("text-semantic-agent");
  });

  it("session_delegate_fork → GitFork icon", () => {
    const entry = getToolIcon("session_delegate_fork");
    expect(entry.icon.displayName).toBe("GitFork");
  });

  it("session_delegate_status → Activity icon", () => {
    const entry = getToolIcon("session_delegate_status");
    expect(entry.icon.displayName).toBe("Activity");
  });

  it("session_delegate_send → Send icon", () => {
    const entry = getToolIcon("session_delegate_send");
    expect(entry.icon.displayName).toBe("Send");
  });

  it("session_delegate_stop → OctagonPause icon + error color", () => {
    const entry = getToolIcon("session_delegate_stop");
    expect(entry.icon.displayName).toBe("OctagonPause");
    expect(entry.color).toBe("text-status-error");
  });

  it("session_delegate_remove → Trash2 icon + error color", () => {
    const entry = getToolIcon("session_delegate_remove");
    expect(entry.icon.displayName).toBe("Trash2");
    expect(entry.color).toBe("text-status-error");
  });

  it("session_delegate_clear → Eraser icon", () => {
    const entry = getToolIcon("session_delegate_clear");
    expect(entry.icon.displayName).toBe("Eraser");
  });

  it("subagent → Bot icon + semantic-agent color", () => {
    const entry = getToolIcon("subagent");
    expect(entry.icon.displayName).toBe("Bot");
    expect(entry.color).toBe("text-semantic-agent");
  });
});

describe("Coordinator — SideNav rendering with coordinator tools", () => {
  it("delegate tool produces a message item plus delegate block item", () => {
    const messages = [assistantWithTools("msg-1", [{ name: "session_delegate", status: "done" }])];
    const items = buildFlatItems(messages, false);

    expect(items).toHaveLength(3);
    expect(items[0].navId).toBe("msg-1");
    expect(items[0].blockId).toBeUndefined();
    expect(items[2].blockId).toBe("msg-1-1");
    expect(items[2].icon.displayName).toBe("UserPlus");
  });

  it("multiple coordinator tools in same message are flattened as distinct block nav items", () => {
    const messages = [
      assistantWithTools("msg-1", [
        { name: "session_delegate", status: "done" },
        { name: "session_delegate_status", status: "done" },
        { name: "session_delegate_stop", status: "done" },
      ]),
    ];
    const items = buildFlatItems(messages, false);

    expect(items).toHaveLength(5);
    expect(items.map((item) => item.blockId).filter(Boolean)).toEqual([
      "msg-1-0",
      "msg-1-1",
      "msg-1-2",
      "msg-1-3",
    ]);
  });

  it("coordinator tool with details (sessionId, task) renders without crash", () => {
    const messages = [
      assistantWithTools("msg-1", [
        {
          name: "session_delegate",
          status: "done",
          details: {
            sessionId: "child-session-123",
            status: "completed",
            task: "refactor auth module",
            title: "Refactor Task",
            dispatchedBy: "main-agent",
          },
        },
      ]),
    ];

    const items = buildFlatItems(messages, false);
    expect(items.length).toBeGreaterThan(0);
  });
});

describe("Coordinator — message list processing", () => {
  it("coordinator messages are not filtered by showMemoryEntries", () => {
    const messages = [
      assistantWithTools("msg-1", [{ name: "session_delegate", status: "done" }]),
    ];

    const processed = buildProcessedMessages(messages, false);
    expect(processed.length).toBe(1);
    expect(processed[0].msg.id).toBe("msg-1");
  });
});

describe("Coordinator — mixed scenario (normal + coordinator + error)", () => {
  it("message with normal tools + coordinator tools + one error", () => {
    const messages = [
      assistantWithTools("msg-1", [
        { name: "read", status: "done" },
        { name: "session_delegate", status: "done" },
        { name: "bash", status: "error" },
      ]),
    ];

    const items = buildFlatItems(messages, false);

    // All items should be red (because bash failed)
    expect(items.every((i) => i.color === "text-status-error")).toBe(true);

    expect(items).toHaveLength(5);
    expect(items[0].navId).toBe("msg-1");
  });

  it("fork then delegate sequence", () => {
    const messages: ChatMessage[] = [
      assistantWithTools("msg-1", [{ name: "session_delegate_fork", status: "done" }]),
      assistantWithTools("msg-2", [{ name: "session_delegate", status: "done" }]),
      assistantWithTools("msg-3", [{ name: "session_delegate_status", status: "done" }]),
    ];

    const items = buildFlatItems(messages, false);

    expect(items).toHaveLength(9);
    expect(items.filter((item) => !item.blockId).map((item) => item.navId)).toEqual([
      "msg-1",
      "msg-2",
      "msg-3",
    ]);
    expect(items.filter((item) => item.blockId && item.icon.displayName === "GitFork")).toHaveLength(1);
    expect(items.filter((item) => item.blockId && item.icon.displayName === "UserPlus")).toHaveLength(1);
    expect(items.filter((item) => item.blockId && item.icon.displayName === "Activity")).toHaveLength(1);
  });
});
