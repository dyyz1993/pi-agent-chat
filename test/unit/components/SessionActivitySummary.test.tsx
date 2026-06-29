/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ChatMessage } from "../../../src/mainview/types";
import {
  SessionActivitySummary,
  buildActivityRoundsFromMessages,
  type SessionActivityLabels,
} from "../../../src/mainview/components/chat/tool-renderers/SessionActivitySummary";

const labels: SessionActivityLabels = {
  running: "Running",
  completed: "Completed",
  error: "Error",
  pending: "Waiting",
  thinking: "Thinking",
};

afterEach(() => {
  cleanup();
});

describe("SessionActivitySummary", () => {
  it("shows the latest content line and inline deduped tool names", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-1",
        role: "assistant",
        timestamp: Date.now(),
        content: [
          { type: "text", text: "子会话已启动，准备执行任务..." },
          { type: "text", text: "让我先检查当前项目目录结构，然后创建临时文件。" },
          {
            type: "toolExecution",
            toolCallId: "tool-1",
            toolName: "ls",
            args: "",
            status: "done",
          },
          {
            type: "toolExecution",
            toolCallId: "tool-2",
            toolName: "ls",
            args: "",
            status: "done",
          },
          {
            type: "toolExecution",
            toolCallId: "tool-3",
            toolName: "bash",
            args: "",
            status: "running",
          },
        ],
      },
    ];

    const rounds = buildActivityRoundsFromMessages(messages, labels);
    const { container } = render(
      <SessionActivitySummary title="运行摘要" rounds={rounds} live={false} labels={labels} />,
    );

    expect(screen.getByText("让我先检查当前项目目录结构，然后创建临时文件。")).toBeInTheDocument();
    expect(screen.getByText("ls · bash")).toBeInTheDocument();
    expect(container.querySelector("details")).toBeNull();
  });

  it("collapses many tool names into a single inline badge with overflow count", () => {
    const rounds = buildActivityRoundsFromMessages(
      [
        {
          id: "msg-2",
          role: "assistant",
          timestamp: Date.now(),
          content: [
            { type: "text", text: "Done" },
            ...Array.from({ length: 8 }, (_, index) => ({
              type: "toolExecution" as const,
              toolCallId: `tool-${index}`,
              toolName: `tool_${index}`,
              args: "",
              status: "done" as const,
            })),
          ],
        },
      ],
      labels,
    );

    render(<SessionActivitySummary title="运行摘要" rounds={rounds} live={false} labels={labels} />);

    expect(screen.getByText("tool_0 · tool_1 · tool_2 +5")).toBeInTheDocument();
  });

  it("forces lingering streaming rounds into completed state after the session has ended", () => {
    const rounds = buildActivityRoundsFromMessages(
      [
        {
          id: "msg-terminal",
          role: "assistant",
          timestamp: Date.now(),
          isStreaming: true,
          content: [
            { type: "text", text: "已经拿到最终结果" },
            {
              type: "toolExecution",
              toolCallId: "tool-terminal",
              toolName: "bash",
              args: "",
              status: "running",
            },
          ],
        },
      ],
      labels,
      undefined,
      { forceTerminal: true },
    );

    expect(rounds).toHaveLength(1);
    expect(rounds[0].status).toBe("done");
    expect(rounds[0].tools[0]?.status).toBe("done");
  });

  it("collapses repeated streaming fragments to the most informative sentence", () => {
    const rounds = buildActivityRoundsFromMessages(
      [
        {
          id: "msg-repeat",
          role: "assistant",
          timestamp: Date.now(),
          content: [
            {
              type: "text",
              text:
                "子会话已启动，准备执行任务... 让我先检查当前项目目录结构，然后创建临时文件。 子会话已启动，准备执行任务...",
            },
            {
              type: "toolExecution",
              toolCallId: "tool-repeat",
              toolName: "ls",
              args: "",
              status: "running",
            },
          ],
        },
      ],
      labels,
    );

    expect(rounds).toHaveLength(1);
    expect(rounds[0].summary).toBe("让我先检查当前项目目录结构，然后创建临时文件。");
  });
});
