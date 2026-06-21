/**
 * @vitest-environment happy-dom
 *
 * UI 测试: 压缩卡片 (/compact-force + 自动压缩) 的样式渲染
 *
 * 验证场景:
 * 1. compactionSummary 运行态渲染为统一的 compact card
 * 2. compaction_start / compaction_end 正确驱动 session status
 * 3. compactionSummary 完成态在 MessageCard 中正确渲染
 * 4. compactionSummary 卡片支持展开查看详情
 * 5. compaction_end 事件清 compacting status 后运行态卡片消失
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CompactionSummaryCard } from "../../../src/mainview/components/chat/CompactionSummaryCard";
import { MessageCard } from "../../../src/mainview/components/chat/MessageCard";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { handleAgentEvent } from "../../../src/mainview/lib/agent-event-handler";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import type { ChatMessage } from "../../../src/mainview/types";
import type { AgentEvent } from "../../../src/shared/modules/agent";

// Mock i18n
vi.mock("react-i18next", () => ({
  initReactI18next: { type: "3rdParty", init: vi.fn() },
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock clipboard
vi.mock("../../../src/mainview/utils/clipboard", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve(true)),
}));

// Mock chat overlay store (MessageBubble 依赖)
vi.mock("../../../src/mainview/stores/use-chat-overlay-store", () => ({
  useChatOverlayStore: {
    getState: () => ({
      overlay: null,
      openMarkdown: vi.fn(),
      close: vi.fn(),
    }),
  },
}));

const SESSION_ID = "test-session-compaction";

function compactionSummaryMsg(id: string, summary = "压缩了 50 条消息的上下文摘要"): ChatMessage {
  return {
    id,
    role: "compactionSummary",
    content: [{ type: "compactionSummary", summary, tokensBefore: 50000 }],
    timestamp: Date.now(),
  };
}

beforeEach(() => {
  useSessionStore.setState({
    activeSessionId: SESSION_ID,
    sessionStatusMap: {},
  });
  useChatStore.setState({
    messagesBySession: {},
  });
});

afterEach(() => {
  cleanup();
  useSessionStore.setState({ activeSessionId: null, sessionStatusMap: {} });
});

describe("CompactionSummaryCard — 压缩中样式", () => {
  it("渲染运行态 compact card", () => {
    const { container } = render(
      <CompactionSummaryCard
        blockId="running-compact"
        summary=""
        status="running"
        reason="threshold"
      />,
    );

    const card = container.querySelector('[data-block-id="running-compact"]');
    expect(card).toBeTruthy();
    expect(container.textContent).toContain("compacting");
    expect(container.textContent).toContain("compactingHint");

    // 有旋转 loading 图标 (Loader2)
    const loader = card!.querySelector(".animate-spin");
    expect(loader).toBeTruthy();
  });

  it("运行态默认可展开并显示原因", () => {
    const { container } = render(
      <CompactionSummaryCard blockId="running-compact" summary="" status="running" reason="manual" />,
    );

    expect(container.textContent).toContain("compacting");
    expect(container.textContent).not.toContain("manual");

    const toggle = screen.getByRole("button", { name: /compacting/ });
    fireEvent.click(toggle);

    expect(container.textContent).toContain("manual");
  });
});

describe("手动压缩事件流 — sessionStatus 变化", () => {
  it("compaction_start 事件将 status 设为 compacting", () => {
    const event: AgentEvent = {
      type: "compaction_start",
      reason: "manual",
    } as unknown as AgentEvent;

    handleAgentEvent(SESSION_ID, event);

    expect(useSessionStore.getState().sessionStatusMap[SESSION_ID]).toBe("compacting");
  });

  it("compaction_end 事件在无 streaming 时将 status 清为 idle", () => {
    // 先设为 compacting
    useSessionStore.getState().updateSessionStatus(SESSION_ID, "compacting");

    const event: AgentEvent = {
      type: "compaction_end",
      reason: "manual",
      result: { tokensAfter: 5000 },
      aborted: false,
    } as unknown as AgentEvent;

    handleAgentEvent(SESSION_ID, event);

    // 手动压缩场景: 没有 streaming 消息 → 立即清 status
    expect(useSessionStore.getState().sessionStatusMap[SESSION_ID]).toBe("idle");
  });

  it("compaction_end 在有 streaming 消息时不清 status (延迟到 agent_end)", () => {
    // 设为 compacting
    useSessionStore.getState().updateSessionStatus(SESSION_ID, "compacting");

    // 添加一条 streaming 中的 assistant 消息
    const streamingMsg: ChatMessage = {
      id: "streaming-1",
      role: "assistant",
      content: [{ type: "text", text: "正在回复..." }],
      timestamp: Date.now(),
      isStreaming: true,
    };
    useChatStore.setState({
      messagesBySession: { [SESSION_ID]: [streamingMsg] },
    });

    const event: AgentEvent = {
      type: "compaction_end",
      reason: "manual",
      result: { tokensAfter: 5000 },
      aborted: false,
    } as unknown as AgentEvent;

    handleAgentEvent(SESSION_ID, event);

    // streaming 场景: status 保持 compacting (等 agent_end 清)
    expect(useSessionStore.getState().sessionStatusMap[SESSION_ID]).toBe("compacting");
  });

  it("compaction_end 失败时发错误通知", () => {
    useSessionStore.getState().updateSessionStatus(SESSION_ID, "compacting");

    const event: AgentEvent = {
      type: "compaction_end",
      reason: "model_error",
      result: undefined,
      aborted: true,
    } as unknown as AgentEvent;

    // 不应该 throw
    expect(() => handleAgentEvent(SESSION_ID, event)).not.toThrow();

    // status 应该被清除
    expect(useSessionStore.getState().sessionStatusMap[SESSION_ID]).toBe("idle");
  });
});

describe("MessageCard — compactionSummary 压缩摘要卡片", () => {
  it("渲染 Archive 图标和 '上下文压缩' 标题", () => {
    const msg = compactionSummaryMsg("compact-1");
    render(<MessageCard message={msg} />);

    // 标题 (t("contextCompaction") → "contextCompaction")
    expect(screen.getByText("contextCompaction")).toBeTruthy();

    // token 信息 (50000 / 1000 = 50k)，新卡片只显示紧凑单位。
    expect(screen.getByText("50k")).toBeTruthy();
  });

  it("默认折叠状态显示摘要预览", () => {
    const msg = compactionSummaryMsg("compact-1", "## 对话摘要\n用户讨论了 React 性能优化");
    const { container } = render(<MessageCard message={msg} />);

    expect(container.textContent).toContain("用户讨论了 React 性能优化");
    expect(container.textContent).not.toContain("对话摘要");
  });

  it("点击卡片后展开显示完整摘要", () => {
    const summary = "这是第一行摘要\n这是第二行\n第三行内容";
    const msg = compactionSummaryMsg("compact-1", summary);
    const { container } = render(<MessageCard message={msg} />);

    expect(container.textContent).toContain("这是第一行摘要");
    expect(container.textContent).not.toContain("第三行内容");

    const toggle = screen.getByRole("button", { name: /contextCompaction/ });
    fireEvent.click(toggle);

    expect(container.textContent).toContain("第三行内容");
  });

  it("tokensBefore 显示为整数 k", () => {
    const msg = compactionSummaryMsg("compact-1");
    const msgWithTokens: ChatMessage = {
      ...msg,
      content: [{ type: "compactionSummary", summary: "摘要", tokensBefore: 28984 }],
    };
    render(<MessageCard message={msgWithTokens} />);

    // 28984 / 1000 ≈ 29k
    expect(screen.getByText("29k")).toBeTruthy();
  });

  it("没有 tokensBefore 时不显示 token 信息", () => {
    const msg: ChatMessage = {
      id: "compact-2",
      role: "compactionSummary",
      content: [{ type: "compactionSummary", summary: "摘要" }],
      timestamp: Date.now(),
    };
    render(<MessageCard message={msg} />);

    expect(screen.queryByText(/tokens/)).toBeNull();
  });
});

describe("compaction_start → compaction_end 完整流程", () => {
  it("手动压缩: start → end 后 status 回到 idle", () => {
    // 1. 初始状态
    expect(useSessionStore.getState().sessionStatusMap[SESSION_ID]).toBeUndefined();

    // 2. compaction_start
    handleAgentEvent(SESSION_ID, {
      type: "compaction_start",
      reason: "manual",
    } as AgentEvent);
    expect(useSessionStore.getState().sessionStatusMap[SESSION_ID]).toBe("compacting");

    // 3. compaction_end (无 streaming)
    handleAgentEvent(SESSION_ID, {
      type: "compaction_end",
      reason: "manual",
      result: { tokensAfter: 5000 },
      aborted: false,
    } as AgentEvent);

    // 4. status 回到 idle
    expect(useSessionStore.getState().sessionStatusMap[SESSION_ID]).toBe("idle");
  });

  it("自动压缩: start → end(streaming) → agent_end 后 status 回到 idle", () => {
    // 1. compaction_start
    handleAgentEvent(SESSION_ID, {
      type: "compaction_start",
      reason: "threshold",
    } as AgentEvent);
    expect(useSessionStore.getState().sessionStatusMap[SESSION_ID]).toBe("compacting");

    // 2. 添加 streaming 消息
    useChatStore.setState({
      messagesBySession: {
        [SESSION_ID]: [
          {
            id: "asst-1",
            role: "assistant",
            content: [{ type: "text", text: "..." }],
            timestamp: Date.now(),
            isStreaming: true,
          },
        ],
      },
    });

    // 3. compaction_end (有 streaming → defer)
    handleAgentEvent(SESSION_ID, {
      type: "compaction_end",
      reason: "threshold",
      result: { tokensAfter: 5000 },
      aborted: false,
    } as AgentEvent);

    // status 保持 compacting (deferred)
    expect(useSessionStore.getState().sessionStatusMap[SESSION_ID]).toBe("compacting");

    // 4. agent_end → 清 status
    handleAgentEvent(SESSION_ID, { type: "agent_end" } as AgentEvent);
    expect(useSessionStore.getState().sessionStatusMap[SESSION_ID]).toBe("idle");
  });
});
