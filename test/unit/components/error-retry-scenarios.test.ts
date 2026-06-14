/**
 * @vitest-environment happy-dom
 *
 * 场景3：错误 / 重试 / 网络中断
 *
 * 验证内容：
 * 1. 工具执行失败（status="error"）→ SideNav 图标变红
 * 2. 多个工具中部分失败 → 整条消息标红
 * 3. Hook 拒绝（hookDenial）→ 仍可正常渲染
 * 4. auto_retry store 生命周期：start → end → stale cleanup
 * 5. crash 时 running 工具被标记为 error
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { buildFlatItems } from "../../../src/mainview/components/chat/SideNav";
import { getToolIcon } from "../../../src/mainview/components/chat/tool-icon-map";
import { useRetryStore, clearRetrySession } from "../../../src/mainview/stores/use-retry-store";
import type { ChatMessage } from "../../../src/mainview/types";

function assistantWithTool(
  id: string,
  toolName: string,
  status: "done" | "error" | "running",
): ChatMessage {
  return {
    id,
    role: "assistant",
    content: [
      { type: "text", text: "running tool" },
      {
        type: "toolExecution",
        toolCallId: "tc-1",
        toolName,
        args: "{}",
        status,
        output: status === "error" ? "command failed" : "ok",
      },
    ],
    timestamp: 1,
  };
}

describe("Error scenario — SideNav error detection", () => {
  it("marks message red when toolExecution has status='error'", () => {
    const messages = [assistantWithTool("msg-1", "bash", "error")];
    const items = buildFlatItems(messages, false);

    // All items for this message should have error color
    const errorItems = items.filter((i) => i.color === "text-status-error");
    expect(errorItems.length).toBe(items.length);
  });

  it("marks entire message red when ANY tool fails", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          { type: "text", text: "step 1" },
          {
            type: "toolExecution",
            toolCallId: "tc-1",
            toolName: "bash",
            args: "{}",
            status: "done",
          },
          { type: "text", text: "step 2" },
          {
            type: "toolExecution",
            toolCallId: "tc-2",
            toolName: "write",
            args: "{}",
            status: "error",
            output: "permission denied",
          },
        ],
        timestamp: 1,
      },
    ];

    const items = buildFlatItems(messages, false);
    // Even the first tool (status=done) should be red because sibling failed
    const allRed = items.every((i) => i.color === "text-status-error");
    expect(allRed).toBe(true);
  });

  it("does NOT mark red when all tools succeed", () => {
    const messages = [assistantWithTool("msg-1", "bash", "done")];
    const items = buildFlatItems(messages, false);

    const errorItems = items.filter((i) => i.color === "text-status-error");
    expect(errorItems.length).toBe(0);
  });

  it("running tool (no result yet) is not marked as error", () => {
    const messages = [assistantWithTool("msg-1", "bash", "running")];
    const items = buildFlatItems(messages, false);

    const errorItems = items.filter((i) => i.color === "text-status-error");
    expect(errorItems.length).toBe(0);
  });
});

describe("Error scenario — tool icon mapping for error-related tools", () => {
  it("session_delegate_stop has error color", () => {
    const entry = getToolIcon("session_delegate_stop");
    expect(entry.color).toBe("text-status-error");
  });

  it("session_delegate_remove has error color", () => {
    const entry = getToolIcon("session_delegate_remove");
    expect(entry.color).toBe("text-status-error");
  });
});

describe("Error scenario — hook denial details", () => {
  it("toolExecution with hookDenial details renders without crash", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          {
            type: "toolExecution",
            toolCallId: "tc-1",
            toolName: "bash",
            args: '{"command":"rm -rf /"}',
            status: "error",
            output: "blocked by hook",
            details: {
              hookDenial: {
                reason: "Command blocked: dangerous",
                toolName: "bash",
                timestamp: Date.now(),
              },
            },
          },
        ],
        timestamp: 1,
      },
    ];

    // Should not crash
    const items = buildFlatItems(messages, false);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.color === "text-status-error")).toBe(true);
  });
});

describe("Retry store — lifecycle", () => {
  beforeEach(() => {
    useRetryStore.setState({ retryBySession: {} });
  });

  it("startRetry sets retry info for session", () => {
    useRetryStore.getState().startRetry("session-A", {
      attempt: 1,
      maxAttempts: 3,
      delayMs: 5000,
      errorMessage: "rate limit exceeded",
    });

    const info = useRetryStore.getState().retryBySession["session-A"];
    expect(info).toBeTruthy();
    expect(info!.attempt).toBe(1);
    expect(info!.maxAttempts).toBe(3);
    expect(info!.errorMessage).toBe("rate limit exceeded");
    expect(info!.startedAt).toBeGreaterThan(0);
  });

  it("endRetry removes retry info for session", () => {
    useRetryStore.getState().startRetry("session-A", {
      attempt: 1,
      maxAttempts: 3,
      delayMs: 100,
      errorMessage: "timeout",
    });

    useRetryStore.getState().endRetry("session-A");
    expect(useRetryStore.getState().retryBySession["session-A"]).toBeUndefined();
  });

  it("multiple sessions have independent retry state", () => {
    useRetryStore.getState().startRetry("session-A", {
      attempt: 1,
      maxAttempts: 3,
      delayMs: 5000,
      errorMessage: "error A",
    });
    useRetryStore.getState().startRetry("session-B", {
      attempt: 2,
      maxAttempts: 5,
      delayMs: 3000,
      errorMessage: "error B",
    });

    const infoA = useRetryStore.getState().retryBySession["session-A"];
    const infoB = useRetryStore.getState().retryBySession["session-B"];

    expect(infoA!.attempt).toBe(1);
    expect(infoB!.attempt).toBe(2);
    expect(infoA!.errorMessage).toBe("error A");
    expect(infoB!.errorMessage).toBe("error B");

    // End only A, B should remain
    useRetryStore.getState().endRetry("session-A");
    expect(useRetryStore.getState().retryBySession["session-A"]).toBeUndefined();
    expect(useRetryStore.getState().retryBySession["session-B"]).toBeTruthy();
  });

  it("endRetry on non-existent session is no-op", () => {
    // Should not throw
    useRetryStore.getState().endRetry("never-started");
    expect(Object.keys(useRetryStore.getState().retryBySession)).toHaveLength(0);
  });

  it("clearRetrySession clears both timer and store", () => {
    vi.useFakeTimers();

    useRetryStore.getState().startRetry("session-A", {
      attempt: 1,
      maxAttempts: 3,
      delayMs: 5000,
      errorMessage: "timeout",
    });

    clearRetrySession("session-A");
    expect(useRetryStore.getState().retryBySession["session-A"]).toBeUndefined();

    vi.useRealTimers();
  });

  it("stale cleanup auto-removes retry after timeout", () => {
    vi.useFakeTimers();

    useRetryStore.getState().startRetry("session-A", {
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1000,
      errorMessage: "timeout",
    });

    // Advance past stale timeout (delayMs + 30s or 120s, whichever is larger)
    vi.advanceTimersByTime(130_000);

    expect(useRetryStore.getState().retryBySession["session-A"]).toBeUndefined();
    vi.useRealTimers();
  });
});

describe("Crash scenario — running tools become error", () => {
  /**
   * When agent_end fires with crashReason, agent-event-handler.ts (line 418)
   * sets fallbackToolStatus = "error" and calls closeRunningToolExecutions
   * to close all running toolExecution blocks.
   *
   * This test simulates the resulting message state.
   */

  it("crashed tool gets error status in SideNav", () => {
    // Simulate post-crash state: tool was "running" but now set to "error"
    const messages = [assistantWithTool("msg-1", "bash", "error")];
    const items = buildFlatItems(messages, false);

    expect(items.every((i) => i.color === "text-status-error")).toBe(true);
  });

  it("multiple running tools all become error after crash", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-1",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "thinking..." },
          { type: "text", text: "running parallel tasks" },
          {
            type: "toolExecution",
            toolCallId: "tc-1",
            toolName: "bash",
            args: "{}",
            status: "error",
            output: "agent crashed",
          },
          {
            type: "toolExecution",
            toolCallId: "tc-2",
            toolName: "read",
            args: "{}",
            status: "error",
            output: "agent crashed",
          },
        ],
        timestamp: 1,
      },
    ];

    const items = buildFlatItems(messages, true);
    expect(items.every((i) => i.color === "text-status-error")).toBe(true);
  });
});
