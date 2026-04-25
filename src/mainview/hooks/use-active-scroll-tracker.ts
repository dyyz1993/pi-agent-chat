import { useRef, useCallback, useEffect } from "react";

interface UseActiveScrollTrackerOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  navScrollRef: React.RefObject<HTMLDivElement | null>;
  messageIds: string[];
  setActive: (id: string | null) => void;
  streamVersion: number;
}

const BOTTOM_THRESHOLD_PX = 80;

export function useActiveScrollTracker({
  scrollRef,
  navScrollRef,
  messageIds,
  setActive,
  streamVersion,
}: UseActiveScrollTrackerOptions) {
  const userScrolledUpRef = useRef(false);
  const prevCountRef = useRef(0);
  const prevStreamRef = useRef(0);
  const isAutoScrollingRef = useRef(false);

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
  }, [scrollRef]);

  const syncNav = useCallback(() => {
    const el = scrollRef.current;
    const nav = navScrollRef.current;
    if (!el || !nav) return;
    const msgMax = el.scrollHeight - el.clientHeight;
    if (msgMax <= 0) return;
    const navMax = nav.scrollHeight - nav.clientHeight;
    if (navMax > 0) {
      nav.scrollTop = (el.scrollTop / msgMax) * navMax;
    }
  }, [scrollRef, navScrollRef]);

  const updateActiveFromScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || messageIds.length === 0) return;
    const msgMax = el.scrollHeight - el.clientHeight;
    if (msgMax <= 0) {
      setActive(messageIds[messageIds.length - 1]);
      return;
    }
    const ratio = el.scrollTop / msgMax;
    const index = Math.round(ratio * (messageIds.length - 1));
    setActive(messageIds[Math.max(0, Math.min(messageIds.length - 1, index))]);
  }, [messageIds, setActive, scrollRef]);

  const doScrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    isAutoScrollingRef.current = true;
    el.scrollTop = el.scrollHeight;
    syncNav();
    if (messageIds.length > 0) setActive(messageIds[messageIds.length - 1]);
    requestAnimationFrame(() => {
      isAutoScrollingRef.current = false;
    });
  }, [scrollRef, syncNav, setActive, messageIds]);

  const scrollToMessage = useCallback(
    (msgId: string) => {
      const container = scrollRef.current;
      if (!container) return;
      const target = container.querySelector<HTMLElement>(`[data-msg-id="${msgId}"]`);
      if (!target) return;

      setActive(msgId);

      const containerRect = container.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const paddingTop = 12;
      const maxScrollTop = container.scrollHeight - container.clientHeight;
      const scrollOffset = targetRect.top - containerRect.top + container.scrollTop - paddingTop;
      const clamped = Math.min(Math.max(0, scrollOffset), maxScrollTop);

      isAutoScrollingRef.current = true;
      container.scrollTo({ top: clamped, behavior: "smooth" });

      if (msgId === messageIds[messageIds.length - 1]) {
        userScrolledUpRef.current = false;
      }

      setTimeout(() => {
        isAutoScrollingRef.current = false;
      }, 400);
    },
    [scrollRef, setActive, messageIds],
  );

  const handleScroll = useCallback(() => {
    if (isAutoScrollingRef.current) return;

    updateActiveFromScroll();
    syncNav();

    if (!isNearBottom()) {
      userScrolledUpRef.current = true;
    } else {
      userScrolledUpRef.current = false;
    }
  }, [updateActiveFromScroll, syncNav, isNearBottom]);

  // new message → scroll to bottom
  useEffect(() => {
    if (messageIds.length > prevCountRef.current) {
      userScrolledUpRef.current = false;
      doScrollToBottom();
    }
    prevCountRef.current = messageIds.length;
  }, [messageIds, doScrollToBottom]);

  // stream content changed → scroll to bottom if user hasn't scrolled up
  useEffect(() => {
    if (streamVersion === 0 || streamVersion === prevStreamRef.current) return;
    prevStreamRef.current = streamVersion;

    if (userScrolledUpRef.current) return;

    doScrollToBottom();
  }, [streamVersion, doScrollToBottom]);

  useEffect(() => {
    return () => {};
  }, []);

  return { handleScroll, scrollToBottom: doScrollToBottom, scrollToMessage };
}
