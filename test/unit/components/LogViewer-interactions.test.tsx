import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup, act } from "@testing-library/react";
import { LogViewer } from "../../../src/mainview/components/bash-panel/BashPanel";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const mockSubscribe = vi.fn(() => Promise.resolve("sub-id"));
const mockUnsubscribe = vi.fn();
const mockCall = vi.fn();

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
    unsubscribe: (...args: unknown[]) => mockUnsubscribe(...args),
    call: (...args: unknown[]) => mockCall(...args),
    onReconnect: () => {},
  },
}));

// Mock virtua - Virtualizer component renders children directly in test env
vi.mock("virtua", async () => {
  const { forwardRef } = await import("react");
  const MockVirtualizer = forwardRef(({ children }: { children: React.ReactNode }) => {
    return <div data-testid="mock-virtualizer">{children}</div>;
  });
  return { Virtualizer: MockVirtualizer };
});

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { activeSessionId: "test-session" };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ activeSessionId: "test-session" }) },
  ),
}));

vi.mock("react-dom", () => ({
  createPortal: (children: React.ReactNode) => children,
}));

async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 10));
  });
}

const defaultProps = {
  logPath: "/tmp/test.log",
  toolCallId: "tc-1",
  onClose: vi.fn(),
};

describe("LogViewer initialization and lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockImplementation((method: string) => {
      if (method === "bash.readLog") {
        return Promise.resolve({
          lines: ["line 1", "line 2", "line 3"],
          totalLines: 3,
          hasMore: false,
        });
      }
      if (method === "bash.watchLog") return Promise.resolve(undefined);
      if (method === "bash.unwatchLog") return Promise.resolve(undefined);
      if (method === "bash.command") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    mockSubscribe.mockResolvedValue("sub-id");
    defaultProps.onClose.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("subscribes to bash.logUpdate on mount", async () => {
    render(<LogViewer {...defaultProps} />);
    await settle();

    expect(mockSubscribe).toHaveBeenCalledWith(
      "bash.logUpdate",
      expect.any(Function),
      expect.objectContaining({ sessionId: "test-session" }),
    );
  });

  it("loads initial log lines via bash.readLog", async () => {
    render(<LogViewer {...defaultProps} />);
    await settle();

    expect(mockCall).toHaveBeenCalledWith("bash.readLog", {
      logPath: "/tmp/test.log",
      offset: 0,
      limit: 500,
    });
  });

  it("starts watching log file", async () => {
    render(<LogViewer {...defaultProps} />);
    await settle();

    expect(mockCall).toHaveBeenCalledWith("bash.watchLog", {
      logPath: "/tmp/test.log",
      sessionId: "test-session",
    });
  });

  it("cleans up on unmount", async () => {
    const { unmount } = render(<LogViewer {...defaultProps} />);
    await settle();

    unmount();
    await settle();

    expect(mockUnsubscribe).toHaveBeenCalledWith("sub-id");
    expect(mockCall).toHaveBeenCalledWith("bash.unwatchLog", {
      logPath: "/tmp/test.log",
      sessionId: "test-session",
    });
  });
});

describe("LogViewer stdin input", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockImplementation((method: string) => {
      if (method === "bash.readLog") {
        return Promise.resolve({ lines: ["line 1"], totalLines: 1, hasMore: false });
      }
      if (method === "bash.watchLog") return Promise.resolve(undefined);
      if (method === "bash.unwatchLog") return Promise.resolve(undefined);
      if (method === "bash.command") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    mockSubscribe.mockResolvedValue("sub-id");
    defaultProps.onClose.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("sends stdin text on Enter key", async () => {
    const { container } = render(<LogViewer {...defaultProps} />);
    await settle();

    const input = container.querySelector('input[placeholder="stdinPlaceholder"]');
    expect(input).toBeTruthy();

    fireEvent.change(input!, { target: { value: "hello" } });
    fireEvent.keyDown(input!, { key: "Enter" });

    await settle();

    expect(mockCall).toHaveBeenCalledWith("bash.command", {
      sessionId: "test-session",
      action: "write_stdin",
      toolCallId: "tc-1",
      data: "hello\n",
    });
  });

  it("sends stdin text on Send button click", async () => {
    const { container } = render(<LogViewer {...defaultProps} />);
    await settle();

    const input = container.querySelector('input[placeholder="stdinPlaceholder"]');
    fireEvent.change(input!, { target: { value: "hello" } });

    const sendBtn = container.querySelector('button[title="sendTitle"]');
    expect(sendBtn).toBeTruthy();
    fireEvent.click(sendBtn!);

    await settle();

    expect(mockCall).toHaveBeenCalledWith("bash.command", {
      sessionId: "test-session",
      action: "write_stdin",
      toolCallId: "tc-1",
      data: "hello\n",
    });
  });

  it("clears input after sending", async () => {
    const { container } = render(<LogViewer {...defaultProps} />);
    await settle();

    const input = container.querySelector(
      'input[placeholder="stdinPlaceholder"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "hello" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await settle();

    expect(input.value).toBe("");
  });

  it("does not send empty input", async () => {
    const { container } = render(<LogViewer {...defaultProps} />);
    await settle();

    const sendBtn = container.querySelector('button[title="sendTitle"]') as HTMLButtonElement;
    expect(sendBtn.disabled).toBe(true);

    const input = container.querySelector('input[placeholder="stdinPlaceholder"]');
    fireEvent.keyDown(input!, { key: "Enter" });

    await settle();

    const commandCalls = mockCall.mock.calls.filter(
      (c: unknown[]) =>
        c[0] === "bash.command" &&
        typeof c[1] === "object" &&
        c[1] !== null &&
        (c[1] as { action?: string }).action === "write_stdin",
    );
    expect(commandCalls.length).toBe(0);
  });
});

describe("LogViewer real-time streaming", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockImplementation((method: string) => {
      if (method === "bash.readLog") {
        return Promise.resolve({
          lines: ["line 1", "line 2", "line 3"],
          totalLines: 3,
          hasMore: false,
        });
      }
      if (method === "bash.watchLog") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    mockSubscribe.mockResolvedValue("sub-id");
    defaultProps.onClose.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("appends new lines from subscription", async () => {
    const { container } = render(<LogViewer {...defaultProps} />);
    await settle();

    const subscribeCallback = mockSubscribe.mock.calls[0][1] as (payload: {
      logPath: string;
      newLines: string[];
    }) => void;

    act(() => {
      subscribeCallback({ logPath: "/tmp/test.log", newLines: ["new line 4", "new line 5"] });
    });

    await settle();

    const allSpans = container.querySelectorAll("span");
    const countSpan = Array.from(allSpans).find((s) => s.textContent?.includes("5/"));
    expect(countSpan).toBeTruthy();
    expect(countSpan!.textContent).toBe("5/5");
  });

  it("subscribes to bash.event output for the viewer session", async () => {
    const { container } = render(<LogViewer {...defaultProps} sessionId="sub-session" />);
    await settle();

    expect(mockSubscribe).toHaveBeenCalledWith(
      "bash.event",
      expect.any(Function),
      expect.objectContaining({ sessionId: "sub-session" }),
    );
    expect(mockCall).toHaveBeenCalledWith("bash.command", {
      sessionId: "sub-session",
      action: "subscribe_output",
      toolCallId: "tc-1",
    });

    const bashEventCallback = mockSubscribe.mock.calls.find(
      (call) => call[0] === "bash.event",
    )?.[1] as
      | ((payload: {
          sessionId: string;
          event: { type: string; toolCallId: string; data: string; timestamp: number };
        }) => void)
      | undefined;

    expect(bashEventCallback).toBeDefined();

    act(() => {
      bashEventCallback?.({
        sessionId: "sub-session",
        event: {
          type: "output",
          toolCallId: "tc-1",
          data: "live line 4\nlive line 5\n",
          timestamp: Date.now(),
        },
      });
    });

    await settle();

    expect(container.textContent).toContain("live line 4");
    expect(container.textContent).toContain("live line 5");
  });

  it("ignores bash.event output from other tool calls", async () => {
    const { container } = render(<LogViewer {...defaultProps} sessionId="sub-session" />);
    await settle();

    const bashEventCallback = mockSubscribe.mock.calls.find(
      (call) => call[0] === "bash.event",
    )?.[1] as
      | ((payload: {
          sessionId: string;
          event: { type: string; toolCallId: string; data: string; timestamp: number };
        }) => void)
      | undefined;

    act(() => {
      bashEventCallback?.({
        sessionId: "sub-session",
        event: {
          type: "output",
          toolCallId: "other-tool",
          data: "wrong output\n",
          timestamp: Date.now(),
        },
      });
    });

    await settle();

    expect(container.textContent).not.toContain("wrong output");
  });
});

describe("LogViewer close behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCall.mockImplementation((method: string) => {
      if (method === "bash.readLog") {
        return Promise.resolve({ lines: ["line 1"], totalLines: 1, hasMore: false });
      }
      if (method === "bash.watchLog") return Promise.resolve(undefined);
      if (method === "bash.unwatchLog") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    mockSubscribe.mockResolvedValue("sub-id");
    defaultProps.onClose.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("calls onClose when close button clicked", async () => {
    const { container } = render(<LogViewer {...defaultProps} />);
    await settle();

    const closeBtn = container.querySelector('button[aria-label="close"]');
    expect(closeBtn).toBeTruthy();
    fireEvent.click(closeBtn!);

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose when Escape pressed", async () => {
    const { container } = render(<LogViewer {...defaultProps} />);
    await settle();

    const overlay = container.querySelector(".fixed.inset-0");
    expect(overlay).toBeTruthy();
    fireEvent.keyDown(overlay!, { key: "Escape" });

    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});

describe("LogViewer paginated loading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let readLogCallCount = 0;
    mockCall.mockImplementation((method: string) => {
      if (method === "bash.readLog") {
        readLogCallCount++;
        if (readLogCallCount === 1) {
          return Promise.resolve({
            lines: Array.from({ length: 500 }, (_, i) => `line ${i + 1}`),
            totalLines: 1000,
            hasMore: true,
          });
        }
        return Promise.resolve({
          lines: Array.from({ length: 500 }, (_, i) => `line ${i + 501}`),
          totalLines: 1000,
          hasMore: false,
        });
      }
      if (method === "bash.watchLog") return Promise.resolve(undefined);
      if (method === "bash.unwatchLog") return Promise.resolve(undefined);
      return Promise.resolve(undefined);
    });
    mockSubscribe.mockResolvedValue("sub-id");
    defaultProps.onClose.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("loads more lines when hasMore=true and scrolled to bottom", async () => {
    const { container } = render(<LogViewer {...defaultProps} />);
    await settle();

    const readLogCallsBefore = mockCall.mock.calls.filter(
      (c: unknown[]) => c[0] === "bash.readLog",
    ).length;
    expect(readLogCallsBefore).toBe(1);

    const scrollDiv = container.querySelector('[class*="overflow-auto"]');
    expect(scrollDiv).toBeTruthy();

    const el = scrollDiv!;
    Object.defineProperty(el, "scrollHeight", { value: 10000, configurable: true });
    Object.defineProperty(el, "clientHeight", { value: 500, configurable: true });
    Object.defineProperty(el, "scrollTop", { value: 9930, configurable: true });

    fireEvent.scroll(el);

    Object.defineProperty(el, "scrollTop", { value: 9930, configurable: true });
    fireEvent.scroll(el);

    await settle();

    const readLogCallsAfter = mockCall.mock.calls.filter(
      (c: unknown[]) => c[0] === "bash.readLog",
    ).length;
    expect(readLogCallsAfter).toBe(2);

    const lastReadLogCall = mockCall.mock.calls
      .filter((c: unknown[]) => c[0] === "bash.readLog")
      .pop() as unknown[];
    expect(lastReadLogCall[1]).toEqual(expect.objectContaining({ offset: 500, limit: 500 }));
  });
});
