import { useRef, useCallback, useEffect, useState } from "react";
import type { VirtualizerHandle } from "virtua";
import { useScrollIntent } from "./use-scroll-intent";

interface UseActiveScrollTrackerOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  vlistRef: React.RefObject<VirtualizerHandle | null>;
  messageIds: string[];
  activeTargets?: Array<{ key: string; messageId: string; blockId?: string }>;
  sessionId: string | undefined;
  setActive: (id: string | null) => void;
  streamVersion: number;
  historyLoadVersion?: number;
  initialScrollReady?: boolean;
  onInitComplete?: () => void;
}

const BOTTOM_THRESHOLD_PX = 80;
const TOP_THRESHOLD_PX = 80;
const ACTIVE_THROTTLE_MS = 16;
const SCROLL_SETTLE_MAX_ATTEMPTS = 10;
const ACTIVE_TARGET_ANCHOR_OFFSET_PX = 48;
const ACTIVE_TARGET_ANCHOR_MAX_RATIO = 0.35;

type ScrollDirection = "towardOlder" | "towardNewer" | null;

type VisibleActiveTargetCandidate = {
  key: string;
  top: number;
  bottom: number;
  order?: number;
};

export function getActiveTargetAnchorY(containerRect: Pick<DOMRect, "top" | "height">): number {
  const offset = Math.min(
    ACTIVE_TARGET_ANCHOR_OFFSET_PX,
    Math.max(12, containerRect.height * ACTIVE_TARGET_ANCHOR_MAX_RATIO),
  );
  return containerRect.top + offset;
}

export function chooseActiveTargetKeyForScroll(
  candidates: VisibleActiveTargetCandidate[],
  direction: ScrollDirection,
  anchorY: number,
  previousKey?: string | null,
  previousOrder?: number,
): string | null {
  if (candidates.length === 0) return null;
  const orderedCandidates = candidates
    .map((candidate, index) => ({ ...candidate, order: candidate.order ?? index }))
    .sort((a, b) => a.order - b.order);
  const anchorCandidate = candidates.reduce((best, item) => {
    const distance = Math.abs(item.top - anchorY);
    return distance < best.distance ? { candidate: item, distance } : best;
  }, { candidate: candidates[0], distance: Math.abs(candidates[0].top - anchorY) }).candidate;
  const anchorOrder =
    anchorCandidate.order ??
    orderedCandidates.find((candidate) => candidate.key === anchorCandidate.key)?.order;

  const resolvedPreviousOrder =
    previousOrder ?? orderedCandidates.find((candidate) => candidate.key === previousKey)?.order;

  if (direction === "towardOlder") {
    if (resolvedPreviousOrder != null) {
      if (anchorOrder != null && anchorOrder >= resolvedPreviousOrder) return anchorCandidate.key;
      const previousVisibleTarget = orderedCandidates
        .filter((candidate) => candidate.order < resolvedPreviousOrder)
        .at(-1);
      if (previousVisibleTarget) return previousVisibleTarget.key;
    }
    return anchorCandidate.key;
  }

  if (direction === "towardNewer") {
    if (resolvedPreviousOrder != null) {
      if (anchorOrder != null && anchorOrder <= resolvedPreviousOrder) return anchorCandidate.key;
      const nextVisibleTarget = orderedCandidates.find(
        (candidate) => candidate.order > resolvedPreviousOrder,
      );
      if (nextVisibleTarget) return nextVisibleTarget.key;
    }
    return anchorCandidate.key;
  }

  return anchorCandidate.key;
}

export function useActiveScrollTracker({
  scrollRef,
  vlistRef,
  messageIds,
  activeTargets,
  sessionId,
  setActive,
  streamVersion,
  historyLoadVersion,
  initialScrollReady = true,
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
  const scrollDirectionRef = useRef<ScrollDirection>(null);

  // programmaticScrollRef: suppresses updateActiveFromScroll during
  // programmatic scrolls (scrollToIndex, scrollTop assignment).
  // Uses double-rAF release to survive virtua's measureElement reflow.
  const programmaticScrollRef = useRef(false);

  const markProgrammatic = useCallback((fn: () => void) => {
    programmaticScrollRef.current = true;
    fn();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticScrollRef.current = false;
      });
    });
  }, []);

  const isAtTopRef = useRef(true);
  const isAtBottomRef = useRef(true);
  const autoScrollEnabledRef = useRef(true);
  const messageIdsRef = useRef(messageIds);
  messageIdsRef.current = messageIds;
  const activeTargetsRef = useRef(activeTargets);
  activeTargetsRef.current = activeTargets;

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

  const getFirstActiveTargetKey = useCallback(() => {
    const targets = activeTargetsRef.current;
    if (targets && targets.length > 0) return targets[0].key;
    return messageIdsRef.current[0] ?? null;
  }, []);

  const getLastActiveTargetKey = useCallback(() => {
    const targets = activeTargetsRef.current;
    if (targets && targets.length > 0) return targets[targets.length - 1].key;
    const ids = messageIdsRef.current;
    return ids[ids.length - 1] ?? null;
  }, []);

  const findVisibleActiveTargetKey = useCallback((): string | null => {
    const targets = activeTargetsRef.current;
    const container = scrollRef.current;
    if (!targets || targets.length === 0 || !container) return null;

    const blockToKey = new Map<string, string>();
    const messageToKey = new Map<string, string>();
    const targetOrder = new Map<string, number>();
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      targetOrder.set(target.key, i);
      if (target.blockId) {
        blockToKey.set(target.blockId, target.key);
      } else if (!messageToKey.has(target.messageId)) {
        messageToKey.set(target.messageId, target.key);
      }
    }

    const containerRect = container.getBoundingClientRect();
    const anchorY = getActiveTargetAnchorY(containerRect);
    const candidatesByKey = new Map<string, VisibleActiveTargetCandidate>();

    for (const element of Array.from(
      container.querySelectorAll<HTMLElement>("[data-block-id], [data-msg-id]"),
    )) {
      const blockId = element.dataset.blockId;
      const messageId = element.dataset.msgId;
      const key = blockId ? blockToKey.get(blockId) : messageId ? messageToKey.get(messageId) : null;
      if (!key) continue;

      const rect = element.getBoundingClientRect();
      if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) continue;
      const existing = candidatesByKey.get(key);
      if (existing) {
        existing.top = Math.min(existing.top, rect.top);
        existing.bottom = Math.max(existing.bottom, rect.bottom);
      } else {
        candidatesByKey.set(key, {
          key,
          top: rect.top,
          bottom: rect.bottom,
          order: targetOrder.get(key),
        });
      }
    }

    const candidates = Array.from(candidatesByKey.values()).sort((a, b) => a.top - b.top);
    const previousKey = lastActiveIdRef.current;
    return chooseActiveTargetKeyForScroll(
      candidates,
      scrollDirectionRef.current,
      anchorY,
      previousKey,
      previousKey ? targetOrder.get(previousKey) : undefined,
    );
  }, [scrollRef]);

  const updateActiveFromScroll = useCallback(() => {
    const now = Date.now();
    if (now - lastActiveTimeRef.current < ACTIVE_THROTTLE_MS) return;
    lastActiveTimeRef.current = now;

    const ids = messageIdsRef.current;
    if (ids.length === 0) return;

    const nearTop = isNearTop();
    const nearBottom = isNearBottom();
    const edgeTarget = nearBottom
      ? getLastActiveTargetKey()
      : nearTop
        ? getFirstActiveTargetKey()
        : null;
    if (edgeTarget) {
      if (edgeTarget !== lastActiveIdRef.current) {
        lastActiveIdRef.current = edgeTarget;
        setActive(edgeTarget);
      }
      return;
    }

    // 底部跟踪激活时，始终指向最后一条消息
    if (autoScrollEnabledRef.current) {
      const lastId = getLastActiveTargetKey();
      if (!lastId) return;
      if (lastId !== lastActiveIdRef.current) {
        lastActiveIdRef.current = lastId;
        setActive(lastId);
      }
      return;
    }

    const visibleTargetKey = findVisibleActiveTargetKey();
    if (visibleTargetKey) {
      if (visibleTargetKey !== lastActiveIdRef.current) {
        lastActiveIdRef.current = visibleTargetKey;
        setActive(visibleTargetKey);
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
  }, [
    findVisibleActiveTargetKey,
    findVisibleIndex,
    getFirstActiveTargetKey,
    getLastActiveTargetKey,
    isNearBottom,
    isNearTop,
    setActive,
  ]);

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
      markProgrammatic(() => handle.scrollToIndex(ids.length - 1, { align: "end" }));
      lastScrollTopRef.current = handle.scrollOffset;

      const isAtBottom = handle.scrollSize - handle.scrollOffset - handle.viewportSize < 50;
      if (isAtBottom) {
        didInitRef.current = true;
        setActive(getLastActiveTargetKey());
        scrollRafRef.current = 0;
        // Notify ChatPanel that initial scroll is done so it can sync navId
        onInitComplete?.();
      } else if (attempts < SCROLL_SETTLE_MAX_ATTEMPTS) {
        scrollRafRef.current = requestAnimationFrame(tryScroll);
      } else {
        scrollRafRef.current = 0;
        // Max attempts reached — still call onInitComplete so navId sync starts
        onInitComplete?.();
      }
    };

    scrollRafRef.current = requestAnimationFrame(tryScroll);
  }, [vlistRef, setActive, markProgrammatic, onInitComplete, getLastActiveTargetKey]);

  const doScrollToBottom = useCallback(() => {
    const handle = vlistRef.current;
    const ids = messageIdsRef.current;
    if (!handle || ids.length === 0) return;
    if (userScrolledUpRef.current) return;
    markProgrammatic(() => handle.scrollToIndex(ids.length - 1, { align: "end" }));
    lastScrollTopRef.current = handle.scrollOffset;
    const lastId = getLastActiveTargetKey();
    setActive(lastId);
  }, [vlistRef, setActive, markProgrammatic, getLastActiveTargetKey]);

  const scrollToMessage = useCallback(
    (msgId: string, options?: { align?: "start" | "center" | "end"; smooth?: boolean }) => {
      const handle = vlistRef.current;
      const ids = messageIdsRef.current;
      if (!handle) return;
      const index = ids.indexOf(msgId);
      if (index === -1) return;

      const target =
        activeTargetsRef.current?.find((item) => item.messageId === msgId && !item.blockId)?.key ??
        msgId;
      setActive(target);
      markProgrammatic(() =>
        handle.scrollToIndex(index, { align: options?.align, smooth: options?.smooth ?? true }),
      );
      lastScrollTopRef.current = handle.scrollOffset;

      if (msgId === ids[ids.length - 1]) {
        userScrolledUpRef.current = false;
      }
    },
    [vlistRef, setActive, markProgrammatic],
  );

  const handleScroll = useCallback(() => {
    const handle = vlistRef.current;
    let nearBottom = isNearBottom();
    const nearTop = isNearTop();
    const isProgrammatic = programmaticScrollRef.current;

    if (handle) {
      const delta = handle.scrollOffset - lastScrollTopRef.current;
      lastScrollTopRef.current = handle.scrollOffset;

      if (delta < -3) {
        scrollDirectionRef.current = "towardOlder";
      } else if (delta > 3) {
        scrollDirectionRef.current = "towardNewer";
      }

      if (
        !isProgrammatic &&
        didInitRef.current &&
        autoScrollEnabledRef.current &&
        !nearBottom
      ) {
        autoScrollEnabledRef.current = false;
        userScrolledUpRef.current = true;
        nearBottom = false;
      } else if (delta < -3 && autoScrollEnabledRef.current) {
        // During init phase, Virtualizer layout corrections cause false-negative
        // deltas that would mistakenly disable tracking. Only disable after init.
        if (didInitRef.current) {
          autoScrollEnabledRef.current = false;
          userScrolledUpRef.current = true;
          nearBottom = false;
        }
      } else if (nearBottom && !autoScrollEnabledRef.current && delta > 5) {
        autoScrollEnabledRef.current = true;
        userScrolledUpRef.current = false;
      }
    }

    // Skip activeId updates during programmatic scrolls (scrollToIndex, etc.)
    // to prevent activeId flicker as intermediate messages scroll past.
    if (!programmaticScrollRef.current) {
      updateActiveFromScroll();
    }
    isAtTopRef.current = nearTop;
    isAtBottomRef.current = nearBottom;

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
      scrollDirectionRef.current = null;
      lastActiveIdRef.current = null;
      syncToolbarState();
    }
  }, [sessionId, syncToolbarState]);

  // Unified initial scroll: triggered once when messages are first ready.
  // Uses scheduleScrollToBottom which cancels previous attempts, so
  // loadSessionMessages → _backgroundRefreshMessages
  // don't create competing scroll chains.
  useEffect(() => {
    if (!initialScrollReady) return;
    if (messageIds.length === 0) return;
    // Only trigger if not yet initialized
    if (didInitRef.current) return;

    setActive(getLastActiveTargetKey());
    scheduleScrollToBottom();

    return () => {
      if (scrollRafRef.current) {
        cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = 0;
      }
    };
  }, [initialScrollReady, messageIds, scheduleScrollToBottom, setActive, getLastActiveTargetKey]);

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
      setActive(getLastActiveTargetKey());
    }

    if (!userScrolledUpRef.current) {
      scheduleScrollToBottom();
    }
  }, [
    initialScrollReady,
    historyLoadVersion,
    vlistRef,
    messageIds,
    setActive,
    scheduleScrollToBottom,
    getLastActiveTargetKey,
  ]);

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

      markProgrammatic(() => {
        if (edge === "top") {
          handle.scrollToIndex(0);
        } else {
          handle.scrollToIndex(ids.length - 1, { align: "end" });
        }
      });
      lastScrollTopRef.current = handle.scrollOffset;

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
        setActive(getFirstActiveTargetKey());
      } else {
        setActive(getLastActiveTargetKey());
      }

      markIntent();
    },
    [
      vlistRef,
      setActive,
      syncToolbarState,
      markIntent,
      markProgrammatic,
      getFirstActiveTargetKey,
      getLastActiveTargetKey,
    ],
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
