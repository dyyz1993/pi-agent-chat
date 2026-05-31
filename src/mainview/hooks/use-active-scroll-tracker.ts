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
  onInitComplete?: () => void;
}

const BOTTOM_THRESHOLD_PX = 80;
const TOP_THRESHOLD_PX = 80;
const ACTIVE_THROTTLE_MS = 50;

export function useActiveScrollTracker({
  scrollRef,
  vlistRef,
  messageIds,
  sessionId,
  setActive,
  streamVersion,
  historyLoadVersion,
  onInitComplete,
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

    const idx = findVisibleIndex();
    if (idx >= 0 && idx < ids.length) {
      const id = ids[idx];
      if (id !== lastActiveIdRef.current) {
        lastActiveIdRef.current = id;
        setActive(id);
      }
    }
  }, [findVisibleIndex, setActive]);

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
        autoScrollEnabledRef.current = false;
        userScrolledUpRef.current = true;
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

  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
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

  useEffect(() => {
    if (didInitRef.current || messageIds.length === 0) return;
    didInitRef.current = true;

    let attempts = 0;
    const MAX_ATTEMPTS = 5;
    let rafId: number;

    const tryScroll = () => {
      const handle = vlistRef.current;
      if (!handle || attempts >= MAX_ATTEMPTS) return;
      if (userScrolledUpRef.current) return;

      attempts++;
      handle.scrollToIndex(messageIds.length - 1, { align: "end" });

      const isAtBottom = handle.scrollSize - handle.scrollOffset - handle.viewportSize < 50;
      if (isAtBottom || attempts >= MAX_ATTEMPTS) {
        setActive(messageIds[messageIds.length - 1]);
        onInitComplete?.();
      } else {
        rafId = requestAnimationFrame(tryScroll);
      }
    };

    rafId = requestAnimationFrame(tryScroll);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [messageIds, vlistRef, setActive]);

  useEffect(() => {
    if (streamVersion === 0 || streamVersion === prevStreamRef.current) return;
    prevStreamRef.current = streamVersion;
    if (userScrolledUpRef.current) return;
    requestAnimationFrame(() => doScrollToBottom());
  }, [streamVersion, doScrollToBottom]);

  useEffect(() => {
    if (historyLoadVersion === undefined || historyLoadVersion === 0) return;
    if (!userScrolledUpRef.current) {
      didInitRef.current = false;
    }
    prevCountRef.current = messageIds.length;

    if (messageIds.length > 0) {
      setActive(messageIds[messageIds.length - 1]);
    }

    if (!userScrolledUpRef.current) {
      const handle = vlistRef.current;
      const isAlreadyAtBottom = handle
        ? handle.scrollSize - handle.scrollOffset - handle.viewportSize < 50
        : false;

      if (isAlreadyAtBottom && didInitRef.current) return;

      let attempts = 0;
      const MAX_ATTEMPTS = 10;
      let rafId: number;

      const tryScroll = () => {
        const handle = vlistRef.current;
        if (!handle || attempts >= MAX_ATTEMPTS) return;
        attempts++;

        if (handle.scrollSize <= handle.viewportSize) return;

        handle.scrollToIndex(messageIds.length - 1, { align: "end" });

        const isAtBottom = handle.scrollSize - handle.scrollOffset - handle.viewportSize < 50;
        if (!isAtBottom && attempts < MAX_ATTEMPTS) {
          rafId = requestAnimationFrame(tryScroll);
        }
      };

      rafId = requestAnimationFrame(tryScroll);

      return () => {
        if (rafId) cancelAnimationFrame(rafId);
      };
    }
  }, [historyLoadVersion, vlistRef, messageIds, setActive]);

  const scrollToEdge = useCallback(
    (edge: "top" | "bottom") => {
      const handle = vlistRef.current;
      if (!handle) return;
      const ids = messageIdsRef.current;
      if (ids.length === 0) return;

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
