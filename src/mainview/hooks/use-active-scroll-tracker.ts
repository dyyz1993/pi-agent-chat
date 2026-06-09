import { useRef, useCallback, useEffect, useState } from "react";
import type { VirtualizerHandle } from "virtua";
import { useScrollIntent } from "./use-scroll-intent";

interface UseActiveScrollTrackerOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  vlistRef: React.RefObject<VirtualizerHandle | null>;
  messageIds: string[];
  sessionId: string | undefined;
  setActive: (id: string | null) => void;
  streamVersion: number;
  historyLoadVersion?: number;
  initialScrollReady?: boolean;
  onInitComplete?: () => void;
}

const BOTTOM_THRESHOLD_PX = 80;
const TOP_THRESHOLD_PX = 80;
const ACTIVE_THROTTLE_MS = 50;
const SCROLL_SETTLE_MAX_ATTEMPTS = 10;

export function useActiveScrollTracker({
  scrollRef,
  vlistRef,
  messageIds,
  sessionId,
  setActive,
  streamVersion,
  historyLoadVersion,
  initialScrollReady = true,
  onInitComplete: _onInitComplete,
}: UseActiveScrollTrackerOptions) {
  const userScrolledUpRef = useRef(false);
  const prevCountRef = useRef(0);
  const prevStreamRef = useRef(0);
  const lastActiveTimeRef = useRef(0);
  const lastActiveIdRef = useRef<string | null>(null);
  const didInitRef = useRef(false);
  const prevSessionRef = useRef(sessionId);
  const lastScrollTopRef = useRef(0);

  const isAtTopRef = useRef(true);
  const isAtBottomRef = useRef(true);
  const autoScrollEnabledRef = useRef(true);
  const messageIdsRef = useRef(messageIds);
  messageIdsRef.current = messageIds;

  // Unified scroll scheduler: single rAF slot for all scroll requests.
  // Ensures at most one scrollToIndex per animation frame.
  const scrollRafRef = useRef<number>(0);

  const [toolbarState, setToolbarState] = useState({
    isAtTop: false,
    isAtBottom: true,
    autoScrollEnabled: true,
  });

  const { markIntent } = useScrollIntent(scrollRef.current);

  const syncScheduledRef = useRef(false);
  const syncToolbarState = useCallback(() => {
    if (syncScheduledRef.current) return;
    syncScheduledRef.current = true;
    requestAnimationFrame(() => {
      syncScheduledRef.current = false;
      setToolbarState((prev) => {
        const top = isAtTopRef.current;
        const bottom = isAtBottomRef.current;
        const auto = autoScrollEnabledRef.current;
        if (prev.isAtTop === top && prev.isAtBottom === bottom && prev.autoScrollEnabled === auto)
          return prev;
        return { isAtTop: top, isAtBottom: bottom, autoScrollEnabled: auto };
      });
    });
  }, []);

  const isNearBottom = useCallback(() => {
    const handle = vlistRef.current;
    if (!handle) return true;
    return handle.scrollSize - handle.scrollOffset - handle.viewportSize < BOTTOM_THRESHOLD_PX;
  }, [vlistRef]);

  const isNearTop = useCallback(() => {
    const handle = vlistRef.current;
    if (!handle) return true;
    return handle.scrollOffset < TOP_THRESHOLD_PX;
  }, [vlistRef]);

  const findVisibleIndex = useCallback((): number => {
    const handle = vlistRef.current;
    if (!handle) return -1;
    return handle.findItemIndex(handle.scrollOffset + 1);
  }, [vlistRef]);

  const updateActiveFromScroll = useCallback(() => {
    const now = Date.now();
    if (now - lastActiveTimeRef.current < ACTIVE_THROTTLE_MS) return;
    lastActiveTimeRef.current = now;

    const ids = messageIdsRef.current;
    if (ids.length === 0) return;

    // 底部跟踪激活时，始终指向最后一条消息
    if (autoScrollEnabledRef.current) {
      const lastId = ids[ids.length - 1];
      if (lastId !== lastActiveIdRef.current) {
        lastActiveIdRef.current = lastId;
        setActive(lastId);
      }
      return;
    }

    const idx = findVisibleIndex();
    if (idx >= 0 && idx < ids.length) {
      const id = ids[idx];
      if (id !== lastActiveIdRef.current) {
        lastActiveIdRef.current = id;
        setActive(id);
      }
    }
  }, [findVisibleIndex, setActive]);

  /**
   * Unified scroll-to-bottom with settle retry.
   * Cancels any previously scheduled scroll first, ensuring only one
   * rAF callback is active at any time.
   */
  const scheduleScrollToBottom = useCallback(() => {
    const ids = messageIdsRef.current;
    if (ids.length === 0) return;
    if (userScrolledUpRef.current) return;

    // Cancel any pending scroll attempt
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
      scrollRafRef.current = 0;
    }

    let attempts = 0;

    const tryScroll = () => {
      const handle = vlistRef.current;
      if (!handle || attempts >= SCROLL_SETTLE_MAX_ATTEMPTS) {
        scrollRafRef.current = 0;
        return;
      }

      attempts++;
      handle.scrollToIndex(ids.length - 1, { align: "end" });

      const isAtBottom = handle.scrollSize - handle.scrollOffset - handle.viewportSize < 50;
      if (isAtBottom) {
        didInitRef.current = true;
        setActive(ids[ids.length - 1]);
        scrollRafRef.current = 0;
      } else if (attempts < SCROLL_SETTLE_MAX_ATTEMPTS) {
        scrollRafRef.current = requestAnimationFrame(tryScroll);
      } else {
        scrollRafRef.current = 0;
      }
    };

    scrollRafRef.current = requestAnimationFrame(tryScroll);
  }, [vlistRef, setActive]);

  const doScrollToBottom = useCallback(() => {
    const handle = vlistRef.current;
    const ids = messageIdsRef.current;
    if (!handle || ids.length === 0) return;
    if (userScrolledUpRef.current) return;
    handle.scrollToIndex(ids.length - 1, { align: "end" });
    setActive(ids[ids.length - 1]);
  }, [vlistRef, setActive]);

  const scrollToMessage = useCallback(
    (msgId: string) => {
      const handle = vlistRef.current;
      const ids = messageIdsRef.current;
      if (!handle) return;
      const index = ids.indexOf(msgId);
      if (index === -1) return;

      setActive(msgId);
      handle.scrollToIndex(index, { smooth: true });

      if (msgId === ids[ids.length - 1]) {
        userScrolledUpRef.current = false;
      }
    },
    [vlistRef, setActive],
  );

  const handleScroll = useCallback(() => {
    updateActiveFromScroll();
    const nearBottom = isNearBottom();
    const nearTop = isNearTop();
    isAtTopRef.current = nearTop;
    isAtBottomRef.current = nearBottom;

    const handle = vlistRef.current;
    if (handle) {
      const delta = handle.scrollOffset - lastScrollTopRef.current;
      lastScrollTopRef.current = handle.scrollOffset;

      if (delta < -3 && autoScrollEnabledRef.current) {
        // During init phase, Virtualizer layout corrections cause false-negative
        // deltas that would mistakenly disable tracking. Only disable after init.
        if (didInitRef.current) {
          autoScrollEnabledRef.current = false;
          userScrolledUpRef.current = true;
        }
      } else if (nearBottom && !autoScrollEnabledRef.current && delta > 5) {
        autoScrollEnabledRef.current = true;
        userScrolledUpRef.current = false;
      }
    }

    syncToolbarState();
  }, [updateActiveFromScroll, isNearBottom, isNearTop, syncToolbarState, vlistRef]);

  const handleScrollEnd = useCallback(() => {
    const nearBottom = isNearBottom();
    if (nearBottom) {
      userScrolledUpRef.current = false;
      autoScrollEnabledRef.current = true;
    }
    syncToolbarState();
  }, [isNearBottom, syncToolbarState]);

  // Reset state on session change
  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
      // Cancel any pending scroll from previous session
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
      didInitRef.current = false;
      userScrolledUpRef.current = false;
      prevCountRef.current = 0;
      prevStreamRef.current = 0;
      isAtTopRef.current = false;
      isAtBottomRef.current = true;
      autoScrollEnabledRef.current = true;
      lastScrollTopRef.current = 0;
      lastActiveIdRef.current = null;
      syncToolbarState();
    }
  }, [sessionId, syncToolbarState]);

  // Unified initial scroll: triggered once when messages are first ready.
  // Uses scheduleScrollToBottom which cancels previous attempts, so
  // loadSessionMessages → replayHoldEvents → _backgroundRefreshMessages
  // don't create competing scroll chains.
  useEffect(() => {
    if (!initialScrollReady) return;
    if (messageIds.length === 0) return;
    // Only trigger if not yet initialized
    if (didInitRef.current) return;

    setActive(messageIds[messageIds.length - 1]);
    scheduleScrollToBottom();

    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
    };
  }, [initialScrollReady, messageIds, scheduleScrollToBottom, setActive]);

  // historyLoadVersion effect: scroll to bottom when new messages are loaded
  // (loadSessionMessages / _backgroundRefreshMessages), but don't reset didInitRef.
  useEffect(() => {
    if (!initialScrollReady) return;
    if (historyLoadVersion === undefined || historyLoadVersion === 0) return;

    if (!userScrolledUpRef.current) {
      const handle = vlistRef.current;
      const isAlreadyAtBottom = handle
        ? handle.scrollSize - handle.scrollOffset - handle.viewportSize < 50
        : false;

      // Already at bottom and init done — nothing to do
      if (isAlreadyAtBottom && didInitRef.current) {
        prevCountRef.current = messageIds.length;
        return;
      }
    }
    prevCountRef.current = messageIds.length;

    if (messageIds.length > 0) {
      setActive(messageIds[messageIds.length - 1]);
    }

    if (!userScrolledUpRef.current) {
      scheduleScrollToBottom();
    }
  }, [initialScrollReady, historyLoadVersion, vlistRef, messageIds, setActive, scheduleScrollToBottom]);

  // Stream version effect: follow streaming updates with rAF dedup.
  // Each streamVersion change cancels the previous rAF, so at most one
  // scrollToIndex executes per frame regardless of how many events arrive.
  useEffect(() => {
    if (streamVersion === 0 || streamVersion === prevStreamRef.current) return;
    prevStreamRef.current = streamVersion;
    if (userScrolledUpRef.current) return;
    if (!didInitRef.current) return; // Don't compete with initial scroll settle

    // Dedup: cancel previous rAF, schedule new one
    if (scrollRafRef.current) {
      cancelAnimationFrame(scrollRafRef.current);
    }
    scrollRafRef.current = requestAnimationFrame(() => {
      scrollRafRef.current = 0;
      doScrollToBottom();
    });
  }, [streamVersion, doScrollToBottom]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
      }
    };
  }, []);

  const scrollToEdge = useCallback(
    (edge: "top" | "bottom") => {
      const handle = vlistRef.current;
      if (!handle) return;
      const ids = messageIdsRef.current;
      if (ids.length === 0) return;

      // Cancel any pending scroll
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }

      if (edge === "top") {
        handle.scrollToIndex(0);
      } else {
        handle.scrollToIndex(ids.length - 1, { align: "end" });
      }

      requestAnimationFrame(() => {
        const nearTop = handle.scrollOffset < TOP_THRESHOLD_PX;
        const nearBottom =
          handle.scrollSize - handle.scrollOffset - handle.viewportSize < BOTTOM_THRESHOLD_PX;
        isAtTopRef.current = edge === "top" || nearTop;
        isAtBottomRef.current = edge === "bottom" || nearBottom;
        userScrolledUpRef.current = !(edge === "bottom" || nearBottom);
        syncToolbarState();
      });

      if (edge === "top") {
        setActive(ids[0]);
      } else {
        setActive(ids[ids.length - 1]);
      }

      markIntent();
    },
    [vlistRef, setActive, syncToolbarState, markIntent],
  );

  const toggleAutoScroll = useCallback(() => {
    if (autoScrollEnabledRef.current) {
      userScrolledUpRef.current = true;
      autoScrollEnabledRef.current = false;
    } else {
      userScrolledUpRef.current = false;
      autoScrollEnabledRef.current = true;
      doScrollToBottom();
    }
    syncToolbarState();
  }, [doScrollToBottom, syncToolbarState]);

  const suspendAutoScroll = useCallback(() => {
    userScrolledUpRef.current = true;
    autoScrollEnabledRef.current = false;
    syncToolbarState();
  }, [syncToolbarState]);

  const resumeAutoScroll = useCallback(() => {
    userScrolledUpRef.current = false;
    autoScrollEnabledRef.current = true;
    doScrollToBottom();
    syncToolbarState();
  }, [doScrollToBottom, syncToolbarState]);

  return {
    handleScroll,
    handleScrollEnd,
    scrollToBottom: doScrollToBottom,
    scrollToEdge,
    scrollToMessage,
    isAtTop: toolbarState.isAtTop,
    isAtBottom: toolbarState.isAtBottom,
    autoScrollEnabled: toolbarState.autoScrollEnabled,
    toggleAutoScroll,
    suspendAutoScroll,
    resumeAutoScroll,
  };
}
