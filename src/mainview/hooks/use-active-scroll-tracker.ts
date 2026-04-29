import { useRef, useCallback, useEffect, useState } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";

interface UseActiveScrollTrackerOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  messageIds: string[];
  sessionId: string | undefined;
  setActive: (id: string | null, anchor?: "top" | "bottom") => void;
  streamVersion: number;
  historyLoadVersion?: number;
}

const BOTTOM_THRESHOLD_PX = 80;
const TOP_THRESHOLD_PX = 80;
const ACTIVE_THROTTLE_MS = 50;

export function useActiveScrollTracker({
  scrollRef,
  virtualizer,
  messageIds,
  sessionId,
  setActive,
  streamVersion,
  historyLoadVersion,
}: UseActiveScrollTrackerOptions) {
  const userScrolledUpRef = useRef(false);
  const prevCountRef = useRef(0);
  const prevStreamRef = useRef(0);
  const lastActiveTimeRef = useRef(0);
  const didInitRef = useRef(false);
  const prevSessionRef = useRef(sessionId);
  const programmaticCountRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const scrollDirRef = useRef<"up" | "down">("down");

  const isAtTopRef = useRef(true);
  const isAtBottomRef = useRef(true);
  const autoScrollEnabledRef = useRef(true);
  const messageIdsRef = useRef(messageIds);
  messageIdsRef.current = messageIds;

  const [toolbarState, setToolbarState] = useState({
    isAtTop: true,
    isAtBottom: true,
    autoScrollEnabled: true,
  });

  const syncToolbarState = useCallback(() => {
    setToolbarState((prev) => {
      const top = isAtTopRef.current;
      const bottom = isAtBottomRef.current;
      const auto = autoScrollEnabledRef.current;
      if (prev.isAtTop === top && prev.isAtBottom === bottom && prev.autoScrollEnabled === auto) return prev;
      return { isAtTop: top, isAtBottom: bottom, autoScrollEnabled: auto };
    });
  }, []);

  const markProgrammatic = useCallback((fn: () => void) => {
    programmaticCountRef.current++;
    fn();
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        programmaticCountRef.current--;
      });
    });
  }, []);

  const markProgrammaticLong = useCallback((fn: () => void, duration = 500) => {
    programmaticCountRef.current++;
    fn();
    setTimeout(() => {
      programmaticCountRef.current--;
    }, duration);
  }, []);

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
  }, [scrollRef]);

  const isNearTop = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollTop < TOP_THRESHOLD_PX;
  }, [scrollRef]);

  const updateActiveFromScroll = useCallback(() => {
    const now = Date.now();
    if (now - lastActiveTimeRef.current < ACTIVE_THROTTLE_MS) return;
    lastActiveTimeRef.current = now;

    const ids = messageIdsRef.current;
    if (ids.length === 0) return;
    const range = virtualizer.range;
    if (!range) return;

    const el = scrollRef.current;
    if (el) {
      const delta = el.scrollTop - lastScrollTopRef.current;
      if (Math.abs(delta) > 2) {
        scrollDirRef.current = delta > 0 ? "down" : "up";
      }
      lastScrollTopRef.current = el.scrollTop;
    }

    const idx = scrollDirRef.current === "down" ? range.startIndex : range.endIndex;
    if (idx >= 0 && idx < ids.length) {
      setActive(ids[idx], scrollDirRef.current === "down" ? "top" : "bottom");
    }
  }, [virtualizer, setActive, scrollRef]);

  const doScrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    const ids = messageIdsRef.current;
    if (!el || ids.length === 0) return;
    markProgrammatic(() => {
      el.scrollTop = el.scrollHeight;
    });
    setActive(ids[ids.length - 1]);
  }, [scrollRef, markProgrammatic, setActive]);

  const scrollToMessage = useCallback(
    (msgId: string) => {
      const ids = messageIdsRef.current;
      const index = ids.indexOf(msgId);
      if (index === -1) return;

      const el = scrollRef.current;
      if (!el) return;

      setActive(msgId);

      const target = el.querySelector<HTMLElement>(`[data-msg-id="${msgId}"]`);
      if (target) {
        const elRect = el.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const offset = targetRect.top - elRect.top + el.scrollTop - 8;
        markProgrammatic(() => {
          el.scrollTo({ top: offset, behavior: "smooth" });
        });
      } else {
        markProgrammatic(() => {
          virtualizer.scrollToIndex(index, { align: "start", behavior: "smooth" });
        });
      }

      if (msgId === ids[ids.length - 1]) {
        userScrolledUpRef.current = false;
      }
    },
    [scrollRef, virtualizer, markProgrammatic, setActive],
  );

  const handleScroll = useCallback(() => {
    if (programmaticCountRef.current > 0) return;
    updateActiveFromScroll();
    const nearBottom = isNearBottom();
    const nearTop = isNearTop();
    userScrolledUpRef.current = !nearBottom;
    isAtTopRef.current = nearTop;
    isAtBottomRef.current = nearBottom;
    if (nearBottom && !autoScrollEnabledRef.current) {
      autoScrollEnabledRef.current = true;
    }
    syncToolbarState();
  }, [updateActiveFromScroll, isNearBottom, isNearTop, syncToolbarState]);

  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
      didInitRef.current = false;
      userScrolledUpRef.current = false;
      prevCountRef.current = 0;
      prevStreamRef.current = 0;
      isAtTopRef.current = true;
      isAtBottomRef.current = true;
      autoScrollEnabledRef.current = true;
      syncToolbarState();
    }
  }, [sessionId, syncToolbarState]);

  useEffect(() => {
    if (didInitRef.current || messageIds.length === 0) return;
    didInitRef.current = true;

    const scrollToBottomWhenReady = (attempt = 0) => {
      if (attempt > 30) return;

      const el = scrollRef.current;
      if (!el) {
        requestAnimationFrame(() => scrollToBottomWhenReady(attempt + 1));
        return;
      }

      const totalSize = virtualizer.getTotalSize();
      const clientH = el.clientHeight;

      if (totalSize <= clientH || clientH === 0) {
        requestAnimationFrame(() => scrollToBottomWhenReady(attempt + 1));
        return;
      }

      const prevScrollHeight = el.scrollHeight;
      markProgrammatic(() => {
        el.scrollTop = prevScrollHeight;
      });
      setActive(messageIds[messageIds.length - 1]);

      requestAnimationFrame(() => {
        const afterScrollHeight = el.scrollHeight;
        if (Math.abs(afterScrollHeight - prevScrollHeight) > 5) {
          markProgrammatic(() => {
            el.scrollTop = afterScrollHeight;
          });
        }
      });
    };

    requestAnimationFrame(() => scrollToBottomWhenReady(0));
  }, [messageIds, scrollRef, virtualizer, markProgrammatic, setActive]);

  useEffect(() => {
    if (messageIds.length > prevCountRef.current && !userScrolledUpRef.current) {
      doScrollToBottom();
    }
    prevCountRef.current = messageIds.length;
  }, [messageIds, doScrollToBottom]);

  useEffect(() => {
    if (streamVersion === 0 || streamVersion === prevStreamRef.current) return;
    prevStreamRef.current = streamVersion;
    if (userScrolledUpRef.current) return;
    doScrollToBottom();
  }, [streamVersion, doScrollToBottom]);

  useEffect(() => {
    if (historyLoadVersion === undefined || historyLoadVersion === 0) return;
    userScrolledUpRef.current = false;
    didInitRef.current = false;
    prevCountRef.current = messageIds.length;

    const scrollEl = scrollRef.current;
    if (!scrollEl || messageIds.length === 0) return;

    if (messageIds.length > 0) {
      setActive(messageIds[messageIds.length - 1]);
    }

    let rafId: number;
    let attempts = 0;
    const MAX_ATTEMPTS = 30;

    const tryScroll = () => {
      attempts++;
      const el = scrollRef.current;
      if (!el) { rafId = requestAnimationFrame(tryScroll); return; }

      const totalSize = virtualizer.getTotalSize();
      if (totalSize > el.clientHeight && el.clientHeight > 0) {
        programmaticCountRef.current++;
        el.scrollTop = el.scrollHeight;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            programmaticCountRef.current--;
            const finalEl = scrollRef.current;
            if (finalEl && Math.abs(finalEl.scrollTop + finalEl.clientHeight - finalEl.scrollHeight) > 3) {
              programmaticCountRef.current++;
              finalEl.scrollTop = finalEl.scrollHeight;
              requestAnimationFrame(() => {
                requestAnimationFrame(() => { programmaticCountRef.current--; });
              });
            }
          });
        });
        return;
      }

      if (attempts < MAX_ATTEMPTS) {
        rafId = requestAnimationFrame(tryScroll);
      } else {
        programmaticCountRef.current++;
        el.scrollTop = el.scrollHeight;
        requestAnimationFrame(() => {
          requestAnimationFrame(() => { programmaticCountRef.current--; });
        });
      }
    };

    rafId = requestAnimationFrame(tryScroll);
    return () => cancelAnimationFrame(rafId);
  }, [historyLoadVersion, scrollRef, virtualizer, messageIds, setActive]);

  const scrollToEdge = useCallback((edge: "top" | "bottom") => {
    const el = scrollRef.current;
    if (!el) return;
    const ids = messageIdsRef.current;
    if (ids.length === 0) return;

    programmaticCountRef.current++;
    if (edge === "top") {
      el.scrollTop = 0;
    } else {
      el.scrollTop = el.scrollHeight;
    }

    const nearTop = edge === "top" || el.scrollTop < TOP_THRESHOLD_PX;
    const nearBottom = edge === "bottom" || (el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX);
    isAtTopRef.current = nearTop;
    isAtBottomRef.current = nearBottom;
    userScrolledUpRef.current = !nearBottom;
    syncToolbarState();

    if (edge === "top") {
      setActive(ids[0]);
    } else {
      setActive(ids[ids.length - 1]);
    }

    setTimeout(() => { programmaticCountRef.current--; }, 500);
  }, [scrollRef, setActive, syncToolbarState]);

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

  return {
    handleScroll,
    scrollToBottom: doScrollToBottom,
    scrollToEdge,
    scrollToMessage,
    markProgrammatic,
    markProgrammaticLong,
    isAtTop: toolbarState.isAtTop,
    isAtBottom: toolbarState.isAtBottom,
    autoScrollEnabled: toolbarState.autoScrollEnabled,
    toggleAutoScroll,
  };
}
