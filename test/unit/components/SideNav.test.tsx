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
