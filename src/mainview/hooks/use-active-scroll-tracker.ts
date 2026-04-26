import { useRef, useCallback, useEffect } from "react";
import type { Virtualizer } from "@tanstack/react-virtual";

interface UseActiveScrollTrackerOptions {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  messageIds: string[];
  sessionId: string | undefined;
  setActive: (id: string | null) => void;
  streamVersion: number;
}

const BOTTOM_THRESHOLD_PX = 80;
const ACTIVE_THROTTLE_MS = 50;

export function useActiveScrollTracker({
  scrollRef,
  virtualizer,
  messageIds,
  sessionId,
  setActive,
  streamVersion,
}: UseActiveScrollTrackerOptions) {
  const userScrolledUpRef = useRef(false);
  const prevCountRef = useRef(0);
  const prevStreamRef = useRef(0);
  const lastActiveTimeRef = useRef(0);
  const didInitRef = useRef(false);
  const prevSessionRef = useRef(sessionId);
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

  const isNearBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight < BOTTOM_THRESHOLD_PX;
  }, [scrollRef]);

  const updateActiveFromScroll = useCallback(() => {
    const now = Date.now();
    if (now - lastActiveTimeRef.current < ACTIVE_THROTTLE_MS) return;
    lastActiveTimeRef.current = now;

    if (messageIds.length === 0) return;
    const range = virtualizer.range;
    if (!range) return;
    const idx = range.startIndex;
    if (idx >= 0 && idx < messageIds.length) {
      setActive(messageIds[idx]);
    }
  }, [virtualizer, messageIds, setActive]);

  const doScrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el || messageIds.length === 0) return;
    markProgrammatic(() => {
      el.scrollTop = el.scrollHeight;
    });
    setActive(messageIds[messageIds.length - 1]);
  }, [scrollRef, markProgrammatic, setActive, messageIds]);

  const scrollToMessage = useCallback(
    (msgId: string) => {
      const index = messageIds.indexOf(msgId);
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

      if (msgId === messageIds[messageIds.length - 1]) {
        userScrolledUpRef.current = false;
      }
    },
    [scrollRef, virtualizer, markProgrammatic, setActive, messageIds],
  );

  const handleScroll = useCallback(() => {
    if (programmaticScrollRef.current) return;
    updateActiveFromScroll();
    userScrolledUpRef.current = !isNearBottom();
  }, [updateActiveFromScroll, isNearBottom]);

  useEffect(() => {
    if (prevSessionRef.current !== sessionId) {
      prevSessionRef.current = sessionId;
      didInitRef.current = false;
      userScrolledUpRef.current = false;
      prevCountRef.current = 0;
      prevStreamRef.current = 0;
    }
  }, [sessionId]);

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

  return { handleScroll, scrollToBottom: doScrollToBottom, scrollToMessage };
}
