import { describe, it, expect, vi, afterEach, beforeEach, beforeAll } from "vitest";
import { render, cleanup, act, fireEvent, screen } from "@testing-library/react";
import type { ContentBlock } from "../src/mainview/types";
import type { UIInteractionBlock } from "../src/mainview/types";
import type { BashProcess } from "../src/shared/modules/bash";

type Block = Extract<ContentBlock, { type: "toolExecution" }>;

const bashMocks = {
  mockCall: vi.fn(),
  state: { mockBashProcess: undefined as BashProcess | undefined },
};
const { mockCall } = bashMocks;

vi.mock("react-i18next", () => {
  return {
    useTranslation: () => ({ t: (key: string) => key }),
    initReactI18next: { type: "3rdParty", init: vi.fn() },
  };
});

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: bashMocks.mockCall,
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
        "test-session": bashMocks.state.mockBashProcess
          ? [bashMocks.state.mockBashProcess]
          : [],
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

vi.mock("../src/shared/lib/json-to-yaml", () => ({
  tryFormatAsYaml: (input: string) => input,
}));

let BashExecutionCard: typeof import("../src/mainview/components/chat/tool-renderers/BashRenderer").BashExecutionCard;

beforeAll(async () => {
  ({ BashExecutionCard } = await import(
    "../src/mainview/components/chat/tool-renderers/BashRenderer"
  ));
});

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

function makeUIBlock(overrides: Partial<UIInteractionBlock> = {}): UIInteractionBlock {
  return {
    type: "uiInteraction",
    id: "ui-1",
    method: "confirm",
    status: "pending",
    sessionId: "test-session",
    title: "Bash 命令确认",
    message: "需要审核",
    hookMeta: {
      toolName: "bash",
      matcher: "Bash",
      command: "rm -rf /tmp/demo",
      hookCommand: "bash ~/.claude/hooks/pre-tool-use-write.sh",
      eventName: "PreToolUse",
      source: "project",
      reason: "需要审核",
    },
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date("2025-01-01T00:00:00Z") });
  bashMocks.state.mockBashProcess = undefined;
  mockCall.mockReset();
  mockCall.mockImplementation((method: string) => {
    if (method === "bash.readLog") {
      return Promise.resolve({ lines: [], totalLines: 0, hasMore: false });
    }
    return Promise.resolve(undefined);
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("BashExecutionCard state rendering", () => {
  it("running state — info border, Kill button, no View Output", () => {
    const block = makeBlock({ startedAt: Date.now() - 1000 });
    const { container } = render(<BashExecutionCard block={block} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("border-status-info");
    expect(wrapper.textContent).toContain("common:cancel");
    expect(wrapper.textContent).not.toContain("bash.viewOutput");
  });

  it("background state via store — warning border, backgroundRunning text, View Output button", () => {
    bashMocks.state.mockBashProcess = {
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
    expect(wrapper.className).toContain("border-status-warning");
    expect(wrapper.textContent).toContain("bash.backgroundRunning");
    expect(wrapper.textContent).toContain("bash.viewOutput");
  });

  it("background state via details — warning border", () => {
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
    expect(wrapper.className).toContain("border-status-warning");
  });

  it("terminated state via store — error border, cancelled text", () => {
    bashMocks.state.mockBashProcess = {
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
    expect(wrapper.className).toContain("border-status-error");
    expect(wrapper.textContent).toContain("common:cancelled");
  });

  it("error state — error border", () => {
    const block = makeBlock({ status: "error" });
    const { container } = render(<BashExecutionCard block={block} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("border-status-error");
  });

  it("completed state — secondary border, no action buttons", () => {
    const block = makeBlock({ status: "done" });
    const { container } = render(<BashExecutionCard block={block} />);

    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("border-border-secondary");
    expect(wrapper.textContent).not.toContain("common:cancel");
    expect(wrapper.textContent).not.toContain("bash.viewOutput");
  });

  it("renders hook permission inline while keeping the bash card visible", () => {
    const block = makeBlock({
      args: JSON.stringify({ command: "rm -rf /tmp/demo", description: "危险命令" }),
    });
    const uiBlock = makeUIBlock();

    const { container } = render(<BashExecutionCard block={block} uiBlock={uiBlock} />);

    expect(container.textContent).toContain("危险命令");
    expect(container.textContent).toContain("目标操作");
    expect(container.textContent).toContain("rm -rf /tmp/demo");
    expect(container.textContent).toContain("Hook 规则");
    expect(container.textContent).toContain("bash ~/.claude/hooks/pre-tool-use-write.sh");
    expect(container.textContent).toContain("当前权限方式");
    expect(container.textContent).toContain("免询问");
    expect(container.textContent).toContain("临时关闭 Hooks");
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

  it("click hook permission mode — calls agent.setPermissionMode for the active session", async () => {
    const block = makeBlock({
      args: JSON.stringify({ command: "rm -rf /tmp/demo", description: "危险命令" }),
    });
    const uiBlock = makeUIBlock();
    const { container } = render(<BashExecutionCard block={block} uiBlock={uiBlock} />);
    const modeBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "免询问",
    );
    expect(modeBtn).toBeTruthy();

    await act(async () => {
      fireEvent.click(modeBtn!);
    });

    expect(mockCall).toHaveBeenCalledWith("agent.setPermissionMode", {
      sessionId: "test-session",
      mode: "dontAsk",
    });
  });

  it("click View Output on background — shows LogViewer", () => {
    bashMocks.state.mockBashProcess = {
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

    const viewBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "bash.viewOutput",
    );
    expect(viewBtn).toBeTruthy();

    act(() => {
      fireEvent.click(viewBtn!);
    });

    expect(screen.getByText("bash.log")).toBeTruthy();
  });

  it("click close on LogViewer — hides LogViewer", () => {
    bashMocks.state.mockBashProcess = {
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

    const viewBtn = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "bash.viewOutput",
    );
    act(() => {
      fireEvent.click(viewBtn!);
    });
    expect(screen.getByText("bash.log")).toBeTruthy();

    act(() => {
      fireEvent.click(document.body.querySelector('button[title="close"]')!);
    });
    expect(screen.queryByText("bash.log")).toBeNull();
  });
});

describe("BashExecutionCard content", () => {
  it("shows command description in the header", () => {
    const block = makeBlock();
    const { container } = render(<BashExecutionCard block={block} />);

    expect(container.textContent).toContain("ls -la");
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
