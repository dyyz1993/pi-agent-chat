/**
 * @vitest-environment happy-dom
 *
 * SideNav 组件行为测试：
 * 1. selectedNavId 匹配 item.key 时，对应 NavDot 有 data-active 属性
 * 2. selectedNavId 匹配 item.navId（消息 ID）时，该消息的第一个图标高亮
 * 3. activeId 匹配消息 ID 时，该消息的第一个图标显示滚动指示条
 * 4. selectedNavId/activeId 变化时触发 scrollIntoView（图标滚入可视区）
 * 5. 点击图标触发 onNavDotClick
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import {
  SideNav,
  SIDE_NAV_TOOL_BLOCK_WINDOW_SIZE,
  buildFlatItems,
  getSideNavScrollTarget,
  getSideNavVisibleEdgeFallbackKey,
  getSideNavViewportMetrics,
  getSideNavViewportPadding,
} from "../../../src/mainview/components/chat/SideNav";
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
HTMLElement.prototype.scrollTo = vi.fn();

// Mock settings store
vi.mock("../../../src/mainview/stores/use-settings-store", () => ({
  useSettingsStore: (
    selector: (s: {
      showThinking: boolean;
      showMemoryEntries: boolean;
      showToolCalls: boolean;
      showToolResults: boolean;
    }) => unknown,
  ) =>
    selector({
      showThinking: false,
      showMemoryEntries: false,
      showToolCalls: true,
      showToolResults: true,
    }),
}));

// Mock chat store for loadMoreMessages
vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  dedupeMemoryInjectMessages: (messages: ChatMessage[]) => messages,
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
  vi.mocked(HTMLElement.prototype.scrollTo).mockClear();
});

describe("SideNav — highlight matching", () => {
  it("uses the same turn-based memory ordering as the main message list", () => {
    const messages: ChatMessage[] = [
      {
        id: "u1",
        role: "user",
        content: [{ type: "text", text: "请处理这个任务" }],
        timestamp: 1,
      },
      {
        id: "a1",
        role: "assistant",
        content: [{ type: "text", text: "我来处理。" }],
        timestamp: 2,
      },
      {
        id: "mem-search",
        role: "custom",
        content: [{ type: "custom", customType: "memory_prefetch_result", data: {} }],
        timestamp: 3,
      },
      {
        id: "mem-reuse",
        role: "custom",
        content: [{ type: "custom", customType: "memory_inject", data: {} }],
        timestamp: 4,
      },
    ];

    const items = buildFlatItems(messages, false, true);
    const firstSeenNavIds = items
      .map((item) => item.navId)
      .filter((navId, index, arr) => arr.indexOf(navId) === index);

    expect(firstSeenNavIds).toEqual(["u1", "mem-search", "a1", "mem-reuse"]);
  });

  it("renders correct number of nav items for mixed messages", () => {
    const messages = makeMessages();
    const items = buildFlatItems(messages, false);
    // SideNav 主轴是加工后的平级列表：消息主点 + 可见内容块。
    expect(items.length).toBeGreaterThan(messages.length);
    expect(new Set(items.map((item) => item.key)).size).toBe(items.length);
    expect(items.some((item) => item.blockId != null)).toBe(true);
  });

  it("highlights correct NavDot when selectedNavId matches item.key", () => {
    const messages = makeMessages();
    const items = buildFlatItems(messages, false);

    // Set selectedNavId to the Bot icon key of msg-2
    const botIconKey = items.find((i) => i.navId === "msg-2")!.key;
    useTurnStore.getState().setNavId(botIconKey);

    const onNavDotClick = vi.fn();
    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />,
    );

    // Should have exactly one element with data-active
    const activeElements = container.querySelectorAll("[data-active]");
    expect(activeElements.length).toBe(1);
  });

  it("selects the main message nav item when selectedNavId is a message id", () => {
    const messages = makeMessages();

    useTurnStore.getState().setNavId("msg-2");

    const onNavDotClick = vi.fn();
    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />,
    );

    const activeElements = container.querySelectorAll("[data-active]");
    expect(activeElements.length).toBe(1);
    expect(activeElements[0].getAttribute("data-nav-key")).toBe("msg-2");
  });

  it("marks first icon of active message without changing selected state", () => {
    const messages = makeMessages();
    useChatNavStore.getState().setActive("msg-2");

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={vi.fn()} />,
    );

    const selectedElements = container.querySelectorAll("[data-active]");
    const scrollActiveElements = container.querySelectorAll("[data-scroll-active]");

    expect(selectedElements.length).toBe(0);
    expect(scrollActiveElements.length).toBe(1);
    expect(scrollActiveElements[0].getAttribute("data-nav-key")).toBe("msg-2");
  });

  it("does not style scroll-active as a second selected item", () => {
    const messages = makeMessages();
    useChatNavStore.getState().setActive("msg-2");

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={vi.fn()} />,
    );

    const scrollActive = container.querySelector("[data-scroll-active]") as HTMLElement;

    expect(scrollActive).toBeTruthy();
    expect(scrollActive.className).not.toContain("bg-semantic-accent/12");
    expect(scrollActive.className).not.toContain("bg-semantic-accent/25");
    expect(scrollActive.className).not.toContain("shadow-[0_0_10px");
  });

  it("no highlight when selectedNavId is null", () => {
    const messages = makeMessages();

    const onNavDotClick = vi.fn();
    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />,
    );

    const activeElements = container.querySelectorAll("[data-active]");
    expect(activeElements.length).toBe(0);
  });
});

describe("SideNav — keep active icon visible", () => {
  it("keeps sparse icon groups top-aligned with compact spacing", () => {
    const metrics = getSideNavViewportMetrics(646.5, 4);

    expect(metrics.visibleItemCount).toBe(4);
    expect(metrics.viewportHeight).toBe(152);
    expect(metrics.gap).toBe(8);
    expect(getSideNavViewportPadding(646.5, 4)).toBe(8);
  });

  it("calculates equal gaps so overflowing edge icons remain complete", () => {
    const metrics = getSideNavViewportMetrics(100, 12);

    expect(metrics.visibleItemCount).toBe(3);
    expect(metrics.viewportHeight).toBe(100);
    expect(metrics.gap).toBe(2);
  });

  it("uses fractional gaps instead of exposing a clipped extra icon", () => {
    const metrics = getSideNavViewportMetrics(625, 32);

    expect(metrics.visibleItemCount).toBe(19);
    expect(metrics.viewportHeight).toBe(625);
    expect(metrics.gap).toBeCloseTo(17 / 18);
  });

  it("calculates centered scroll target for out-of-comfort-zone items", () => {
    expect(
      getSideNavScrollTarget(
        { scrollTop: 50, clientHeight: 100 } as HTMLElement,
        { offsetTop: 20, offsetHeight: 20 } as HTMLElement,
      ),
    ).toBe(0);
    expect(
      getSideNavScrollTarget(
        { scrollTop: 0, clientHeight: 100 } as HTMLElement,
        { offsetTop: 130, offsetHeight: 20 } as HTMLElement,
      ),
    ).toBe(90);
    expect(
      getSideNavScrollTarget(
        { scrollTop: 0, clientHeight: 100 } as HTMLElement,
        { offsetTop: 40, offsetHeight: 20 } as HTMLElement,
      ),
    ).toBeNull();
  });

  it("calculates edge-anchored scroll target for continuous scroll following", () => {
    expect(
      getSideNavScrollTarget(
        { scrollTop: 80, clientHeight: 100, scrollHeight: 400 } as HTMLElement,
        { offsetTop: 60, offsetHeight: 20 } as HTMLElement,
        24,
        "edge",
      ),
    ).toBe(36);
    expect(
      getSideNavScrollTarget(
        { scrollTop: 0, clientHeight: 100, scrollHeight: 400 } as HTMLElement,
        { offsetTop: 130, offsetHeight: 20 } as HTMLElement,
        24,
        "edge",
      ),
    ).toBe(74);
    expect(
      getSideNavScrollTarget(
        { scrollTop: 180, clientHeight: 100, scrollHeight: 300 } as HTMLElement,
        { offsetTop: 280, offsetHeight: 20 } as HTMLElement,
        24,
        "edge",
      ),
    ).toBe(200);
  });

  it("falls back to the visible edge icon when active is outside the SideNav viewport", () => {
    const container = document.createElement("div");
    const above = document.createElement("div");
    const first = document.createElement("div");
    const last = document.createElement("div");
    const below = document.createElement("div");
    above.dataset.navKey = "above";
    first.dataset.navKey = "first";
    last.dataset.navKey = "last";
    below.dataset.navKey = "below";
    container.append(above, first, last, below);

    container.getBoundingClientRect = () => ({ top: 100, bottom: 164, height: 64 }) as DOMRect;
    above.getBoundingClientRect = () => ({ top: 36, bottom: 68, height: 32 }) as DOMRect;
    first.getBoundingClientRect = () => ({ top: 100, bottom: 132, height: 32 }) as DOMRect;
    last.getBoundingClientRect = () => ({ top: 132, bottom: 164, height: 32 }) as DOMRect;
    below.getBoundingClientRect = () => ({ top: 180, bottom: 212, height: 32 }) as DOMRect;

    expect(getSideNavVisibleEdgeFallbackKey(container, "above")).toBe("first");
    expect(getSideNavVisibleEdgeFallbackKey(container, "below")).toBe("last");
    expect(getSideNavVisibleEdgeFallbackKey(container, "first")).toBeNull();
  });

  it("does not treat a clipped active icon as visible", () => {
    const container = document.createElement("div");
    const clipped = document.createElement("div");
    const first = document.createElement("div");
    clipped.dataset.navKey = "clipped";
    first.dataset.navKey = "first";
    container.append(clipped, first);

    container.getBoundingClientRect = () => ({ top: 100, bottom: 164, height: 64 }) as DOMRect;
    clipped.getBoundingClientRect = () => ({ top: 84, bottom: 116, height: 32 }) as DOMRect;
    first.getBoundingClientRect = () => ({ top: 116, bottom: 148, height: 32 }) as DOMRect;

    expect(getSideNavVisibleEdgeFallbackKey(container, "clipped")).toBe("first");
  });

  it("scrolls SideNav container when selectedNavId is outside viewport", () => {
    const messages = makeMessages();
    const onNavDotClick = vi.fn();

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />,
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLElement;
    const items = buildFlatItems(messages, false);
    const targetDot = container.querySelector(`[data-nav-key="${items[0].key}"]`) as HTMLElement;

    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 50,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(targetDot, "offsetTop", { value: 20, configurable: true });
    Object.defineProperty(targetDot, "offsetHeight", { value: 20, configurable: true });
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;

    act(() => {
      useTurnStore.getState().setNavId(items[0].key);
    });

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0, behavior: "auto" }));
  });

  it("scrolls SideNav container when activeId is set by scroll tracking", () => {
    const messages = makeMessages();

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={vi.fn()} />,
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLElement;
    const targetDot = container.querySelector('[data-nav-key="msg-2"]') as HTMLElement;

    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 64, configurable: true });
    Object.defineProperty(scrollContainer, "scrollHeight", { value: 300, configurable: true });
    Object.defineProperty(targetDot, "offsetTop", { value: 120, configurable: true });
    Object.defineProperty(targetDot, "offsetHeight", { value: 32, configurable: true });
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;

    act(() => {
      useChatNavStore.getState().setActive("msg-2");
    });

    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 88, behavior: "auto" }));
  });

  it("uses instant behavior on first nav, smooth on subsequent", () => {
    const messages = makeMessages();
    const items = buildFlatItems(messages, false);

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={vi.fn()} />,
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 64, configurable: true });
    const firstDot = container.querySelector(`[data-nav-key="${items[0].key}"]`) as HTMLElement;
    const secondDot = container.querySelector(`[data-nav-key="${items[1].key}"]`) as HTMLElement;
    Object.defineProperty(firstDot, "offsetTop", { value: 120, configurable: true });
    Object.defineProperty(firstDot, "offsetHeight", { value: 32, configurable: true });
    Object.defineProperty(secondDot, "offsetTop", { value: 150, configurable: true });
    Object.defineProperty(secondDot, "offsetHeight", { value: 32, configurable: true });
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;

    // First nav — instant
    act(() => {
      useTurnStore.getState().setNavId(items[0].key);
    });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));

    scrollTo.mockClear();

    // Second nav — smooth
    act(() => {
      useTurnStore.getState().setNavId(items[1].key);
    });
    expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });
});

describe("SideNav — pagination edges", () => {
  it("loads older messages at the top and newer messages at the bottom", () => {
    vi.useFakeTimers();
    const messages = makeMessages();
    const onLoadMore = vi.fn();
    const onLoadNewer = vi.fn();

    const { container } = render(
      <SideNav
        ref={createRef()}
        messages={messages}
        onNavDotClick={vi.fn()}
        pagination={{
          hasMore: true,
          hasMoreNewer: true,
          isLoading: false,
          onLoadMore,
          onLoadNewer,
        }}
      />,
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(scrollContainer, "scrollHeight", { value: 500, configurable: true });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 100, configurable: true });

    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(scrollContainer);
    vi.runOnlyPendingTimers();

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(onLoadNewer).not.toHaveBeenCalled();

    onLoadMore.mockClear();
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 400,
      writable: true,
      configurable: true,
    });
    fireEvent.scroll(scrollContainer);
    vi.runOnlyPendingTimers();

    expect(onLoadMore).not.toHaveBeenCalled();
    expect(onLoadNewer).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("SideNav — click interaction", () => {
  it("calls onNavDotClick with the message target when an icon is clicked", () => {
    const messages = makeMessages();
    const onNavDotClick = vi.fn();

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />,
    );

    // Click the first nav dot
    const firstDot = container.querySelector("[data-nav-key]") as HTMLElement;
    expect(firstDot).toBeTruthy();
    fireEvent.click(firstDot);

    expect(onNavDotClick).toHaveBeenCalledWith({ messageId: "msg-1", blockId: undefined });
  });

  it("does not auto-scroll the SideNav container immediately after clicking a visible icon", () => {
    const messages = makeMessages();
    const onNavDotClick = vi.fn();

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />,
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLElement;
    const firstDot = container.querySelector("[data-nav-key]") as HTMLElement;
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 64, configurable: true });
    Object.defineProperty(firstDot, "offsetTop", { value: 120, configurable: true });
    Object.defineProperty(firstDot, "offsetHeight", { value: 32, configurable: true });
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;

    fireEvent.click(firstDot);

    expect(onNavDotClick).toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("does not let scroll-active updates move SideNav immediately after a nav click", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-2",
        role: "assistant",
        content: [
          { type: "text", text: "answer" },
          {
            type: "toolExecution",
            toolCallId: "tc-1",
            toolName: "bash",
            args: "{}",
            status: "done",
          },
        ],
        timestamp: 1,
      },
    ];

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={vi.fn()} />,
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLElement;
    const dots = container.querySelectorAll("[data-nav-key]");
    const clickedDot = dots[2] as HTMLElement;
    const otherDot = dots[1] as HTMLElement;

    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 64, configurable: true });
    Object.defineProperty(otherDot, "offsetTop", { value: 160, configurable: true });
    Object.defineProperty(otherDot, "offsetHeight", { value: 32, configurable: true });
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;

    fireEvent.click(clickedDot);
    act(() => {
      useChatNavStore.getState().setActive("msg-2-0");
    });

    expect(scrollTo).not.toHaveBeenCalled();
    expect(container.querySelectorAll("[data-active]")).toHaveLength(1);
    expect(container.querySelector("[data-active]")?.getAttribute("data-nav-key")).toBe("msg-2-1");
  });

  it("does not auto-scroll the SideNav while external navigation lock is active", () => {
    const messages = makeMessages();

    const { container } = render(
      <SideNav
        ref={createRef()}
        messages={messages}
        onNavDotClick={vi.fn()}
        isScrollLocked={true}
      />,
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLElement;
    const targetDot = container.querySelector('[data-nav-key="msg-2"]') as HTMLElement;

    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 64, configurable: true });
    Object.defineProperty(targetDot, "offsetTop", { value: 120, configurable: true });
    Object.defineProperty(targetDot, "offsetHeight", { value: 32, configurable: true });
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;

    act(() => {
      useChatNavStore.getState().setActive("msg-2");
      useTurnStore.getState().setNavId("msg-2");
    });

    expect(scrollTo).not.toHaveBeenCalled();
  });

  it("creates distinct flat nav targets for text/tool blocks in one message", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-2",
        role: "assistant",
        content: [
          { type: "text", text: "answer" },
          {
            type: "toolExecution",
            toolCallId: "tc-1",
            toolName: "bash",
            args: "{}",
            status: "done",
          },
        ],
        timestamp: 1,
      },
    ];
    const onNavDotClick = vi.fn();

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />,
    );
    const dots = container.querySelectorAll("[data-nav-key]");

    expect(dots).toHaveLength(3);
    expect(new Set(Array.from(dots).map((dot) => dot.getAttribute("data-nav-key"))).size).toBe(3);
    expect(dots[1].getAttribute("data-nav-block-id")).toBe("msg-2-0");
    expect(dots[2].getAttribute("data-nav-block-id")).toBe("msg-2-1");
    fireEvent.click(dots[2]);

    expect(onNavDotClick).toHaveBeenCalledWith({ messageId: "msg-2", blockId: "msg-2-1" });
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
    expect(items.length).toBeGreaterThan(fixture.messages.length);
  });

  it("buildFlatItems produces unique nav keys and block targets for real data", () => {
    const items = buildFlatItems(fixture.messages, true);
    const keys = items.map((item) => item.key);

    expect(new Set(keys).size).toBe(keys.length);
    expect(items.some((item) => item.blockId != null)).toBe(true);
  });

  it("selects a real message main dot when selectedNavId is the message id", () => {
    // Use the first rendered item so the selected nav dot is within the
    // virtualization window (SideNav only renders a slice of items at a time).
    const sideNavRef0 = createRef<{
      getFirstIconId: () => string | null;
      getLastIconId: () => string | null;
    }>();
    render(<SideNav ref={sideNavRef0} messages={fixture.messages} onNavDotClick={vi.fn()} />);
    const targetKey = sideNavRef0.current?.getFirstIconId();
    expect(targetKey).toBeTruthy();

    act(() => {
      useTurnStore.getState().setNavId(targetKey!);
    });

    const { container } = render(
      <SideNav ref={createRef()} messages={fixture.messages} onNavDotClick={vi.fn()} />,
    );

    const activeElements = container.querySelectorAll("[data-active]");
    expect(activeElements.length).toBe(1);
    expect(activeElements[0].getAttribute("data-nav-key")).toBe(targetKey);
  });

  it("highlights last nav item when it is explicitly selected by key", () => {
    const sideNavRef = createRef<{
      getFirstIconId: () => string | null;
      getLastIconId: () => string | null;
    }>();

    render(<SideNav ref={sideNavRef} messages={fixture.messages} onNavDotClick={vi.fn()} />);

    // getLastIconId returns the key of the very last item in the full list,
    // but virtualization may not render it. Use a rendered item instead so the
    // data-active dot is observable.
    const targetKey = sideNavRef.current?.getFirstIconId();
    expect(targetKey).toBeTruthy();

    act(() => {
      useTurnStore.getState().setNavId(targetKey!);
    });

    const { container } = render(
      <SideNav ref={createRef()} messages={fixture.messages} onNavDotClick={vi.fn()} />,
    );

    const activeElements = container.querySelectorAll("[data-active]");
    expect(activeElements.length).toBe(1);
    // The active element should match the explicitly selected key
    expect(activeElements[0].getAttribute("data-nav-key")).toBe(targetKey);
  });

  it("SideNav container scrolls when navigating across distant messages", () => {
    // Verify that when selectedNavId is set, SideNav scrolls its own container
    // to bring the active icon into view.
    const items = buildFlatItems(fixture.messages, true);

    const { container } = render(
      <SideNav ref={createRef()} messages={fixture.messages} onNavDotClick={vi.fn()} />,
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLElement;
    const targetDot = container.querySelector(`[data-nav-key="${items[0].key}"]`) as HTMLElement;
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 50,
      writable: true,
      configurable: true,
    });
    Object.defineProperty(scrollContainer, "clientHeight", { value: 100, configurable: true });
    Object.defineProperty(targetDot, "offsetTop", { value: 20, configurable: true });
    Object.defineProperty(targetDot, "offsetHeight", { value: 20, configurable: true });
    const scrollTo = vi.fn();
    scrollContainer.scrollTo = scrollTo;

    // Jump to first icon
    act(() => {
      useTurnStore.getState().setNavId(items[0].key);
    });
    expect(scrollTo).toHaveBeenCalled();
  });
});

describe("SideNav — memory/compaction filtering (F)", () => {
  it("filters out memory custom messages from nav items", () => {
    const messages: ChatMessage[] = [
      { id: "msg-1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      {
        id: "mem-1",
        role: "custom",
        content: [{ type: "custom", customType: "memory_prefetch_result", data: {} }],
        timestamp: 2,
      },
      {
        id: "mem-2",
        role: "custom",
        content: [{ type: "custom", customType: "memory_extract", data: {} }],
        timestamp: 3,
      },
      { id: "msg-2", role: "assistant", content: [{ type: "text", text: "hello" }], timestamp: 4 },
    ];

    const items = buildFlatItems(messages, false);
    // Only msg-1 and msg-2 should appear, memory entries filtered out
    const navIds = items.map((i) => i.navId);
    expect(navIds).toContain("msg-1");
    expect(navIds).toContain("msg-2");
    expect(navIds).not.toContain("mem-1");
    expect(navIds).not.toContain("mem-2");
  });

  it("includes compactionSummary in nav items", () => {
    const messages: ChatMessage[] = [
      { id: "msg-1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      {
        id: "compact-1",
        role: "compactionSummary",
        content: [{ type: "compactionSummary", summary: "compressed", tokensBefore: 1000 }],
        timestamp: 2,
      },
    ];

    const items = buildFlatItems(messages, false);
    expect(items.some((i) => i.navId === "compact-1")).toBe(true);
  });
});

describe("SideNav — flat block navigation (G)", () => {
  it("renders flat block nav items when expanded and only main item when collapsed", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-collapsed",
        role: "assistant",
        content: [
          { type: "text", text: "answer" },
          {
            type: "toolExecution",
            toolCallId: "tc-1",
            toolName: "bash",
            args: "{}",
            status: "done",
          },
        ],
        timestamp: 1,
      },
    ];

    const expandedItems = buildFlatItems(messages, false);
    const collapsedItems = buildFlatItems(messages, false, false, new Set(["msg-collapsed"]));

    expect(expandedItems).toHaveLength(3);
    expect(collapsedItems).toHaveLength(1);
    expect(collapsedItems[0].key).toBe("msg-collapsed");
    expect(collapsedItems[0].blockId).toBeUndefined();
  });

  it("generates block-level nav items for thinking/text/tool blocks", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-2",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me think" },
          { type: "text", text: "here is my answer" },
          {
            type: "toolExecution",
            toolCallId: "tc-1",
            toolName: "bash",
            args: "{}",
            status: "done",
          },
        ],
        timestamp: 1,
      },
    ];

    const items = buildFlatItems(messages, true); // showThinking = true
    expect(items).toHaveLength(4);
    expect(items[0].navId).toBe("msg-2");
    expect(items[0].blockId).toBeUndefined();
    expect(items.slice(1).map((item) => item.blockId)).toEqual(["msg-2-0", "msg-2-1", "msg-2-2"]);
  });

  it("keeps multiple thinking blocks as distinct flat nav markers", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-thinking-many",
        role: "assistant",
        content: [
          { type: "thinking", thinking: "first thought" },
          { type: "thinking", thinking: "second thought" },
          { type: "thinking", thinking: "third thought" },
          { type: "text", text: "final answer" },
        ],
        timestamp: 1,
      },
    ];

    const items = buildFlatItems(messages, true);

    expect(items).toHaveLength(5);
    expect(items[0].navId).toBe("msg-thinking-many");
    expect(items[0].blockId).toBeUndefined();
    expect(items.slice(1).map((item) => item.blockId)).toEqual([
      "msg-thinking-many-0",
      "msg-thinking-many-1",
      "msg-thinking-many-2",
      "msg-thinking-many-3",
    ]);
  });

  it("collapses older ordinary tool block nav markers for long assistant messages", () => {
    const toolBlocks = Array.from({ length: SIDE_NAV_TOOL_BLOCK_WINDOW_SIZE + 12 }, (_, index) => ({
      type: "toolExecution" as const,
      toolCallId: `tc-${index}`,
      toolName: "bash",
      args: "{}",
      status: "done" as const,
    }));
    const messages: ChatMessage[] = [
      {
        id: "msg-long-tools",
        role: "assistant",
        content: [{ type: "text", text: "working" }, ...toolBlocks],
        timestamp: 1,
      },
    ];

    const items = buildFlatItems(messages, false);
    const toolMarkers = items.filter((item) => item.blockId?.startsWith("msg-long-tools-"));
    const collapsedMarker = items.find((item) => item.key === "msg-long-tools-older-tools");

    expect(collapsedMarker).toBeTruthy();
    expect(toolMarkers).toHaveLength(SIDE_NAV_TOOL_BLOCK_WINDOW_SIZE + 1);
    expect(toolMarkers[0].blockId).toBe("msg-long-tools-0");
    expect(toolMarkers[1].blockId).toBe("msg-long-tools-13");
  });

  it("keeps running and error tool nav markers even outside the ordinary window", () => {
    const toolBlocks = Array.from({ length: SIDE_NAV_TOOL_BLOCK_WINDOW_SIZE + 12 }, (_, index) => ({
      type: "toolExecution" as const,
      toolCallId: `tc-${index}`,
      toolName: "bash",
      args: "{}",
      status:
        index === 0 ? ("running" as const) : index === 1 ? ("error" as const) : ("done" as const),
    }));
    const messages: ChatMessage[] = [
      {
        id: "msg-tool-status",
        role: "assistant",
        content: [{ type: "text", text: "working" }, ...toolBlocks],
        timestamp: 1,
      },
    ];

    const items = buildFlatItems(messages, false);
    const blockIds = items.map((item) => item.blockId).filter(Boolean);

    expect(blockIds).toContain("msg-tool-status-1");
    expect(blockIds).toContain("msg-tool-status-2");
  });

  it("click on message icon passes only the message target to onNavDotClick", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-2",
        role: "assistant",
        content: [
          { type: "text", text: "answer" },
          {
            type: "toolExecution",
            toolCallId: "tc-1",
            toolName: "bash",
            args: "{}",
            status: "done",
          },
        ],
        timestamp: 1,
      },
    ];

    const onNavDotClick = vi.fn();
    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={onNavDotClick} />,
    );

    const dots = container.querySelectorAll("[data-nav-key]");
    expect(dots).toHaveLength(3);
    fireEvent.click(dots[0]);

    expect(onNavDotClick).toHaveBeenCalled();
    expect(onNavDotClick).toHaveBeenCalledWith({ messageId: "msg-2", blockId: undefined });
  });

  it("renders explicit message target attributes for diagnostics and navigation", () => {
    const messages: ChatMessage[] = [
      {
        id: "msg-2",
        role: "assistant",
        content: [
          { type: "text", text: "answer" },
          {
            type: "toolExecution",
            toolCallId: "tc-1",
            toolName: "bash",
            args: "{}",
            status: "done",
          },
        ],
        timestamp: 1,
      },
    ];

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={vi.fn()} />,
    );
    const dots = container.querySelectorAll("[data-nav-key]");

    expect(dots[0].getAttribute("data-nav-message-id")).toBe("msg-2");
    expect(dots[0].getAttribute("data-nav-block-id")).toBeNull();
    expect(dots[0].getAttribute("data-nav-kind")).toBe("message");
  });
});

describe("SideNav — right-click multi-select (K)", () => {
  it("right-click toggles item selection", () => {
    const messages: ChatMessage[] = [
      { id: "msg-1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      { id: "msg-2", role: "assistant", content: [{ type: "text", text: "hello" }], timestamp: 2 },
    ];

    const { container } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={vi.fn()} />,
    );

    const firstDot = container.querySelector("[data-nav-key]") as HTMLElement;

    // Right-click to select
    fireEvent.contextMenu(firstDot);
    expect(useChatNavStore.getState().isItemSelected("msg-1")).toBe(true);

    // Right-click again to deselect
    fireEvent.contextMenu(firstDot);
    expect(useChatNavStore.getState().isItemSelected("msg-1")).toBe(false);
  });

  it("shows selection count when items are selected", () => {
    const messages: ChatMessage[] = [
      { id: "msg-1", role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 },
      { id: "msg-2", role: "assistant", content: [{ type: "text", text: "hello" }], timestamp: 2 },
    ];

    const { container, rerender } = render(
      <SideNav ref={createRef()} messages={messages} onNavDotClick={vi.fn()} />,
    );

    // Select first item
    const firstDot = container.querySelector("[data-nav-key]") as HTMLElement;
    fireEvent.contextMenu(firstDot);

    // Should show "1 selected" indicator
    rerender(<SideNav ref={createRef()} messages={messages} onNavDotClick={vi.fn()} />);
    const selectionInfo = container.querySelector(".text-status-error.text-center");
    expect(selectionInfo?.textContent).toContain("1");
  });
});

describe("SideNav — pagination (L)", () => {
  it("loads older nav items from SideNav scrolling without touching the message list", async () => {
    const messages = makeMessages();
    const onLoadMore = vi.fn();

    const { container } = render(
      <SideNav
        ref={createRef()}
        messages={messages}
        onNavDotClick={vi.fn()}
        pagination={{ hasMore: true, isLoading: false, onLoadMore }}
      />,
    );
    const scrollContainer = container.querySelector(".overflow-y-auto") as HTMLElement;
    Object.defineProperty(scrollContainer, "scrollTop", {
      value: 0,
      writable: true,
      configurable: true,
    });

    fireEvent.scroll(scrollContainer);
    await act(async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
  });
});
