/**
 * 压缩后 force reload 消息完整性验证
 *
 * 核心场景：
 *   1. Agent 正常对话（有工具调用、文案）
 *   2. 触发压缩(compaction)
 *   3. 压缩后继续执行新消息（产生新工具调用、新文案）
 *   4. compaction_end 触发 force reload → loadSessionMessages({ force: true })
 *   5. 验证刷新后：工具调用块完整性、文案不丢失、状态正确
 *
 * 这个测试填补了现有测试的空白：
 * - rollback-refresh-stale-leafid.test.ts 只验证纯文本消息数量
 * - history-and-compaction-verification.test.ts 只验证 compactionSummary 保留
 * - 本测试验证工具调用(toolCall+toolResult)在压缩后 force reload 的完整合并链路
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: {
    getState: vi.fn(() => ({ addEntry: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: vi.fn(() => ({ addLog: vi.fn() })),
  },
}));

vi.mock("../src/mainview/stores/use-session-store", () => ({
  useSessionStore: {
    getState: vi.fn(() => ({
      activeSessionId: "sess-1",
      sessionReady: { "sess-1": true },
      sessionContextMap: {},
      sessionStatusMap: {},
      restoreContextFromHistory: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

vi.mock("../src/mainview/stores/use-memory-store", () => ({
  useMemoryStore: {
    getState: vi.fn(() => ({
      addEvent: vi.fn(),
      addInjected: vi.fn(),
      clearSession: vi.fn(),
    })),
  },
}));

vi.mock("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(["memory_prefetch", "memory_prefetch_result"]),
}));

import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { apiClient } from "../src/mainview/lib/api-client";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
    isLoadingMoreBySession: {},
    hasMoreMessagesBySession: {},
  });
});

const SID = "sess-compaction-reload";

/**
 * 模拟压缩后服务端返回的完整消息列表：
 *   - compactionSummary（压缩摘要）
 *   - 压缩后新产生的 assistant（含 toolCall）
 *   - 对应的 toolResult
 *   - 压缩后最终 assistant 文案
 */
function buildPostCompactionServerMessages() {
  return {
    messages: [
      {
        id: "compact-1",
        role: "compactionSummary",
        summary: "压缩了前 4 条消息，保留了最近的对话上下文",
        tokensBefore: 120000,
        timestamp: 5000,
      },
      {
        id: "post-u1",
        role: "user",
        content: "帮我改一下登录页面的样式",
        timestamp: 6000,
      },
      {
        id: "post-a1",
        role: "assistant",
        content: [
          { type: "text", text: "我来帮你修改登录页面的样式，先看一下当前的代码。" },
          {
            type: "toolCall",
            id: "tc-post-1",
            name: "read_file",
            arguments: { path: "/src/pages/Login.tsx" },
          },
        ],
        timestamp: 7000,
      },
      {
        id: "post-tr1",
        role: "toolResult",
        toolCallId: "tc-post-1",
        toolName: "read_file",
        content: [
          {
            type: "text",
            text: "export function LoginPage() {\n  return <div>Login</div>;\n}\n",
          },
        ],
        timestamp: 7500,
      },
      {
        id: "post-a2",
        role: "assistant",
        content: [
          {
            type: "toolCall",
            id: "tc-post-2",
            name: "write_file",
            arguments: {
              path: "/src/pages/Login.tsx",
              content:
                'export function LoginPage() {\n  return <div className="dark">Login</div>;\n}\n',
            },
          },
        ],
        timestamp: 8000,
      },
      {
        id: "post-tr2",
        role: "toolResult",
        toolCallId: "tc-post-2",
        toolName: "write_file",
        content: [{ type: "text", text: "File written successfully" }],
        timestamp: 8500,
      },
      {
        id: "post-a3",
        role: "assistant",
        content: [{ type: "text", text: "已经帮你把登录页面添加了 dark 模式的 class。" }],
        timestamp: 9000,
        usage: { input: 5000, output: 800 },
      },
    ],
    customEntries: [],
    hasMore: false,
    totalCount: 7,
  };
}

describe("压缩后 force reload 工具调用与文案完整性", () => {
  it("压缩后 force reload，工具调用被正确合并为 toolExecution 块", async () => {
    mockedCall.mockResolvedValue(buildPostCompactionServerMessages());

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];

    // 应包含：compactionSummary + user + assistant(toolCall合并) + assistant(toolCall合并) + assistant(纯文本)
    expect(msgs.length).toBeGreaterThanOrEqual(5);

    // toolResult 消息应该被合并掉，不再单独存在
    const toolResultMsgs = msgs.filter((m) => m.role === "toolResult");
    expect(toolResultMsgs).toHaveLength(0);
  });

  it("压缩后 force reload，compactionSummary 保留且内容正确", async () => {
    mockedCall.mockResolvedValue(buildPostCompactionServerMessages());

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];

    const compactMsg = msgs.find((m) => m.role === "compactionSummary");
    expect(compactMsg).toBeDefined();
    expect(compactMsg!.content[0].type).toBe("compactionSummary");

    const summaryBlock = compactMsg!.content[0] as {
      type: "compactionSummary";
      summary: string;
      tokensBefore: number;
    };
    expect(summaryBlock.summary).toBe("压缩了前 4 条消息，保留了最近的对话上下文");
    expect(summaryBlock.tokensBefore).toBe(120000);
  });

  it("压缩后 force reload，toolCall+toolResult 合并后状态为 done", async () => {
    mockedCall.mockResolvedValue(buildPostCompactionServerMessages());

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];

    // 找到含 toolExecution 的 assistant 消息
    const assistantMsgsWithTools = msgs.filter(
      (m) => m.role === "assistant" && m.content.some((b) => b.type === "toolExecution"),
    );

    expect(assistantMsgsWithTools.length).toBeGreaterThanOrEqual(2);

    // 验证第一个工具调用 (read_file)
    const readMsg = assistantMsgsWithTools.find((m) =>
      m.content.some(
        (b) => b.type === "toolExecution" && (b as { toolName: string }).toolName === "read_file",
      ),
    );
    expect(readMsg).toBeDefined();

    const readExec = readMsg!.content.find(
      (b) => b.type === "toolExecution" && (b as { toolName: string }).toolName === "read_file",
    ) as Extract<(typeof readMsg)["content"][number], { type: "toolExecution" }>;

    expect(readExec).toBeDefined();
    expect(readExec.toolCallId).toBe("tc-post-1");
    expect(readExec.status).toBe("done");
    expect(readExec.output).toContain("export function LoginPage");
    expect(readExec.args).toContain("/src/pages/Login.tsx");

    // 验证第二个工具调用 (write_file)
    const writeMsg = assistantMsgsWithTools.find((m) =>
      m.content.some(
        (b) => b.type === "toolExecution" && (b as { toolName: string }).toolName === "write_file",
      ),
    );
    expect(writeMsg).toBeDefined();

    const writeExec = writeMsg!.content.find(
      (b) => b.type === "toolExecution" && (b as { toolName: string }).toolName === "write_file",
    ) as Extract<(typeof writeMsg)["content"][number], { type: "toolExecution" }>;

    expect(writeExec).toBeDefined();
    expect(writeExec.toolCallId).toBe("tc-post-2");
    expect(writeExec.status).toBe("done");
    expect(writeExec.output).toContain("File written successfully");
    expect(writeExec.args).toContain("/src/pages/Login.tsx");
  });

  it("压缩后 force reload，工具调用的文案内容不丢失", async () => {
    mockedCall.mockResolvedValue(buildPostCompactionServerMessages());

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];

    // 第一条 assistant 消息应同时包含文案和 toolExecution
    const firstAssistant = msgs.find(
      (m) =>
        m.role === "assistant" &&
        m.content.some(
          (b) => b.type === "toolExecution" && (b as { toolName: string }).toolName === "read_file",
        ),
    );

    expect(firstAssistant).toBeDefined();

    const textBlock = firstAssistant!.content.find((b) => b.type === "text") as
      | { type: "text"; text: string }
      | undefined;

    expect(textBlock).toBeDefined();
    expect(textBlock!.text).toContain("我来帮你修改登录页面的样式，先看一下当前的代码。");
  });

  it("压缩后 force reload，最终 assistant 文案完整保留", async () => {
    mockedCall.mockResolvedValue(buildPostCompactionServerMessages());

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];

    // 最后一条 assistant 消息（纯文案回复）
    const lastAssistant = [...msgs]
      .reverse()
      .find((m) => m.role === "assistant" && m.content.every((b) => b.type === "text"));

    expect(lastAssistant).toBeDefined();

    const textContent = lastAssistant!.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("");

    expect(textContent).toContain("已经帮你把登录页面添加了 dark 模式的 class。");
  });

  it("压缩后 force reload，toolExecution 包含完整 output 不截断", async () => {
    mockedCall.mockResolvedValue(buildPostCompactionServerMessages());

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];

    const allToolExecs = msgs
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.content)
      .filter((b): b is Extract<typeof b, { type: "toolExecution" }> => b.type === "toolExecution");

    expect(allToolExecs.length).toBeGreaterThanOrEqual(2);

    // read_file 的 output 包含完整文件内容
    const readExec = allToolExecs.find((e) => e.toolName === "read_file");
    expect(readExec).toBeDefined();
    expect(readExec!.output).toBeDefined();
    expect(readExec!.output).toContain("export function LoginPage");
    expect(readExec!.output).toContain("return <div>Login</div>");

    // write_file 的 output 包含成功消息
    const writeExec = allToolExecs.find((e) => e.toolName === "write_file");
    expect(writeExec).toBeDefined();
    expect(writeExec!.output).toBeDefined();
    expect(writeExec!.output).toContain("File written successfully");
  });
});

describe("压缩后 force reload：多次工具调用的位置顺序", () => {
  it("toolExecution 在 content blocks 中保持原始顺序（text → tool → tool）", async () => {
    const serverData = {
      messages: [
        {
          id: "compact-1",
          role: "compactionSummary",
          summary: "压缩了旧消息",
          tokensBefore: 100000,
          timestamp: 5000,
        },
        {
          id: "u1",
          role: "user",
          content: "帮我优化一下项目结构",
          timestamp: 6000,
        },
        {
          id: "a1",
          role: "assistant",
          content: [
            { type: "text", text: "我先看看项目结构。" },
            {
              type: "toolCall",
              id: "tc-bash-1",
              name: "bash",
              arguments: { command: "find src -type f | head -20" },
            },
          ],
          timestamp: 7000,
        },
        {
          id: "tr1",
          role: "toolResult",
          toolCallId: "tc-bash-1",
          toolName: "bash",
          content: [{ type: "text", text: "src/App.tsx\nsrc/index.tsx\nsrc/utils.ts" }],
          timestamp: 7500,
        },
        {
          id: "a2",
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tc-bash-2",
              name: "bash",
              arguments: { command: "wc -l src/*.tsx" },
            },
          ],
          timestamp: 8000,
        },
        {
          id: "tr2",
          role: "toolResult",
          toolCallId: "tc-bash-2",
          toolName: "bash",
          content: [
            { type: "text", text: "  120 src/App.tsx\n   45 src/index.tsx\n   30 src/utils.ts" },
          ],
          timestamp: 8500,
        },
        {
          id: "a3",
          role: "assistant",
          content: [{ type: "text", text: "项目结构已分析完毕，共有 3 个主要文件。" }],
          timestamp: 9000,
          usage: { input: 3000, output: 200 },
        },
      ],
      customEntries: [],
      hasMore: false,
      totalCount: 7,
    };

    mockedCall.mockResolvedValue(serverData);

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];

    // 第一条 assistant 消息：text + toolExecution(bash 1) 顺序不变
    const firstAssistant = msgs.find(
      (m) =>
        m.role === "assistant" &&
        m.content.some(
          (b) =>
            b.type === "toolExecution" && (b as { toolCallId: string }).toolCallId === "tc-bash-1",
        ),
    );

    expect(firstAssistant).toBeDefined();
    const blockTypes1 = firstAssistant!.content.map((b) => b.type);
    expect(blockTypes1).toEqual(["text", "toolExecution"]);

    const bash1Exec = firstAssistant!.content[1] as Extract<
      (typeof firstAssistant)["content"][number],
      { type: "toolExecution" }
    >;
    expect(bash1Exec.toolName).toBe("bash");
    expect(bash1Exec.status).toBe("done");
    expect(bash1Exec.output).toContain("src/App.tsx");

    // 第二条 assistant 消息：只有 toolExecution(bash 2)
    const secondAssistant = msgs.find(
      (m) =>
        m.role === "assistant" &&
        m.content.some(
          (b) =>
            b.type === "toolExecution" && (b as { toolCallId: string }).toolCallId === "tc-bash-2",
        ),
    );

    expect(secondAssistant).toBeDefined();
    const bash2Exec = secondAssistant!.content.find((b) => b.type === "toolExecution") as Extract<
      (typeof secondAssistant)["content"][number],
      { type: "toolExecution" }
    >;
    expect(bash2Exec.toolCallId).toBe("tc-bash-2");
    expect(bash2Exec.status).toBe("done");
    expect(bash2Exec.output).toContain("120 src/App.tsx");

    // 最终 assistant 文案
    const finalAssistant = msgs.find(
      (m) =>
        m.role === "assistant" &&
        m.content.some(
          (b) => b.type === "text" && (b as { text: string }).text.includes("项目结构已分析完毕"),
        ),
    );
    expect(finalAssistant).toBeDefined();
  });
});

describe("压缩后 force reload：工具调用错误状态保留", () => {
  it("isError=true 的 toolResult 合并后 status 为 error", async () => {
    const serverData = {
      messages: [
        {
          id: "compact-1",
          role: "compactionSummary",
          summary: "压缩完成",
          tokensBefore: 80000,
          timestamp: 5000,
        },
        {
          id: "u1",
          role: "user",
          content: "运行测试",
          timestamp: 6000,
        },
        {
          id: "a1",
          role: "assistant",
          content: [
            { type: "text", text: "开始运行测试。" },
            {
              type: "toolCall",
              id: "tc-bash-fail",
              name: "bash",
              arguments: { command: "npm test" },
            },
          ],
          timestamp: 7000,
        },
        {
          id: "tr1",
          role: "toolResult",
          toolCallId: "tc-bash-fail",
          toolName: "bash",
          content: [{ type: "text", text: "Error: Test suite failed with 3 failures" }],
          isError: true,
          timestamp: 7500,
        },
        {
          id: "a2",
          role: "assistant",
          content: [{ type: "text", text: "测试失败了，有 3 个用例未通过，我来修复。" }],
          timestamp: 8000,
          usage: { input: 2000, output: 300 },
        },
      ],
      customEntries: [],
      hasMore: false,
      totalCount: 5,
    };

    mockedCall.mockResolvedValue(serverData);

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];

    const toolExec = msgs
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.content)
      .find(
        (b): b is Extract<typeof b, { type: "toolExecution" }> =>
          b.type === "toolExecution" && (b as { toolCallId: string }).toolCallId === "tc-bash-fail",
      );

    expect(toolExec).toBeDefined();
    expect(toolExec!.status).toBe("error");
    expect(toolExec!.output).toContain("Test suite failed with 3 failures");
    expect(toolExec!.toolName).toBe("bash");
  });
});

describe("压缩后 force reload：空 compactionSummary + 工具调用组合", () => {
  it("空 summary 的 compactionSummary 不影响后续工具调用的合并", async () => {
    const serverData = {
      messages: [
        {
          id: "compact-empty",
          role: "compactionSummary",
          summary: "",
          tokensBefore: 100000,
          timestamp: 5000,
        },
        {
          id: "u1",
          role: "user",
          content: "搜索 TODO",
          timestamp: 6000,
        },
        {
          id: "a1",
          role: "assistant",
          content: [
            {
              type: "toolCall",
              id: "tc-grep-1",
              name: "grep",
              arguments: { pattern: "TODO", path: "src/" },
            },
          ],
          timestamp: 7000,
        },
        {
          id: "tr1",
          role: "toolResult",
          toolCallId: "tc-grep-1",
          toolName: "grep",
          content: [{ type: "text", text: "src/App.tsx:42: // TODO: refactor this component" }],
          timestamp: 7500,
        },
        {
          id: "a2",
          role: "assistant",
          content: [{ type: "text", text: "找到了 1 个 TODO。" }],
          timestamp: 8000,
          usage: { input: 1000, output: 50 },
        },
      ],
      customEntries: [],
      hasMore: false,
      totalCount: 5,
    };

    mockedCall.mockResolvedValue(serverData);

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];

    // compactionSummary 保留
    const compactMsg = msgs.find((m) => m.role === "compactionSummary");
    expect(compactMsg).toBeDefined();

    // toolResult 被合并，不单独存在
    const toolResultMsgs = msgs.filter((m) => m.role === "toolResult");
    expect(toolResultMsgs).toHaveLength(0);

    // toolExecution 状态正确
    const grepExec = msgs
      .filter((m) => m.role === "assistant")
      .flatMap((m) => m.content)
      .find(
        (b): b is Extract<typeof b, { type: "toolExecution" }> =>
          b.type === "toolExecution" && (b as { toolCallId: string }).toolCallId === "tc-grep-1",
      );

    expect(grepExec).toBeDefined();
    expect(grepExec!.status).toBe("done");
    expect(grepExec!.toolName).toBe("grep");
    expect(grepExec!.output).toContain("TODO: refactor this component");
    expect(grepExec!.args).toContain("TODO");
  });
});

describe("压缩后 force reload：同一 assistant 消息中多个 toolCall", () => {
  it("一个 assistant 消息包含多个 toolCall，force reload 后全部正确合并", async () => {
    const serverData = {
      messages: [
        {
          id: "compact-1",
          role: "compactionSummary",
          summary: "压缩完成",
          tokensBefore: 90000,
          timestamp: 5000,
        },
        {
          id: "u1",
          role: "user",
          content: "帮我同时读取三个文件",
          timestamp: 6000,
        },
        {
          id: "a1",
          role: "assistant",
          content: [
            { type: "text", text: "我来同时读取这三个文件。" },
            {
              type: "toolCall",
              id: "tc-read-a",
              name: "read_file",
              arguments: { path: "/src/a.ts" },
            },
            {
              type: "toolCall",
              id: "tc-read-b",
              name: "read_file",
              arguments: { path: "/src/b.ts" },
            },
            {
              type: "toolCall",
              id: "tc-read-c",
              name: "read_file",
              arguments: { path: "/src/c.ts" },
            },
          ],
          timestamp: 7000,
        },
        {
          id: "tr-a",
          role: "toolResult",
          toolCallId: "tc-read-a",
          toolName: "read_file",
          content: [{ type: "text", text: "// File A\nexport const a = 1;" }],
          timestamp: 7500,
        },
        {
          id: "tr-b",
          role: "toolResult",
          toolCallId: "tc-read-b",
          toolName: "read_file",
          content: [{ type: "text", text: "// File B\nexport const b = 2;" }],
          timestamp: 7600,
        },
        {
          id: "tr-c",
          role: "toolResult",
          toolCallId: "tc-read-c",
          toolName: "read_file",
          content: [{ type: "text", text: "// File C\nexport const c = 3;" }],
          timestamp: 7700,
        },
        {
          id: "a2",
          role: "assistant",
          content: [{ type: "text", text: "三个文件已读取完毕：a=1, b=2, c=3。" }],
          timestamp: 8000,
          usage: { input: 4000, output: 100 },
        },
      ],
      customEntries: [],
      hasMore: false,
      totalCount: 8,
    };

    mockedCall.mockResolvedValue(serverData);

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];

    // 无残留 toolResult 消息
    expect(msgs.filter((m) => m.role === "toolResult")).toHaveLength(0);

    // 第一条 assistant 含 1 text + 3 toolExecution
    const multiToolAssistant = msgs.find(
      (m) =>
        m.role === "assistant" && m.content.filter((b) => b.type === "toolExecution").length === 3,
    );

    expect(multiToolAssistant).toBeDefined();

    const blockTypes = multiToolAssistant!.content.map((b) => b.type);
    expect(blockTypes).toEqual(["text", "toolExecution", "toolExecution", "toolExecution"]);

    // 逐个验证
    const execs = multiToolAssistant!.content.filter(
      (b): b is Extract<typeof b, { type: "toolExecution" }> => b.type === "toolExecution",
    );

    const readA = execs.find((e) => e.toolCallId === "tc-read-a");
    expect(readA).toBeDefined();
    expect(readA!.status).toBe("done");
    expect(readA!.output).toContain("export const a = 1");

    const readB = execs.find((e) => e.toolCallId === "tc-read-b");
    expect(readB).toBeDefined();
    expect(readB!.status).toBe("done");
    expect(readB!.output).toContain("export const b = 2");

    const readC = execs.find((e) => e.toolCallId === "tc-read-c");
    expect(readC).toBeDefined();
    expect(readC!.status).toBe("done");
    expect(readC!.output).toContain("export const c = 3");

    // 最终 assistant 文案
    const finalMsg = msgs.find(
      (m) =>
        m.role === "assistant" &&
        m.content.some(
          (b) => b.type === "text" && (b as { text: string }).text.includes("三个文件已读取完毕"),
        ),
    );
    expect(finalMsg).toBeDefined();
  });

  it("compactionSummary appears in correct chronological order (not at end)", async () => {
    // Simulate server returning messages in JSONL chronological order:
    // user → assistant → compactionSummary → user → assistant
    const serverData = {
      messages: [
        {
          id: "msg-user-1",
          role: "user",
          content: [{ type: "text", text: "第一个问题" }],
          timestamp: 1000,
          entryId: "entry-1",
        },
        {
          id: "msg-assistant-1",
          role: "assistant",
          content: [{ type: "text", text: "第一个回答" }],
          timestamp: 2000,
          tokenUsage: { input: 100, output: 50 },
          entryId: "entry-2",
        },
        {
          id: "compact-1",
          role: "compactionSummary",
          summary: "压缩了前两条消息",
          tokensBefore: 80000,
          timestamp: 3000,
          entryId: "entry-compaction-1",
        },
        {
          id: "msg-user-2",
          role: "user",
          content: [{ type: "text", text: "第二个问题" }],
          timestamp: 4000,
          entryId: "entry-3",
        },
        {
          id: "msg-assistant-2",
          role: "assistant",
          content: [{ type: "text", text: "第二个回答" }],
          timestamp: 5000,
          tokenUsage: { input: 200, output: 80 },
          entryId: "entry-4",
        },
      ],
      customEntries: [],
      hasMore: false,
      totalCount: 5,
    };

    mockedCall.mockResolvedValue(serverData);

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];
    const roles = msgs.map((m) => m.role);

    // compactionSummary should be between assistant-1 and user-2, NOT at the end
    expect(roles).toEqual(["user", "assistant", "compactionSummary", "user", "assistant"]);

    // Verify the compactionSummary is at index 2 (not at end)
    const compactIdx = msgs.findIndex((m) => m.role === "compactionSummary");
    expect(compactIdx).toBe(2);

    // Verify messages after compaction are in correct order
    const afterCompaction = msgs.slice(compactIdx + 1);
    expect(afterCompaction.map((m) => m.role)).toEqual(["user", "assistant"]);
  });

  it("multiple compactionSummaries maintain correct order", async () => {
    // Simulate multiple compactions in a long session
    const serverData = {
      messages: [
        {
          id: "msg-user-1",
          role: "user",
          content: [{ type: "text", text: "问题1" }],
          timestamp: 1000,
          entryId: "entry-1",
        },
        {
          id: "compact-1",
          role: "compactionSummary",
          summary: "第一次压缩",
          tokensBefore: 80000,
          timestamp: 2000,
          entryId: "entry-comp-1",
        },
        {
          id: "msg-user-2",
          role: "user",
          content: [{ type: "text", text: "问题2" }],
          timestamp: 3000,
          entryId: "entry-2",
        },
        {
          id: "msg-assistant-2",
          role: "assistant",
          content: [{ type: "text", text: "回答2" }],
          timestamp: 4000,
          tokenUsage: { input: 100, output: 50 },
          entryId: "entry-3",
        },
        {
          id: "compact-2",
          role: "compactionSummary",
          summary: "第二次压缩",
          tokensBefore: 90000,
          timestamp: 5000,
          entryId: "entry-comp-2",
        },
        {
          id: "msg-user-3",
          role: "user",
          content: [{ type: "text", text: "问题3" }],
          timestamp: 6000,
          entryId: "entry-4",
        },
      ],
      customEntries: [],
      hasMore: false,
      totalCount: 6,
    };

    mockedCall.mockResolvedValue(serverData);

    await useChatStore.getState().loadSessionMessages(SID, { force: true });

    const msgs = useChatStore.getState().messagesBySession[SID] ?? [];
    const roles = msgs.map((m) => m.role);

    // Both compactionSummaries should be in correct chronological positions
    expect(roles).toEqual([
      "user",
      "compactionSummary",
      "user",
      "assistant",
      "compactionSummary",
      "user",
    ]);

    // Verify first compaction is between user-1 and user-2
    const compact1Idx = msgs.findIndex((m) => m.id === "compact-1");
    expect(compact1Idx).toBe(1);

    // Verify second compaction is between assistant-2 and user-3
    const compact2Idx = msgs.findIndex((m) => m.id === "compact-2");
    expect(compact2Idx).toBe(4);
  });
});
