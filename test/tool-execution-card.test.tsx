import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ToolExecutionCard } from "../src/mainview/components/chat/MessageBubble";
import type { ContentBlock } from "../src/mainview/types";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPES: {},
  ALL_MEMORY_TYPE_KEYS: new Set(),
  ENTRY_TYPE_KEYS: new Set(),
  getMemoryConfig: vi.fn(),
  getMemorySummary: vi.fn(() => ""),
}));

vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../src/mainview/stores/use-bash-store", () => ({
  useBashStore: {
    getState: vi.fn(() => ({ processesBySession: {} })),
    subscribe: vi.fn(),
    state: {},
  },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({})),
      subscribe: vi.fn(),
      state: {},
    },
  ),
}));

vi.mock("../src/mainview/utils/clipboard", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve()),
}));

vi.mock("../src/shared/lib/json-to-yaml", () => ({
  tryFormatAsYaml: (s: string) => s,
}));

vi.mock("../src/mainview/components/chat/tool-renderers", () => ({
  getToolRenderer: vi.fn(() => undefined),
}));

vi.mock("../src/mainview/components/chat/tool-renderers/registry", () => ({
  getToolRenderer: vi.fn(() => undefined),
  registerToolRenderer: vi.fn(),
}));

vi.mock("../src/mainview/components/chat/tool-renderers/SubagentRenderer", () => ({
  SubagentExecutionCard: vi.fn(() => null),
}));

vi.mock("../src/mainview/components/chat/tool-renderers/UICardRenderer", () => ({
  UIInteractionCard: vi.fn(() => null),
}));

vi.mock("../src/mainview/components/chat/tool-renderers/ReadFileCard", () => ({
  ReadFileCard: vi.fn(() => null),
}));

vi.mock("../src/mainview/components/chat/tool-renderers/WriteFileCard", () => ({
  WriteFileCard: vi.fn(() => null),
}));

vi.mock("../src/mainview/components/chat/tool-renderers/PreviewRenderer", () => ({
  PreviewRenderer: vi.fn(() => null),
}));

vi.mock("../src/mainview/components/chat/tool-renderers/BashRenderer", () => ({
  BashExecutionCard: vi.fn(() => null),
}));

vi.mock("../src/mainview/stores/use-expand-store", () => ({
  useExpandStore: Object.assign(
    vi.fn(() => ({ expandedContent: null, expandedTitle: "" })),
    {
      getState: vi.fn(() => ({
        expandedContent: null,
        expandedTitle: "",
        openExpand: vi.fn(),
        closeExpand: vi.fn(),
      })),
      subscribe: vi.fn(),
      state: {},
    },
  ),
}));

vi.mock("../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIBlockMap: vi.fn(() => new Map()),
}));

vi.mock("../src/mainview/stores/use-chat-nav-store", () => ({
  useChatNavStore: Object.assign(
    vi.fn(() => null),
    {
      getState: vi.fn(() => ({})),
      subscribe: vi.fn(),
      state: {},
    },
  ),
}));

vi.mock("../src/mainview/stores/use-turn-store", () => ({
  EMPTY_SET: new Set(),
  useTurnStore: Object.assign(
    vi.fn(() => ({})),
    {
      getState: vi.fn(() => ({})),
      subscribe: vi.fn(),
      state: {},
    },
  ),
}));

function makeBlock(
  overrides: Partial<Extract<ContentBlock, { type: "toolExecution" }>> = {},
): Extract<ContentBlock, { type: "toolExecution" }> {
  return {
    type: "toolExecution",
    toolCallId: "call-1",
    toolName: "read_file",
    args: "",
    status: "running",
    ...overrides,
  };
}

describe("ToolExecutionCard", () => {
  afterEach(() => {
    cleanup();
  });

  it("running without output shows 'streaming' text and waiting placeholder", () => {
    const block = makeBlock({ status: "running" });
    render(<ToolExecutionCard block={block} blockId="blk-1" />);

    expect(screen.getByText("streaming")).toBeInTheDocument();
  });

  it("running with output shows 'streaming' text and output in pre", () => {
    const block = makeBlock({ status: "running", output: "hello world" });
    render(<ToolExecutionCard block={block} blockId="blk-2" />);

    expect(screen.getByText("streaming")).toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("done with output shows CheckCircle and output, no 'streaming'", () => {
    const block = makeBlock({ status: "done", output: "result data" });
    render(<ToolExecutionCard block={block} blockId="blk-3" />);

    expect(screen.queryByText("streaming")).not.toBeInTheDocument();
    const svg = document.querySelector("svg.text-status-success");
    expect(svg).toBeInTheDocument();
    const matches = screen.getAllByText("result data");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((el) => el.tagName === "PRE")).toBe(true);
  });

  it("error with output shows XCircle and output", () => {
    const block = makeBlock({ status: "error", output: "error happened" });
    render(<ToolExecutionCard block={block} blockId="blk-4" />);

    const svg = document.querySelector("svg.text-status-error");
    expect(svg).toBeInTheDocument();
    const matches = screen.getAllByText("error happened");
    expect(matches.length).toBeGreaterThanOrEqual(1);
    expect(matches.some((el) => el.tagName === "PRE")).toBe(true);
  });

  it("renders data-block-id on outer container", () => {
    const block = makeBlock({ status: "done" });
    render(<ToolExecutionCard block={block} blockId="my-block-id" />);

    const el = document.querySelector("[data-block-id='my-block-id']");
    expect(el).toBeInTheDocument();
  });

  it("displays toolName in the card", () => {
    const block = makeBlock({ toolName: "my_custom_tool", status: "done" });
    render(<ToolExecutionCard block={block} blockId="blk-6" />);

    expect(screen.getByText("my_custom_tool")).toBeInTheDocument();
  });

  it("MCP tool with JSON output shows query from args, not raw brace", () => {
    const block = makeBlock({
      toolName: "mcp__websearch",
      status: "done",
      args: JSON.stringify({ query: "Rust 浏览器引擎 headless 爬虫", limit: 5 }),
      output: '{ "matched_by": "keyword", "results": [] }',
    });
    render(<ToolExecutionCard block={block} blockId="blk-mcp-1" />);

    // Should show query text, not raw JSON brace
    expect(screen.getByText("Rust 浏览器引擎 headless 爬虫")).toBeInTheDocument();
  });

  it("MCP tool with multiline JSON output (first line is brace) shows toolName", () => {
    const block = makeBlock({
      toolName: "mcp__sometool",
      status: "done",
      args: '{',
      output: '{\n  "results": []\n}',
    });
    render(<ToolExecutionCard block={block} blockId="blk-mcp-2" />);

    // First line of output is "{", should fall back to toolName
    expect(screen.getByText("mcp__sometool")).toBeInTheDocument();
  });

  it("MCP tool with no args and JSON output shows toolName", () => {
    const block = makeBlock({
      toolName: "mcp__sometool",
      status: "done",
      args: "",
      output: '{"status": "ok"}',
    });
    render(<ToolExecutionCard block={block} blockId="blk-mcp-3" />);

    expect(screen.getByText("mcp__sometool")).toBeInTheDocument();
  });

  it("tool with non-JSON output shows output first line", () => {
    const block = makeBlock({
      toolName: "bash",
      status: "done",
      args: JSON.stringify({ command: "echo hello" }),
      output: "hello world",
    });
    render(<ToolExecutionCard block={block} blockId="blk-7" />);

    expect(screen.getAllByText("hello world").length).toBeGreaterThanOrEqual(1);
  });
});
