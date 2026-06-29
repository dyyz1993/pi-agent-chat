/**
 * @vitest-environment happy-dom
 *
 * SubagentExecutionCard 组件渲染测试
 *
 * 验证内容：
 * 1. 彩色竖条 (StatusBar) 颜色与状态匹配
 * 2. 展开/折叠行为（成功折叠、失败展开、运行中展开）
 * 3. 展开态显示工具调用列表 + 最新消息摘要
 * 4. 耗时显示
 * 5. 状态文案正确（运行中/完成/出错）
 */
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import type { ContentBlock, SubagentSessionInfo } from "../../../src/mainview/types";

// --- Mock state that setupMockStore can mutate ---
const hoisted = vi.hoisted(() => ({
  matchedSub: null as SubagentSessionInfo | null,
  messages: [] as Array<{ role: string; content: ContentBlock[] }>,
  subagentStatus: undefined as string | undefined,
  useSubagentStoreImpl: null as ((s: (state: unknown) => unknown) => unknown) | null,
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) => {
      const fakeState = {
        subsessionsByParent: hoisted.matchedSub
          ? { "/fake/parent.jsonl": [hoisted.matchedSub] }
          : {},
        subagentStatusMap: hoisted.subagentStatus ? { sess_sub_test_001: hoisted.subagentStatus } : {},
      };
      return selector(fakeState);
    }),
    {
      getState: vi.fn(() => ({
        subsessionsByParent: {},
        messagesBySubsession: {},
        setActiveSubsession: vi.fn(),
      })),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: Object.assign(
    vi.fn((selector: (s: unknown) => unknown) => {
      const fakeState = {
        messagesBySession:
          hoisted.messages.length > 0 ? { sess_sub_test_001: hoisted.messages } : {},
      };
      return selector(fakeState);
    }),
    {
      getState: vi.fn(() => ({
        messagesBySession: {},
      })),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), onReconnect: vi.fn() },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    vi.fn(() => "sess_parent_001"),
    {
      getState: vi.fn(() => ({ sessionContextMap: {}, activeSessionId: "sess_parent_001" })),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-settings-store", () => ({
  useSettingsStore: Object.assign(
    vi.fn(() => true),
    {
      getState: vi.fn(() => ({ collapseToolCards: true })),
      subscribe: vi.fn(),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-agent-store", () => ({
  useAgentStore: { getState: vi.fn(() => ({ agentDetailBySession: {} })), subscribe: vi.fn() },
}));

vi.mock("../../../src/mainview/components/chat/primitives/useToolDuration", () => ({
  useToolDuration: vi.fn(() => "12s"),
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "subagent.running": "Running",
        "subagent.completed": "Completed",
        "subagent.error": "Error",
        "subagent.subagentTask": "Sub-agent task",
        "subagent.input": "Input",
        "subagent.output": "Output",
        "subagent.view": "View",
        "subagent.moreTools": "more tools",
      };
      return map[key] ?? key;
    },
  }),
}));

vi.mock("../../../src/mainview/utils/agent-color", () => ({
  agentColorStyle: vi.fn(() => null),
}));

vi.mock("../../../src/mainview/components/chat/primitives/useJumpToSession", () => ({
  useJumpToSession: vi.fn((sessionId?: string) => ({
    canJump: Boolean(sessionId),
    handleJump: vi.fn(),
  })),
}));

// Import after mocks
import { SubagentExecutionCard } from "../../../src/mainview/components/chat/tool-renderers/SubagentRenderer";

function makeBlock(
  overrides: Partial<Extract<ContentBlock, { type: "toolExecution" }>> = {},
): Extract<ContentBlock, { type: "toolExecution" }> {
  return {
    type: "toolExecution",
    toolCallId: "tc-sub-001",
    toolName: "subagent",
    args: JSON.stringify({
      description: "Refactor module",
      instruction: "Refactor the auth module",
    }),
    status: "done",
    output: "",
    ...overrides,
  };
}

function setupMockStore(
  sub: Partial<SubagentSessionInfo> & { status?: "running" | "done" | "error" },
  messages: Array<{ role: string; content: ContentBlock[] }> = [],
) {
  const isRunning = sub.status === "running";
  const isError = sub.status === "error";
  const now = Date.now();

  hoisted.matchedSub = {
    sessionId: "sess_sub_test_001",
    sessionPath: "/fake/sub.jsonl",
    description: "Refactor module",
    instruction: "Refactor the auth module",
    startedAt: now - 12000,
    completedAt: !isRunning ? now - 1000 : undefined,
    exitCode: isError ? 1 : 0,
    error: isError ? "Permission denied" : undefined,
    toolCallId: "tc-sub-001",
    ...sub,
  };
  hoisted.messages = messages;
  hoisted.subagentStatus = isRunning ? "streaming" : undefined;
}

describe("SubagentExecutionCard — status styling", () => {
  afterEach(() => {
    cleanup();
    hoisted.matchedSub = null;
    hoisted.messages = [];
  });

  it("运行中显示信息状态图标", () => {
    setupMockStore({ status: "running" });
    const block = makeBlock({ status: "running" });
    const { container } = render(<SubagentExecutionCard block={block} />);

    const icon = container.querySelector(".lucide-bot");
    expect(icon).toBeTruthy();
    expect(icon?.className).toContain("text-status-info");
  });

  it("成功显示稳定的 agent 状态图标", () => {
    setupMockStore({ status: "done" });
    const block = makeBlock({ status: "done" });
    const { container } = render(<SubagentExecutionCard block={block} />);

    const icon = container.querySelector(".lucide-bot");
    expect(icon?.className).toContain("text-semantic-agent");
  });

  it("失败显示红色状态图标", () => {
    setupMockStore({ status: "error" });
    const block = makeBlock({ status: "error" });
    const { container } = render(<SubagentExecutionCard block={block} />);

    const icon = container.querySelector(".lucide-bot");
    expect(icon?.className).toContain("text-status-error");
  });
});

describe("SubagentExecutionCard — 状态文案", () => {
  afterEach(() => {
    cleanup();
    hoisted.matchedSub = null;
    hoisted.messages = [];
  });

  it("运行中显示 'Running' 文案 + animate-pulse", () => {
    setupMockStore({ status: "running" });
    const block = makeBlock({ status: "running" });
    render(<SubagentExecutionCard block={block} />);

    const statusText = screen.getByText("Running");
    expect(statusText.className).toContain("animate-pulse");
    expect(statusText.className).toContain("text-semantic-agent");
  });

  it("完成显示 'Completed' 文案 + 绿色", () => {
    setupMockStore({ status: "done" });
    const block = makeBlock({ status: "done" });
    render(<SubagentExecutionCard block={block} />);

    const statusText = screen.getByText("Completed");
    expect(statusText.className).toContain("text-status-success");
  });

  it("失败显示 'Error' 文案 + 红色", () => {
    setupMockStore({ status: "error" });
    const block = makeBlock({ status: "error" });
    render(<SubagentExecutionCard block={block} />);

    const statusText = screen.getByText("Error");
    expect(statusText.className).toContain("text-status-error");
  });

  it("父工具块已 done 且子会话仍在流式运行、尚无最终输出时，仍显示 'Running'", () => {
    setupMockStore(
      {
        status: "running",
        completedAt: undefined,
        exitCode: undefined,
      },
      [],
    );
    hoisted.subagentStatus = "streaming";
    const block = makeBlock({ status: "done", output: "" });
    render(<SubagentExecutionCard block={block} />);

    const statusText = screen.getByText("Running");
    expect(statusText.className).toContain("animate-pulse");
  });

  it("已有最终输出且子会话已空闲时，不再显示 'Running'", () => {
    setupMockStore(
      {
        status: "done",
        finalText: "All steps completed",
      },
      [],
    );
    hoisted.subagentStatus = "idle";
    const block = makeBlock({ status: "done", output: "All steps completed" });
    render(<SubagentExecutionCard block={block} />);

    const statusText = screen.getByText("Completed");
    expect(statusText.className).toContain("text-status-success");
  });

  it("已有阶段性输出但子会话仍在流式运行时，仍显示 'Running'", () => {
    setupMockStore(
      {
        status: "running",
        completedAt: undefined,
        finalText: "Phase 1 complete",
      },
      [],
    );
    hoisted.subagentStatus = "streaming";
    const block = makeBlock({ status: "done", output: "Phase 1 complete" });
    render(<SubagentExecutionCard block={block} />);

    const statusText = screen.getByText("Running");
    expect(statusText.className).toContain("animate-pulse");
  });
});

describe("SubagentExecutionCard — 展开/折叠行为", () => {
  afterEach(() => {
    cleanup();
    hoisted.matchedSub = null;
    hoisted.messages = [];
  });

  it("失败状态默认遵循折叠设置", () => {
    setupMockStore({ status: "error" });
    const block = makeBlock({ status: "error" });
    render(<SubagentExecutionCard block={block} />);

    expect(screen.queryByText("Input")).toBeNull();
  });

  it("成功状态默认折叠", () => {
    setupMockStore({ status: "done" });
    const block = makeBlock({ status: "done" });
    render(<SubagentExecutionCard block={block} />);

    expect(screen.queryByText("Input")).toBeNull();
  });

  it("点击 header 可切换折叠状态", () => {
    setupMockStore({ status: "done" });
    const block = makeBlock({ status: "done" });
    render(<SubagentExecutionCard block={block} />);

    expect(screen.queryByText("Input")).toBeNull();

    const header = screen.getByText("Refactor module");
    fireEvent.click(header);
    expect(screen.getByText("Input")).toBeTruthy();

    fireEvent.click(header);
    expect(screen.queryByText("Input")).toBeNull();
  });
});

describe("SubagentExecutionCard — 实时进度展示", () => {
  afterEach(() => {
    cleanup();
    hoisted.matchedSub = null;
    hoisted.messages = [];
  });

  it("展开时以内联工具标签显示工具调用列表", () => {
    setupMockStore({ status: "running" }, [
      {
        role: "assistant",
        content: [
          { type: "text", text: "Working..." },
          {
            type: "toolExecution",
            toolCallId: "tc-read-1",
            toolName: "read",
            args: "",
            status: "done",
          },
          {
            type: "toolExecution",
            toolCallId: "tc-edit-1",
            toolName: "edit",
            args: "",
            status: "running",
          },
        ],
      },
    ]);
    const block = makeBlock({ status: "running" });
    render(<SubagentExecutionCard block={block} />);

    expect(screen.getByText("read · edit")).toBeTruthy();
  });

  it("展开时显示最新消息摘要", () => {
    setupMockStore({ status: "running" }, [
      {
        role: "assistant",
        content: [{ type: "text", text: "Found 3 issues in auth module" }],
      },
    ]);
    const block = makeBlock({ status: "running" });
    render(<SubagentExecutionCard block={block} />);

    expect(screen.getByText("Found 3 issues in auth module")).toBeTruthy();
  });

  it("超过3个工具调用时以内联标签显示剩余数量", () => {
    setupMockStore({ status: "running" }, [
      {
        role: "assistant",
        content: Array.from({ length: 8 }, (_, i) => ({
          type: "toolExecution" as const,
          toolCallId: `tc-${i}`,
          toolName: `tool_${i}`,
          args: "",
          status: "done" as const,
        })).concat([{ type: "text" as const, text: "Done" }]),
      },
    ]);
    const block = makeBlock({ status: "running" });
    const { container } = render(<SubagentExecutionCard block={block} />);

    expect(container.textContent).toContain("+5");
  });

  it("无消息和工具调用时不崩溃", () => {
    setupMockStore({ status: "running" }, []);
    const block = makeBlock({ status: "running" });
    const { container } = render(<SubagentExecutionCard block={block} />);
    expect(container).toBeTruthy();
  });
});

describe("SubagentExecutionCard — 耗时显示", () => {
  afterEach(() => {
    cleanup();
    hoisted.matchedSub = null;
    hoisted.messages = [];
  });

  it("成功状态显示完成耗时", () => {
    setupMockStore({ status: "done" });
    const block = makeBlock({ status: "done" });
    render(<SubagentExecutionCard block={block} />);

    const timeElements = document.querySelectorAll(".tabular-nums");
    expect(timeElements.length).toBeGreaterThan(0);
    expect(timeElements[0]?.textContent).toMatch(/^\d+s$/);
  });
});

describe("SubagentExecutionCard — 输出渲染", () => {
  afterEach(() => {
    cleanup();
    hoisted.matchedSub = null;
    hoisted.messages = [];
  });

  it("将子会话输出按 Markdown 渲染", () => {
    setupMockStore({ status: "done" });
    const block = makeBlock({ status: "done", output: "**done**" });
    const { container } = render(<SubagentExecutionCard block={block} />);

    fireEvent.click(screen.getByText("Refactor module"));
    expect(container.querySelector("strong")?.textContent).toBe("done");
  });

  it("已有阶段性输出但子会话仍在运行时，展开后仍保留已产出的输出内容", () => {
    setupMockStore({ status: "running", finalText: "done", completedAt: undefined });
    hoisted.subagentStatus = "streaming";
    const block = makeBlock({ status: "done", output: "done" });
    render(<SubagentExecutionCard block={block} />);

    const header = screen.getByText("Refactor module");
    if (!screen.queryByText("Output")) {
      fireEvent.click(header);
    }
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Output")).toBeTruthy();
    expect(screen.getByText("done")).toBeTruthy();
  });
});
