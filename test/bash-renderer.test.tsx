import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, act, fireEvent } from "@testing-library/react";
import type { ContentBlock } from "../src/mainview/types";
import type { BashProcess } from "../src/shared/modules/bash";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

const mockCall = vi.fn();
let mockBashProcess: BashProcess | undefined = undefined;

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("react-dom", () => ({
  createPortal: (children: React.ReactNode) => children,
}));

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: mockCall,
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: () => {},
  },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { activeSessionId: "test-session" };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ activeSessionId: "test-session" }) },
  ),
}));

vi.mock("../src/mainview/stores/use-bash-store", () => ({
  useBashStore: (selector: (s: Record<string, unknown>) => unknown) => {
    const state = {
      processesBySession: {
        "test-session": mockBashProcess ? [mockBashProcess] : [],
      },
      subscribedOutputs: new Set(),
      backgroundedIds: new Set(),
    };
    return selector(state);
  },
}));

vi.mock("../src/mainview/components/chat/primitives/AnsiText", () => ({
  AnsiText: ({ content }: { content: string }) => <div data-testid="ansi-text">{content}</div>,
}));

vi.mock("../src/mainview/components/bash-panel/BashPanel", () => ({
  BashProcessCard: () => <div data-testid="bash-process-card" />,
  LogViewer: ({
    logPath,
    toolCallId,
    onClose,
  }: {
    logPath: string;
    toolCallId: string;
    onClose: () => void;
  }) => (
    <div data-testid="log-viewer">
      <span data-testid="log-path">{logPath}</span>
      <span data-testid="log-toolcall">{toolCallId}</span>
      <button data-testid="log-close" onClick={onClose}>
        close
      </button>
    </div>
  ),
}));

vi.mock("../src/shared/lib/json-to-yaml", () => ({
  tryFormatAsYaml: (input: string) => input,
}));

import { BashExecutionCard } from "../src/mainview/components/chat/tool-renderers/BashRenderer";

function makeBlock(overrides: Partial<Block> = {}): Block {
  return {
    type: "toolExecution",
    toolCallId: "tc-1",
    toolName: "bash",
    status: "running",
    output: "hello world",
    startedAt: Date.now() - 1000,
    args: 'command: "ls -la"',
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00Z") });
  mockBashProcess = undefined;
  mockCall.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BashExecutionCard state rendering", () => {
  it("running state — blue border, Kill button, no View Output", () => {
    const block = makeBlock({ startedAt: Date.now() - 1000 });
    const { container } = render(<BashExecutionCard block={block} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("border-blue-500");
    expect(wrapper.textContent).toContain("common:cancel");
    expect(wrapper.textContent).not.toContain("bash.viewOutput");
  });

  it("background state via store — yellow border, backgroundRunning text, View Output button", () => {
    mockBashProcess = {
      toolCallId: "tc-1",
      command: "sleep 10",
      cwd: "/tmp",
      pid: 123,
      startedAt: Date.now() - 5000,
      output: "",
      status: "background",
      logPath: "/tmp/bash.log",
    };
    const block = makeBlock({ startedAt: Date.now() - 5000 });
    const { container } = render(<BashExecutionCard block={block} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("border-yellow-500");
    expect(wrapper.textContent).toContain("bash.backgroundRunning");
    expect(wrapper.textContent).toContain("bash.viewOutput");
  });

  it("background state via details — yellow border", () => {
    const block = makeBlock({
      details: {
        background: {
          pid: 1,
          command: "sleep 10",
          startedAt: Date.now() - 5000,
          durationMs: 5000,
          detached: true,
        },
      },
    });
    const { container } = render(<BashExecutionCard block={block} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("border-yellow-500");
  });

  it("terminated state via store — red border, cancelled text", () => {
    mockBashProcess = {
      toolCallId: "tc-1",
      command: "ls",
      cwd: "/tmp",
      startedAt: Date.now() - 3000,
      endedAt: Date.now() - 1000,
      output: "",
      status: "terminated",
    };
    const block = makeBlock({ startedAt: Date.now() - 3000 });
    const { container } = render(<BashExecutionCard block={block} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("border-red-500");
    expect(wrapper.textContent).toContain("common:cancelled");
  });

  it("error state — red border", () => {
    const block = makeBlock({ status: "error" });
    const { container } = render(<BashExecutionCard block={block} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("border-red-500");
  });

  it("completed state — gray border, no action buttons", () => {
    const block = makeBlock({ status: "done" });
    const { container } = render(<BashExecutionCard block={block} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("border-gray-200");
    expect(wrapper.textContent).not.toContain("common:cancel");
    expect(wrapper.textContent).not.toContain("bash.viewOutput");
  });
});

describe("BashExecutionCard interactions", () => {
  it("click Kill on running — calls apiClient.call with kill action", async () => {
    const block = makeBlock({ startedAt: Date.now() - 1000 });
    const { container } = render(<BashExecutionCard block={block} />);

    const killBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "common:cancel",
    );
    expect(killBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(killBtn!);
    });

    expect(mockCall).toHaveBeenCalledWith("bash.command", {
      sessionId: "test-session",
      action: "kill",
      toolCallId: "tc-1",
    });
  });

  it("click Background button — calls apiClient.call with background action", async () => {
    const tenSecondsAgo = Date.now() - 10000;
    const block = makeBlock({ startedAt: tenSecondsAgo });
    const { container } = render(<BashExecutionCard block={block} />);

    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const bgBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "bash.background",
    );
    expect(bgBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(bgBtn!);
    });

    expect(mockCall).toHaveBeenCalledWith("bash.command", {
      sessionId: "test-session",
      action: "background",
      toolCallId: "tc-1",
    });
  });

  it("click View Output on background — shows LogViewer", () => {
    mockBashProcess = {
      toolCallId: "tc-1",
      command: "sleep 10",
      cwd: "/tmp",
      pid: 123,
      startedAt: Date.now() - 5000,
      output: "",
      status: "background",
      logPath: "/tmp/bash.log",
    };
    const block = makeBlock({ startedAt: Date.now() - 5000 });
    const { container, getByTestId } = render(<BashExecutionCard block={block} />);

    const viewBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "bash.viewOutput",
    );
    expect(viewBtn).toBeTruthy();

    act(() => {
      fireEvent.click(viewBtn!);
    });

    expect(getByTestId("log-viewer")).toBeTruthy();
    expect(getByTestId("log-path").textContent).toBe("/tmp/bash.log");
    expect(getByTestId("log-toolcall").textContent).toBe("tc-1");
  });

  it("click close on LogViewer — hides LogViewer", () => {
    mockBashProcess = {
      toolCallId: "tc-1",
      command: "sleep 10",
      cwd: "/tmp",
      pid: 123,
      startedAt: Date.now() - 5000,
      output: "",
      status: "background",
      logPath: "/tmp/bash.log",
    };
    const block = makeBlock({ startedAt: Date.now() - 5000 });
    const { container, getByTestId, queryByTestId } = render(<BashExecutionCard block={block} />);

    const viewBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "bash.viewOutput",
    );
    act(() => {
      fireEvent.click(viewBtn!);
    });
    expect(getByTestId("log-viewer")).toBeTruthy();

    act(() => {
      fireEvent.click(getByTestId("log-close"));
    });
    expect(queryByTestId("log-viewer")).toBeNull();
  });
});

describe("BashExecutionCard content", () => {
  it("shows tool name 'bash' in the header", () => {
    const block = makeBlock();
    const { container } = render(<BashExecutionCard block={block} />);

    expect(container.textContent).toContain("bash");
  });

  it("shows output in AnsiText component", () => {
    const block = makeBlock({ output: "some output here" });
    const { getByTestId } = render(<BashExecutionCard block={block} />);

    expect(getByTestId("ansi-text").textContent).toBe("some output here");
  });

  it("shows input args as YAML in details section", () => {
    const block = makeBlock({ args: 'command: "ls -la"' });
    const { container } = render(<BashExecutionCard block={block} />);

    expect(container.textContent).toContain('command: "ls -la"');
  });
});
