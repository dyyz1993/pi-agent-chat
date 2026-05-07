import { useRef, useCallback, useEffect, useState } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";
import { useScrollIntent } from "./use-scroll-intent";

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
  const lastScrollTopRef = useRef(0);
  const scrollDirRef = useRef<"up" | "down">("down");
  const isProgrammaticScrollRef = useRef(false);

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

  const syncToolbarState = useCallback(() => {
    setToolbarState((prev) => {
      const top = isAtTopRef.current;
      const bottom = isAtBottomRef.current;
      const auto = autoScrollEnabledRef.current;
      if (prev.isAtTop === top && prev.isAtBottom === bottom && prev.autoScrollEnabled === auto)
        return prev;
      return { isAtTop: top, isAtBottom: bottom, autoScrollEnabled: auto };
    });
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
    isProgrammaticScrollRef.current = true;
    el.scrollTop = el.scrollHeight;
    setActive(ids[ids.length - 1]);
  }, [scrollRef, setActive]);

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
        el.scrollTo({ top: offset, behavior: "smooth" });
      } else {
        virtualizer.scrollToIndex(index, { align: "start", behavior: "smooth" });
      }

      if (msgId === ids[ids.length - 1]) {
        userScrolledUpRef.current = false;
      }
    },
    [scrollRef, virtualizer, setActive],
  );

  const handleScroll = useCallback(() => {
    updateActiveFromScroll();
    const nearBottom = isNearBottom();
    const nearTop = isNearTop();
    isAtTopRef.current = nearTop;
    isAtBottomRef.current = nearBottom;

    if (isProgrammaticScrollRef.current) {
      isProgrammaticScrollRef.current = false;
      lastScrollTopRef.current = scrollRef.current?.scrollTop ?? 0;
      syncToolbarState();
      return;
    }

    const el = scrollRef.current;
    if (el) {
      const delta = el.scrollTop - lastScrollTopRef.current;
      lastScrollTopRef.current = el.scrollTop;

      if (delta < -3 && autoScrollEnabledRef.current) {
        autoScrollEnabledRef.current = false;
        userScrolledUpRef.current = true;
      } else if (nearBottom && !autoScrollEnabledRef.current && delta > 5) {
        autoScrollEnabledRef.current = true;
        userScrolledUpRef.current = false;
      }
    }

    syncToolbarState();
  }, [updateActiveFromScroll, isNearBottom, isNearTop, syncToolbarState, scrollRef]);

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
      const el = scrollRef.current;
      if (!el || attempts >= MAX_ATTEMPTS) return;
      if (userScrolledUpRef.current) return;

      attempts++;
      isProgrammaticScrollRef.current = true;
      el.scrollTop = el.scrollHeight;
      setActive(messageIds[messageIds.length - 1]);

      const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
      if (!isAtBottom && attempts < MAX_ATTEMPTS) {
        rafId = requestAnimationFrame(tryScroll);
      }
    };

    rafId = requestAnimationFrame(tryScroll);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [messageIds, scrollRef, setActive]);

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
      let attempts = 0;
      const MAX_ATTEMPTS = 10;
      let rafId: number;

      const tryScroll = () => {
        const el = scrollRef.current;
        if (!el || attempts >= MAX_ATTEMPTS) return;
        attempts++;

        if (el.scrollHeight <= el.clientHeight && attempts < MAX_ATTEMPTS) {
          rafId = requestAnimationFrame(tryScroll);
          return;
        }

        isProgrammaticScrollRef.current = true;
        el.scrollTop = el.scrollHeight;

        const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
        if (!isAtBottom && attempts < MAX_ATTEMPTS) {
          rafId = requestAnimationFrame(tryScroll);
        }
      };

      rafId = requestAnimationFrame(tryScroll);

      return () => {
        if (rafId) cancelAnimationFrame(rafId);
      };
    }
  }, [historyLoadVersion, scrollRef, virtualizer, messageIds, setActive]);

  const scrollToEdge = useCallback(
    (edge: "top" | "bottom") => {
      const el = scrollRef.current;
      if (!el) return;
      const ids = messageIdsRef.current;
      if (ids.length === 0) return;

      if (edge === "top") {
        el.scrollTop = 0;
      } else {
        el.scrollTop = el.scrollHeight;
      }

      const nearTop = edge === "top" || el.scrollTop < TOP_THRESHOLD_PX;
      const nearBottom =
        edge === "bottom" || el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
      isAtTopRef.current = nearTop;
      isAtBottomRef.current = nearBottom;
      userScrolledUpRef.current = !nearBottom;
      syncToolbarState();

      if (edge === "top") {
        setActive(ids[0]);
      } else {
        setActive(ids[ids.length - 1]);
      }

      markIntent();
    },
    [scrollRef, setActive, syncToolbarState, markIntent],
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

  const markProgrammatic = useCallback(() => {
    isProgrammaticScrollRef.current = true;
  }, []);

  return {
    handleScroll,
    scrollToBottom: doScrollToBottom,
    scrollToEdge,
    scrollToMessage,
    isAtTop: toolbarState.isAtTop,
    isAtBottom: toolbarState.isAtBottom,
    autoScrollEnabled: toolbarState.autoScrollEnabled,
    toggleAutoScroll,
    markProgrammatic,
  };
}
