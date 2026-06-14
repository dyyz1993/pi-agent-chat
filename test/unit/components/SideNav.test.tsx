/**
 * @vitest-environment happy-dom
 *
 * SideNav 组件行为测试：
 * 1. selectedNavId 匹配 item.key 时，对应 NavDot 有 data-active 属性
 * 2. selectedNavId 匹配 item.navId（消息 ID）时，该消息的第一个图标高亮
 * 3. selectedNavId 变化时触发 scrollIntoView（图标滚入可视区）
 * 4. 点击图标触发 onNavDotClick
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { SideNav, buildFlatItems } from "../../../src/mainview/components/chat/SideNav";
import { useTurnStore } from "../../../src/mainview/stores/use-turn-store";
import { useChatNavStore } from "../../../src/mainview/stores/use-chat-nav-store";
import type { ChatMessage } from "../../../src/mainview/types";

// Mock stores dependency — must be a callable hook (Zustand style)
const mockActiveSessionId = { current: "test-session" };
vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (selector: (s: { activeSessionId: string | null }) => unknown) =>
      selector({ activeSessionId: mockActiveSessionId.current }),
    {
      getState: () => ({ activeSessionId: mockActiveSessionId.current }),
      subscribe: vi.fn(),
    },
  ),
}));

// Mock scrollIntoView (not available in happy-dom)
Element.prototype.scrollIntoView = vi.fn();

// Mock settings store
vi.mock("../../../src/mainview/stores/use-settings-store", () => ({
  useSettingsStore: () => false, // showThinking = false
}));

// Mock chat store for loadMoreMessages
vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: () => vi.fn(() => false),
}));

// Test data: 3 user + 3 assistant messages
function makeMessages(): ChatMessage[] {
  return [
    {
      id: "msg-1",
      role: "user",
      content: [{ type: "text", text: "Hello" }],
      timestamp: 1,
    },
    {
      id: "msg-2",
      role: "assistant",
      content: [
        { type: "text", text: "Hi there" },
        { type: "toolExecution", toolCallId: "tc-1", toolName: "bash", args: "{}", status: "done" },
      ],
      timestamp: 2,
    },
    {
      id: "msg-3",
      role: "user",
      content: [{ type: "text", text: "How are you?" }],
      timestamp: 3,
    },
    {
      id: "msg-4",
      role: "assistant",
      content: [{ type: "text", text: "I'm good" }],
      timestamp: 4,
    },
  ];
}

beforeEach(() => {
  // Reset stores
  useTurnStore.setState({
    selectedMessageIdsBySession: {},
    collapsedMessageIdsBySession: {},
    isMultiSelectModeBySession: {},
    selectedNavIdBySession: {},
    navAnchorBySession: {},
  });
  useChatNavStore.setState({
    activeIdBySession: {},
    selectedItemsBySession: {},
    selectedTurnsBySession: {},
    batchModeBySession: {},
    pendingActionBySession: {},
    collapsedTurnsBySession: {},
    rollbackOverlayOpen: false,
    rollbackOverlayType: null,
    rollbackTargetItemId: null,
  });
  vi.mocked(Element.prototype.scrollIntoView).mockClear();
});

describe("SideNav — highlight matching", () => {
  it("renders correct number of nav items for mixed messages", () => {
    const messages = makeMessages();
    const items = buildFlatItems(messages, false);
    // msg-1: User icon
    // msg-2: Bot icon + text block + tool block = 3 items
    // msg-3: User icon
    // msg-4: Bot icon + text block = 2 items
    // Total: 1 + 3 + 1 + 2 = 7
    expect(items.length).toBe(7);
  });

  it("highlights correct NavDot when selectedNavId matches item.key", () => {
    const messages = makeMessages();
    const items = buildFlatItems(messages, false);

    // Set selectedNavId to the Bot icon key of msg-2
    const botIconKey = items.find((i) => i.navId === "msg-2")!.key;
    useTurnStore.getState().setNavId(botIconKey);

    const onNavDotClick = vi.fn();
    const { container } = render(<SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />);

    // Should have exactly one element with data-active
    const activeElements = container.querySelectorAll("[data-active]");
    expect(activeElements.length).toBe(1);
  });

  it("highlights first icon of message when selectedNavId is a message ID (navId match)", () => {
    const messages = makeMessages();

    // Set selectedNavId to message ID (what the scroll tracker bridge does)
    useTurnStore.getState().setNavId("msg-2");

    const onNavDotClick = vi.fn();
    const { container } = render(<SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />);

    // The fallback logic: selectedNavId === item.navId → highlight first item of that message
    const activeElements = container.querySelectorAll("[data-active]");
    expect(activeElements.length).toBe(1);
  });

  it("no highlight when selectedNavId is null", () => {
    const messages = makeMessages();

    const onNavDotClick = vi.fn();
    const { container } = render(<SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />);

    const activeElements = container.querySelectorAll("[data-active]");
    expect(activeElements.length).toBe(0);
  });
});

describe("SideNav — scrollIntoView on selectedNavId change", () => {
  it("calls scrollIntoView when selectedNavId is set", () => {
    const messages = makeMessages();
    const onNavDotClick = vi.fn();

    render(<SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />);

    // Initially no scrollIntoView
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    // Set selectedNavId — must wrap in act for React to process the effect
    const items = buildFlatItems(messages, false);
    act(() => {
      useTurnStore.getState().setNavId(items[0].key);
    });

    // scrollIntoView should be called to bring the active icon into view
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });

  it("uses instant behavior on first nav, smooth on subsequent", () => {
    const messages = makeMessages();
    const items = buildFlatItems(messages, false);

    render(<SideNav ref={createRef()} messages={messages} onNavDotClick={vi.fn()} />);

    // First nav — instant
    act(() => {
      useTurnStore.getState().setNavId(items[0].key);
    });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "instant" }),
    );

    vi.mocked(Element.prototype.scrollIntoView).mockClear();

    // Second nav — smooth
    act(() => {
      useTurnStore.getState().setNavId(items[1].key);
    });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });
});

describe("SideNav — click interaction", () => {
  it("calls onNavDotClick with navId when icon is clicked", () => {
    const messages = makeMessages();
    const onNavDotClick = vi.fn();

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />,
    );

    // Click the first nav dot
    const firstDot = container.querySelector("[data-nav-key]") as HTMLElement;
    expect(firstDot).toBeTruthy();
    fireEvent.click(firstDot);

    expect(onNavDotClick).toHaveBeenCalledWith("msg-1");
  });
});

describe("SideNav — real session data fixture", () => {
  /**
   * 使用从真实 JSONL 会话提取的消息数据（经过完整映射链路：
   * getFullMessages → messageToChatMessage → normalizeToolBlocks）。
   *
   * 数据来源: ~/.pi/agent/sessions/.../4bb95113-...jsonl
   * 提取后: 147 条消息，包含 thinking/text/toolExecution(read/bash/edit/write/todo 等)
   */

  // Load real fixture
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fixture = require("../../fixtures/real-session-messages.json") as {
    messages: ChatMessage[];
    messageCount: number;
  };

  it("fixture has realistic message count (>50)", () => {
    expect(fixture.messageCount).toBeGreaterThan(50);
  });

  it("buildFlatItems produces reasonable nav items for real data", () => {
    const items = buildFlatItems(fixture.messages, true); // showThinking = true
    // Each message produces at least 1 nav item; many produce multiple (thinking + text + tool blocks)
    expect(items.length).toBeGreaterThan(fixture.messages.length);
  });

  it("highlights correct icon when scrolling through real messages", () => {
    // Simulate what the scroll tracker does: set selectedNavId to a message ID
    // Pick a message ID from the middle of the conversation
    const midMessage = fixture.messages[Math.floor(fixture.messages.length / 2)];
    const midMsgId = midMessage.id;

    // Set selectedNavId to this message ID (what ChatPanel bridge does on scroll)
    useTurnStore.getState().setNavId(midMsgId);

    const { container } = render(
      <SideNav ref={createRef()} messages={fixture.messages} onNavDotClick={vi.fn()} />,
    );

    // Should highlight exactly one icon (the first icon of that message)
    const activeElements = container.querySelectorAll("[data-active]");
    expect(activeElements.length).toBe(1);
  });

  it("highlights last message icon after initial scroll to bottom", () => {
    // Simulate onInitComplete: set selectedNavId to last icon key
    // Use the SideNav's own ref to get the last icon id (avoids showThinking mismatch)
    const sideNavRef = createRef<{ getFirstIconId: () => string | null; getLastIconId: () => string | null }>();

    render(<SideNav ref={sideNavRef} messages={fixture.messages} onNavDotClick={vi.fn()} />);

    const lastIconKey = sideNavRef.current?.getLastIconId();
    expect(lastIconKey).toBeTruthy();

    act(() => {
      useTurnStore.getState().setNavId(lastIconKey!);
    });

    const { container } = render(
      <SideNav ref={createRef()} messages={fixture.messages} onNavDotClick={vi.fn()} />,
    );

    const activeElements = container.querySelectorAll("[data-active]");
    expect(activeElements.length).toBe(1);
    // The active element should be the last nav dot
    const allDots = container.querySelectorAll("[data-nav-key]");
    expect(activeElements[0]).toBe(allDots[allDots.length - 1]);
  });

  it("scrollIntoView fires when navigating across distant messages", () => {
    // Verify that when selectedNavId is set, scrollIntoView is called
    // to bring the active icon into view
    const items = buildFlatItems(fixture.messages, true);

    render(<SideNav ref={createRef()} messages={fixture.messages} onNavDotClick={vi.fn()} />);

    // Jump to first icon
    act(() => {
      useTurnStore.getState().setNavId(items[0].key);
    });
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
  });
});
