/**
 * @vitest-environment happy-dom
 *
 * 场景4：Coordinator 子任务场景
 *
 * 验证内容：
 * 1. 各种 coordinator 工具（delegate/fork/status/stop/remove/clear）在 SideNav 中有正确图标
 * 2. coordinator details 结构解析（sessionId/status/task/title）
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
  it("delegate tool produces correct nav item", () => {
    const messages = [assistantWithTools("msg-1", [{ name: "session_delegate", status: "done" }])];
    const items = buildFlatItems(messages, false);

    // Should have: Bot icon + text block + delegate tool = 3 items
    expect(items.length).toBe(3);
    const toolItem = items.find((i) => i.icon.displayName === "UserPlus");
    expect(toolItem).toBeTruthy();
  });

  it("multiple coordinator tools in same message", () => {
    const messages = [
      assistantWithTools("msg-1", [
        { name: "session_delegate", status: "done" },
        { name: "session_delegate_status", status: "done" },
        { name: "session_delegate_stop", status: "done" },
      ]),
    ];
    const items = buildFlatItems(messages, false);

    // Bot + text + 3 tools = 5
    expect(items.length).toBe(5);

    const icons = items.map((i) => i.icon.displayName);
    expect(icons).toContain("UserPlus");
    expect(icons).toContain("Activity");
    expect(icons).toContain("OctagonPause");
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

    // But icons should still be distinct
    const icons = items.map((i) => i.icon.displayName);
    expect(icons).toContain("Eye"); // read
    expect(icons).toContain("UserPlus"); // delegate
    expect(icons).toContain("Terminal"); // bash
  });

  it("fork then delegate sequence", () => {
    const messages: ChatMessage[] = [
      assistantWithTools("msg-1", [{ name: "session_delegate_fork", status: "done" }]),
      assistantWithTools("msg-2", [{ name: "session_delegate", status: "done" }]),
      assistantWithTools("msg-3", [{ name: "session_delegate_status", status: "done" }]),
    ];

    const items = buildFlatItems(messages, false);

    // Each message: Bot + text + 1 tool = 3 items × 3 messages = 9
    expect(items.length).toBe(9);

    // Verify fork comes before delegate before status
    const iconNames = items.map((i) => i.icon.displayName);
    const forkIdx = iconNames.indexOf("GitFork");
    const delegateIdx = iconNames.indexOf("UserPlus");
    const statusIdx = iconNames.indexOf("Activity");

    expect(forkIdx).toBeLessThan(delegateIdx);
    expect(delegateIdx).toBeLessThan(statusIdx);
  });
});
