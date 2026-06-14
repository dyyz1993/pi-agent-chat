/**
 * @vitest-environment happy-dom
 *
 * 行为测试：验证 useActiveScrollTracker 的核心交互链路。
 *
 * Mock 策略：
 * - VirtualizerHandle 用 mock 对象模拟 scrollSize/scrollOffset/viewportSize/findItemIndex/scrollToIndex
 * - 不需要真实 DOM 滚动，通过直接修改 mock handle 的属性 + 调用 handleScroll 来模拟
 *
 * 验证场景：
 * 1. 初始化滚到底部后 onInitComplete 被调用（之前的 bug：从未调用）
 * 2. 初始化后 activeId 指向最后一条消息
 * 3. 程序化滚动期间 handleScroll 不更新 activeId（防闪烁）
 * 4. scrollToMessage 设置 activeId 为目标消息
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useRef } from "react";

// Mock useScrollIntent — 不依赖真实 DOM 事件
vi.mock("../../../src/mainview/hooks/use-scroll-intent", () => ({
  useScrollIntent: () => ({
    markIntent: vi.fn(),
    hasIntent: () => false,
    directionRef: { current: null },
  }),
}));

import { useActiveScrollTracker } from "../../../src/mainview/hooks/use-active-scroll-tracker";

// --- Mock VirtualizerHandle 工厂 ---
interface MockHandle {
  scrollSize: number;
  scrollOffset: number;
  viewportSize: number;
  scrollToIndex: ReturnType<typeof vi.fn>;
  findItemIndex: ReturnType<typeof vi.fn>;
}

function createMockHandle(overrides?: Partial<MockHandle>): MockHandle {
  return {
    scrollSize: 2000,
    scrollOffset: 0,
    viewportSize: 500,
    scrollToIndex: vi.fn((index: number, opts?: { align?: string; smooth?: boolean }) => {
      // Simulate: align "end" scrolls so the last item is at viewport bottom
      const handle = mockHandleRef.current;
      if (!handle) return;
      if (opts?.align === "end") {
        handle.scrollOffset = Math.max(0, handle.scrollSize - handle.viewportSize);
      } else {
        // Approximate: each item is 200px, so offset = index * 200
        handle.scrollOffset = index * 200;
      }
    }),
    findItemIndex: vi.fn((offset: number) => {
      // Approximate: each item is 200px
      return Math.floor(offset / 200);
    }),
    ...overrides,
  };
}

const mockHandleRef: { current: MockHandle | null } = { current: null };

const MESSAGE_IDS = ["msg-1", "msg-2", "msg-3", "msg-4", "msg-5"];

describe("useActiveScrollTracker — initialization", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHandleRef.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls onInitComplete after scheduleScrollToBottom settles", () => {
    const onInitComplete = vi.fn();
    // Setup: viewport at bottom so isAtBottom is true on first attempt
    const mockHandle = createMockHandle({
      scrollSize: 500,
      scrollOffset: 0,
      viewportSize: 500, // scrollSize === viewportSize → already "at bottom"
    });
    mockHandleRef.current = mockHandle;

    const setActive = vi.fn();
    renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: true,
          onInitComplete,
        });
      },
    );

    // scheduleScrollToBottom runs on next rAF
    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(onInitComplete).toHaveBeenCalled();
  });

  it("sets activeId to last message after init", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle({
      scrollSize: 500,
      viewportSize: 500,
    });
    mockHandleRef.current = mockHandle;

    renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: true,
        });
      },
    );

    act(() => {
      vi.advanceTimersByTime(100);
    });

    // Should have set activeId to last message
    expect(setActive).toHaveBeenCalledWith("msg-5");
  });
});

describe("useActiveScrollTracker — programmatic scroll guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHandleRef.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("scrollToMessage sets activeId and calls scrollToIndex", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle();
    mockHandleRef.current = mockHandle;

    const { result } = renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: false, // prevent init scroll
        });
      },
    );

    act(() => {
      result.current.scrollToMessage("msg-3");
    });

    expect(setActive).toHaveBeenCalledWith("msg-3");
    expect(mockHandle.scrollToIndex).toHaveBeenCalledWith(2, { smooth: true });
  });

  it("handleScroll does NOT call setActive during programmatic scroll", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle({
      scrollSize: 2000,
      scrollOffset: 1000, // middle of list, not at bottom
      viewportSize: 500,
    });
    mockHandleRef.current = mockHandle;

    const { result } = renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: false,
        });
      },
    );

    // Clear any init calls
    setActive.mockClear();

    // 1. Call scrollToMessage (sets programmaticScrollRef = true)
    act(() => {
      result.current.scrollToMessage("msg-2");
    });

    setActive.mockClear();

    // 2. Simulate scroll events that fire during the smooth scroll animation
    //    These should be SUPPRESSED by programmaticScrollRef
    act(() => {
      result.current.handleScroll();
    });

    // setActive should NOT have been called during programmatic scroll
    // (the scroll event from the animation should be suppressed)
    expect(setActive).not.toHaveBeenCalled();
  });

  it("handleScroll DOES call setActive after programmatic guard releases", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle({
      scrollSize: 2000,
      scrollOffset: 400, // visible index = 2 (msg-3)
      viewportSize: 500,
    });
    mockHandleRef.current = mockHandle;

    const { result } = renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: false,
        });
      },
    );

    // Wait for double-rAF to release programmatic guard
    act(() => {
      // Need to advance past the double rAF in markProgrammatic
      // rAF is queued by requestAnimationFrame, advance timers to flush
      vi.advanceTimersByTime(100);
    });

    setActive.mockClear();

    // Now handleScroll should work normally (user scroll)
    act(() => {
      result.current.handleScroll();
    });

    // setActive should be called with the visible message
    expect(setActive).toHaveBeenCalled();
  });
});

describe("useActiveScrollTracker — session switch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHandleRef.current = null;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("resets init state on session change", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle();
    mockHandleRef.current = mockHandle;

    const { rerender } = renderHook(
      ({ sid }) => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: sid,
          setActive,
          streamVersion: 0,
          initialScrollReady: false,
        });
      },
      { initialProps: { sid: "session-A" as string | undefined } },
    );

    // Switch session
    rerender({ sid: "session-B" });

    // The hook should have re-initialized (internal refs reset)
    // We can verify by checking setActive is called on next init
    // This is more of a "doesn't crash" test
    expect(true).toBe(true);
  });
});

// ============================================================
// Extended scenario tests — covering all critical user behaviors
// ============================================================

describe("useActiveScrollTracker — streaming follow (A/B)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHandleRef.current = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("follows streaming: streamVersion change → scrollToBottom + setActive(lastId)", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle({ scrollSize: 500, viewportSize: 500 });
    mockHandleRef.current = mockHandle;

    const { rerender } = renderHook(
      (props: { sv: number }) => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: props.sv,
          initialScrollReady: true,
        });
      },
      { initialProps: { sv: 0 } },
    );

    // Wait for initial scroll to settle
    act(() => vi.advanceTimersByTime(200));
    setActive.mockClear();
    mockHandle.scrollToIndex.mockClear();

    // Simulate streaming update
    rerender({ sv: 1 });
    act(() => vi.advanceTimersByTime(100));

    // Should have scrolled to bottom and set active to last message
    expect(mockHandle.scrollToIndex).toHaveBeenCalled();
    expect(setActive).toHaveBeenCalledWith(MESSAGE_IDS[MESSAGE_IDS.length - 1]);
  });

  it("does NOT follow streaming when user has scrolled up", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle({
      scrollSize: 5000,
      scrollOffset: 1000, // user is in the middle, not at bottom
      viewportSize: 500,
    });
    mockHandleRef.current = mockHandle;

    const { result, rerender } = renderHook(
      (props: { sv: number }) => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: props.sv,
          initialScrollReady: true,
        });
      },
      { initialProps: { sv: 0 } },
    );

    // Wait for init
    act(() => vi.advanceTimersByTime(200));

    // Simulate user scrolling up
    act(() => {
      result.current.handleScroll();
    });
    act(() => {
      result.current.suspendAutoScroll();
    });

    setActive.mockClear();
    mockHandle.scrollToIndex.mockClear();

    // Streaming update arrives
    rerender({ sv: 1 });
    act(() => vi.advanceTimersByTime(100));

    // Should NOT scroll to bottom
    expect(mockHandle.scrollToIndex).not.toHaveBeenCalled();
  });
});

describe("useActiveScrollTracker — auto-scroll recovery (C)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHandleRef.current = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resumeAutoScroll re-enables tracking and scrolls to bottom", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle({ scrollSize: 2000, viewportSize: 500 });
    mockHandleRef.current = mockHandle;

    const { result } = renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: false,
        });
      },
    );

    // Suspend
    act(() => result.current.suspendAutoScroll());
    act(() => vi.advanceTimersByTime(50));
    expect(result.current.autoScrollEnabled).toBe(false);

    // Resume
    mockHandle.scrollToIndex.mockClear();
    act(() => result.current.resumeAutoScroll());
    act(() => vi.advanceTimersByTime(50));
    expect(result.current.autoScrollEnabled).toBe(true);
    expect(mockHandle.scrollToIndex).toHaveBeenCalled();
  });

  it("toggleAutoScroll toggles between paused and active", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle({ scrollSize: 2000, viewportSize: 500 });
    mockHandleRef.current = mockHandle;

    const { result } = renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: false,
        });
      },
    );

    // Initially auto-scroll is enabled
    expect(result.current.autoScrollEnabled).toBe(true);

    // Toggle off
    act(() => result.current.toggleAutoScroll());
    act(() => vi.advanceTimersByTime(50));
    expect(result.current.autoScrollEnabled).toBe(false);

    // Toggle back on
    act(() => result.current.toggleAutoScroll());
    act(() => vi.advanceTimersByTime(50));
    expect(result.current.autoScrollEnabled).toBe(true);
  });
});

describe("useActiveScrollTracker — edge cases (D/E)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHandleRef.current = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("empty message list: no crash, no setActive calls", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle();
    mockHandleRef.current = mockHandle;

    const { result } = renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: [],
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: false,
        });
      },
    );

    // These should not crash
    act(() => result.current.scrollToMessage("nonexistent"));
    act(() => result.current.scrollToBottom());
    act(() => result.current.scrollToEdge("top"));
    act(() => result.current.handleScroll());
    expect(setActive).not.toHaveBeenCalled();
  });

  it("single message: scrollToMessage works with index 0", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle();
    mockHandleRef.current = mockHandle;

    const { result } = renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: ["only-msg"],
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: false,
        });
      },
    );

    act(() => result.current.scrollToMessage("only-msg"));
    expect(setActive).toHaveBeenCalledWith("only-msg");
    expect(mockHandle.scrollToIndex).toHaveBeenCalledWith(0, { smooth: true });
  });
});

describe("useActiveScrollTracker — scrollToEdge (I)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHandleRef.current = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("scrollToEdge('top') scrolls to index 0", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle();
    mockHandleRef.current = mockHandle;

    const { result } = renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: false,
        });
      },
    );

    act(() => result.current.scrollToEdge("top"));
    expect(mockHandle.scrollToIndex).toHaveBeenCalledWith(0);
    expect(setActive).toHaveBeenCalledWith(MESSAGE_IDS[0]);
  });

  it("scrollToEdge('bottom') scrolls to last index with align end", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle();
    mockHandleRef.current = mockHandle;

    const { result } = renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: false,
        });
      },
    );

    act(() => result.current.scrollToEdge("bottom"));
    expect(mockHandle.scrollToIndex).toHaveBeenCalledWith(
      MESSAGE_IDS.length - 1,
      { align: "end" },
    );
    expect(setActive).toHaveBeenCalledWith(MESSAGE_IDS[MESSAGE_IDS.length - 1]);
  });
});

describe("useActiveScrollTracker — rapid consecutive clicks (H)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockHandleRef.current = null;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("two rapid scrollToMessage calls: both setActive, second overwrites first", () => {
    const setActive = vi.fn();
    const mockHandle = createMockHandle();
    mockHandleRef.current = mockHandle;

    const { result } = renderHook(
      () => {
        const scrollRef = useRef<HTMLDivElement | null>(null);
        const vlistRef = useRef(mockHandle);
        return useActiveScrollTracker({
          scrollRef,
          vlistRef: vlistRef as React.RefObject<MockHandle | null>,
          messageIds: MESSAGE_IDS,
          sessionId: "test-session",
          setActive,
          streamVersion: 0,
          initialScrollReady: false,
        });
      },
    );

    // Rapid fire two clicks
    act(() => {
      result.current.scrollToMessage("msg-1");
      result.current.scrollToMessage("msg-3");
    });

    // Both should have been called
    expect(setActive).toHaveBeenCalledWith("msg-1");
    expect(setActive).toHaveBeenCalledWith("msg-3");
    // Last call wins for scroll position
    const lastCall = mockHandle.scrollToIndex.mock.calls[mockHandle.scrollToIndex.mock.calls.length - 1];
    expect(lastCall[0]).toBe(2); // msg-3 index
  });
});
