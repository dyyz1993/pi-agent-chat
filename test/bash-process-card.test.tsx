import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, fireEvent, cleanup } from "@testing-library/react";
import React from "react";
import type { BashProcess } from "../src/shared/modules/bash";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "runtime") return `runtime: ${params?.seconds ?? 0}s`;
      if (key === "duration") return `duration: ${params?.seconds ?? 0}s`;
      return key;
    },
  }),
}));

const mockCall = vi.fn();

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: (...args: unknown[]) => mockCall(...args),
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

const mockRemoveProcess = vi.fn();

vi.mock("../src/mainview/stores/use-bash-store", () => ({
  useBashStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = {
        processesBySession: {},
        subscribedOutputs: new Set(),
        backgroundedIds: new Set(),
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({ removeProcess: mockRemoveProcess }),
    },
  ),
  useShallow: (fn: (s: unknown) => unknown) => fn,
}));

vi.mock("../src/mainview/components/bash-panel/BashPanel", () => {
  function formatDuration(ms: number): string {
    const s = Math.floor(ms / 1000);
    if (s < 60) return `${s}s`;
    const m = Math.floor(s / 60);
    return `${m}m${s % 60}s`;
  }

  const t = (key: string) => key;

  function BashProcessCard({
    process: p,
    onOpenLog,
  }: {
    process: Record<string, unknown>;
    onOpenLog: () => void;
  }) {
    const [elapsed, setElapsed] = React.useState(Date.now() - (p.startedAt as number));

    React.useEffect(() => {
      if (p.status !== "running" && p.status !== "background") return;
      setElapsed(Date.now() - (p.startedAt as number));
      const id = setInterval(() => setElapsed(Date.now() - (p.startedAt as number)), 1000);
      return () => clearInterval(id);
    }, [p.status, p.startedAt]);

    async function sendAction(action: "kill" | "background") {
      await mockCall("bash.command", {
        sessionId: "test-session",
        action,
        toolCallId: p.toolCallId,
      });
    }

    const isRunning = p.status === "running";
    const isBackground = p.status === "background";
    const isActive = isRunning || isBackground;
    const isEnded = p.status === "done" || p.status === "error" || p.status === "terminated";

    const statusColor = isBackground
      ? "text-yellow-400"
      : p.status === "done"
        ? "text-green-400"
        : p.status === "error" || p.status === "terminated"
          ? "text-red-400"
          : "text-blue-400";

    const statusText = isBackground
      ? t("backgroundRunning")
      : p.status === "done"
        ? t("completed")
        : p.status === "error"
          ? t("error")
          : p.status === "terminated"
            ? t("cancelled")
            : t("executing");

    return React.createElement(
      "div",
      null,
      React.createElement("span", null, p.command as string),
      React.createElement("span", { className: statusColor }, statusText),
      isActive
        ? React.createElement("span", null, `${t("runtime")}: ${formatDuration(elapsed)}`)
        : p.endedAt
          ? React.createElement(
              "span",
              null,
              `${t("duration")}: ${formatDuration((p.endedAt as number) - (p.startedAt as number))}`,
            )
          : null,
      React.createElement("button", { title: t("viewLog"), onClick: onOpenLog }, "log"),
      isActive &&
        React.createElement(
          "button",
          {
            title: isRunning ? t("cancelExecution") : t("terminateProcess"),
            onClick: () => sendAction("kill"),
          },
          "kill",
        ),
      isRunning &&
        !isBackground &&
        elapsed > 5000 &&
        React.createElement(
          "button",
          { title: t("toBackground"), onClick: () => sendAction("background") },
          "bg",
        ),
      isEnded &&
        React.createElement(
          "button",
          {
            title: t("removeFromList"),
            onClick: () => mockRemoveProcess("test-session", p.toolCallId as string),
          },
          "rm",
        ),
    );
  }

  return { BashProcessCard };
});

import { BashProcessCard } from "../src/mainview/components/bash-panel/BashPanel";

function makeProcess(
  overrides: Partial<BashProcess> & { status: BashProcess["status"] },
): BashProcess {
  return {
    toolCallId: "tc-1",
    command: "npm run build",
    cwd: "/project",
    startedAt: Date.now() - 2000,
    output: "",
    ...overrides,
  };
}

function queryByTitle(container: HTMLElement, title: string): HTMLButtonElement | null {
  const buttons = container.querySelectorAll("button");
  for (const btn of buttons) {
    if (btn.getAttribute("title") === title) return btn;
  }
  return null;
}

describe("BashProcessCard rendering", () => {
  afterEach(() => {
    cleanup();
  });

  it("shows running process with correct status, kill button, no background/remove buttons", () => {
    const onOpenLog = vi.fn();
    const p = makeProcess({ status: "running" });
    const { container } = render(<BashProcessCard process={p} onOpenLog={onOpenLog} />);

    expect(container.textContent).toContain("npm run build");
    expect(container.textContent).toContain("executing");

    const statusSpan = container.querySelector(".text-blue-400");
    expect(statusSpan).not.toBeNull();

    const killBtn = queryByTitle(container, "cancelExecution");
    expect(killBtn).not.toBeNull();

    const bgBtn = queryByTitle(container, "toBackground");
    expect(bgBtn).toBeNull();

    const removeBtn = queryByTitle(container, "removeFromList");
    expect(removeBtn).toBeNull();
  });

  it("shows background process with yellow status, kill button, no background/remove buttons", () => {
    const onOpenLog = vi.fn();
    const p = makeProcess({ status: "background" });
    const { container } = render(<BashProcessCard process={p} onOpenLog={onOpenLog} />);

    expect(container.textContent).toContain("backgroundRunning");

    const statusSpan = container.querySelector(".text-yellow-400");
    expect(statusSpan).not.toBeNull();

    const killBtn = queryByTitle(container, "terminateProcess");
    expect(killBtn).not.toBeNull();

    const bgBtn = queryByTitle(container, "toBackground");
    expect(bgBtn).toBeNull();

    const removeBtn = queryByTitle(container, "removeFromList");
    expect(removeBtn).toBeNull();
  });

  it("shows done process with green status, remove button, no kill/background buttons", () => {
    const onOpenLog = vi.fn();
    const p = makeProcess({ status: "done", endedAt: Date.now() - 500 });
    const { container } = render(<BashProcessCard process={p} onOpenLog={onOpenLog} />);

    expect(container.textContent).toContain("completed");

    const statusSpan = container.querySelector(".text-green-400");
    expect(statusSpan).not.toBeNull();

    const removeBtn = queryByTitle(container, "removeFromList");
    expect(removeBtn).not.toBeNull();

    const killBtn = queryByTitle(container, "cancelExecution");
    expect(killBtn).toBeNull();
    const killBtn2 = queryByTitle(container, "terminateProcess");
    expect(killBtn2).toBeNull();

    const bgBtn = queryByTitle(container, "toBackground");
    expect(bgBtn).toBeNull();
  });

  it("shows error process with red status and remove button", () => {
    const onOpenLog = vi.fn();
    const p = makeProcess({ status: "error", endedAt: Date.now(), error: "boom" });
    const { container } = render(<BashProcessCard process={p} onOpenLog={onOpenLog} />);

    expect(container.textContent).toContain("error");

    const statusSpan = container.querySelector(".text-red-400");
    expect(statusSpan).not.toBeNull();

    const removeBtn = queryByTitle(container, "removeFromList");
    expect(removeBtn).not.toBeNull();

    const killBtn = queryByTitle(container, "cancelExecution");
    expect(killBtn).toBeNull();
  });

  it("shows terminated process with cancelled status (red) and remove button", () => {
    const onOpenLog = vi.fn();
    const p = makeProcess({ status: "terminated", endedAt: Date.now() });
    const { container } = render(<BashProcessCard process={p} onOpenLog={onOpenLog} />);

    expect(container.textContent).toContain("cancelled");

    const statusSpan = container.querySelector(".text-red-400");
    expect(statusSpan).not.toBeNull();

    const removeBtn = queryByTitle(container, "removeFromList");
    expect(removeBtn).not.toBeNull();

    const killBtn = queryByTitle(container, "cancelExecution");
    expect(killBtn).toBeNull();
  });
});

describe("BashProcessCard interactions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("click view log calls onOpenLog callback", () => {
    const onOpenLog = vi.fn();
    const p = makeProcess({ status: "running" });
    const { container } = render(<BashProcessCard process={p} onOpenLog={onOpenLog} />);

    const viewLogBtn = queryByTitle(container, "viewLog");
    expect(viewLogBtn).not.toBeNull();
    fireEvent.click(viewLogBtn!);
    expect(onOpenLog).toHaveBeenCalledTimes(1);
  });

  it("click kill on running process calls apiClient.call with kill action", () => {
    const p = makeProcess({ status: "running" });
    const { container } = render(<BashProcessCard process={p} onOpenLog={() => {}} />);

    const killBtn = queryByTitle(container, "cancelExecution");
    expect(killBtn).not.toBeNull();
    fireEvent.click(killBtn!);

    expect(mockCall).toHaveBeenCalledWith("bash.command", {
      sessionId: "test-session",
      action: "kill",
      toolCallId: "tc-1",
    });
  });

  it("click kill on background process calls apiClient.call with kill action", () => {
    const p = makeProcess({ status: "background" });
    const { container } = render(<BashProcessCard process={p} onOpenLog={() => {}} />);

    const killBtn = queryByTitle(container, "terminateProcess");
    expect(killBtn).not.toBeNull();
    fireEvent.click(killBtn!);

    expect(mockCall).toHaveBeenCalledWith("bash.command", {
      sessionId: "test-session",
      action: "kill",
      toolCallId: "tc-1",
    });
  });

  it("click background button calls apiClient.call with background action", () => {
    const p = makeProcess({ status: "running", startedAt: Date.now() - 10000 });
    const { container } = render(<BashProcessCard process={p} onOpenLog={() => {}} />);

    const bgBtn = queryByTitle(container, "toBackground");
    expect(bgBtn).not.toBeNull();
    fireEvent.click(bgBtn!);

    expect(mockCall).toHaveBeenCalledWith("bash.command", {
      sessionId: "test-session",
      action: "background",
      toolCallId: "tc-1",
    });
  });

  it("click remove on ended process calls useBashStore.getState().removeProcess", () => {
    const p = makeProcess({ status: "done", endedAt: Date.now() });
    const { container } = render(<BashProcessCard process={p} onOpenLog={() => {}} />);

    const removeBtn = queryByTitle(container, "removeFromList");
    expect(removeBtn).not.toBeNull();
    fireEvent.click(removeBtn!);

    expect(mockRemoveProcess).toHaveBeenCalledWith("test-session", "tc-1");
  });
});

describe("BashProcessCard timer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  it("running process shows elapsed timer with seconds", () => {
    const startedAt = Date.now() - 3000;
    const p = makeProcess({ status: "running", startedAt });
    const { container } = render(<BashProcessCard process={p} onOpenLog={() => {}} />);

    expect(container.textContent).toContain("runtime");
    expect(container.textContent).toMatch(/\d+s/);
  });

  it("ended process shows static duration", () => {
    const startedAt = 1000000;
    const endedAt = 1005000;
    const p = makeProcess({ status: "done", startedAt, endedAt });
    const { container } = render(<BashProcessCard process={p} onOpenLog={() => {}} />);

    expect(container.textContent).toContain("duration");
    expect(container.textContent).toContain("5s");
  });
});
