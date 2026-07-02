/**
 * @vitest-environment happy-dom
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageCard } from "../../../src/mainview/components/chat/MessageCard";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useTurnStore } from "../../../src/mainview/stores/use-turn-store";
import type { ChatMessage } from "../../../src/mainview/types";

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

afterEach(() => {
  cleanup();
  useSessionStore.setState({ activeSessionId: null });
  useTurnStore.setState({
    selectedMessageIdsBySession: {},
    collapsedMessageIdsBySession: {},
    isMultiSelectModeBySession: {},
    selectedNavIdBySession: {},
    navAnchorBySession: {},
  });
});

describe("MessageCard stop boundary rendering", () => {
  it("does not render role error with stopReason stop as a red error card", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const message: ChatMessage = {
      id: "msg-stop-boundary",
      role: "error",
      content: [{ type: "text", text: "Memory loaded. Continue with the next step." }],
      timestamp: Date.now(),
      stopReason: "stop",
    };

    const { container } = render(<MessageCard message={message} />);

    expect(screen.getByText("Memory loaded. Continue with the next step.")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("bg-status-error");
    expect(container.innerHTML).not.toContain("text-status-error");
  });

  it("shows a useful collapsed preview for bash background process entries", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    useTurnStore.setState({
      collapsedMessageIdsBySession: {
        "sess-1": new Set(["msg-bash-bg"]),
      },
    });
    const message: ChatMessage = {
      id: "msg-bash-bg",
      role: "custom",
      content: [
        {
          type: "custom",
          customType: "bash_background_process",
          data: {
            command: "/tmp/cumulative_sum_test.sh",
            reason: "exit_zero",
            status: "done",
            backgroundTrigger: "auto",
            duration: "1m0s",
            exitCode: 0,
          },
        },
      ],
      timestamp: Date.now(),
    };

    render(<MessageCard message={message} />);

    expect(screen.getByText(/正常退出/)).toBeInTheDocument();
    expect(screen.getByText(/自动后台/)).toBeInTheDocument();
    expect(screen.getByText(/cumulative_sum_test/)).toBeInTheDocument();
    expect(screen.queryByText("emptyTurn")).not.toBeInTheDocument();
  });

  it("shows bash background process details when the message is expanded", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const message: ChatMessage = {
      id: "msg-bash-bg-expanded",
      role: "custom",
      content: [
        {
          type: "custom",
          customType: "bash_background_process",
          data: {
            bashId: "bash-fabe60",
            toolCallId: "tool-123",
            command: "/tmp/cumulative_sum_test.sh",
            cwd: "/tmp/project",
            pid: 58809,
            reason: "exit_zero",
            status: "done",
            backgroundTrigger: "auto",
            duration: "1m0s",
            exitCode: 0,
            logPath: "/tmp/pi-bash-fabe60.log",
          },
        },
      ],
      timestamp: Date.now(),
    };

    render(<MessageCard message={message} />);

    expect(screen.getByText("命令")).toBeInTheDocument();
    expect(screen.getByText("工作目录")).toBeInTheDocument();
    expect(screen.getByText("Bash ID")).toBeInTheDocument();
    expect(screen.getByText("进程 ID")).toBeInTheDocument();
    expect(screen.getByText("退出码")).toBeInTheDocument();
    expect(screen.getByText("日志")).toBeInTheDocument();
    expect(screen.getByText("/tmp/cumulative_sum_test.sh")).toBeInTheDocument();
    expect(screen.getByText("/tmp/project")).toBeInTheDocument();
    expect(screen.getByText("bash-fabe60")).toBeInTheDocument();
  });

  it("uses tool execution details for collapsed assistant previews", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    useTurnStore.setState({
      collapsedMessageIdsBySession: {
        "sess-1": new Set(["msg-tool-only"]),
      },
    });
    const message: ChatMessage = {
      id: "msg-tool-only",
      role: "assistant",
      content: [
        {
          type: "toolExecution",
          toolCallId: "tool-1",
          toolName: "bash",
          args: "cat /tmp/pi-bash-fabe60.log",
          status: "done",
          description: "查看完整的后台进程输出",
          output: "开始累加测试...",
        },
      ],
      timestamp: Date.now(),
    };

    render(<MessageCard message={message} />);

    expect(screen.getByText("查看完整的后台进程输出")).toBeInTheDocument();
    expect(screen.queryByText("emptyTurn")).not.toBeInTheDocument();
  });

  it("places user collapse controls before the user label and collapses the prompt", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const message: ChatMessage = {
      id: "msg-user-long",
      role: "user",
      content: [
        { type: "text", text: "这是一个很长的用户消息，用来确认用户消息本身也可以被折叠。" },
      ],
      timestamp: Date.now(),
    };

    const { container } = render(<MessageCard message={message} />);

    const collapseButton = screen.getByRole("button", { name: "collapse" });
    const label = screen.getByText("messageCard.you");
    expect(
      collapseButton.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(collapseButton);

    expect(screen.getByText(/这是一个很长的用户消息/)).toBeInTheDocument();
    expect(container.querySelector('[aria-label="expand"]')).toBeInTheDocument();
  });

  it("places assistant collapse controls after the assistant label", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const message: ChatMessage = {
      id: "msg-assistant",
      role: "assistant",
      content: [{ type: "text", text: "助手回复内容" }],
      timestamp: Date.now(),
    };

    render(<MessageCard message={message} />);

    const label = screen.getByText("messageCard.assistant");
    const collapseButton = screen.getByRole("button", { name: "collapse" });
    expect(
      label.compareDocumentPosition(collapseButton) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("places custom tool-entry collapse controls before the entry label", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const message: ChatMessage = {
      id: "msg-bash-bg-entry",
      role: "custom",
      content: [
        {
          type: "custom",
          customType: "bash_background_process",
          data: {
            command: "/tmp/cumulative_sum_test.sh",
            reason: "exit_zero",
            status: "done",
            backgroundTrigger: "auto",
            duration: "1m0s",
            exitCode: 0,
          },
        },
      ],
      timestamp: Date.now(),
    };

    render(<MessageCard message={message} />);

    const collapseButton = screen.getByRole("button", { name: "collapse" });
    const label = screen.getByText("Background Process");
    expect(
      collapseButton.compareDocumentPosition(label) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders supervisor continue custom entries with expandable details", () => {
    useSessionStore.setState({ activeSessionId: "sess-1" });
    const message: ChatMessage = {
      id: "msg-supervisor-continue",
      role: "custom",
      content: [
        {
          type: "custom",
          customType: "supervisor_continue",
          data: "Guard check: remaining work detected. Continue with unfinished verification steps.",
        },
      ],
      timestamp: Date.now(),
    };

    render(<MessageCard message={message} />);

    expect(screen.getByText("Supervisor Continue")).toBeInTheDocument();
    expect(screen.getByText(/Guard check: remaining work detected/)).toBeInTheDocument();

    const toggle = screen.getByRole("button", { name: "Supervisor Continue" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getAllByText(/Continue with unfinished verification steps/)).toHaveLength(2);
  });
});
