import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  PanelLeft,
  PanelRight,
  Bot,
  ArrowLeft,
  Square,
  Zap,
  Clock,
  Loader2,
  RefreshCw,
  AlertTriangle,
  GitFork,
  ClipboardCheck,
  Check,
  FolderOpen,
  Sparkles,
  Target,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ImageContent } from "@dyyz1993/pi-ai";
import { createLogger } from "../../../shared/lib/logger";
import { useChatStore } from "../../stores/use-chat-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { NotificationCenter } from "./NotificationCenter";
import { ProjectRuntimePendingRequests, UIPendingCenter } from "./UIPendingCenter";
import { useChangeReviewStore } from "../../stores/use-change-review-store";
import { RetryNotification } from "./RetryNotification";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { useTurnStore, EMPTY_SET } from "../../stores/use-turn-store";
import { useSettingsStore } from "../../stores/use-settings-store";
import { apiClient } from "../../lib/api-client";
import { useActiveScrollTracker } from "../../hooks/use-active-scroll-tracker";
import type { VirtualizerHandle } from "virtua";
import { SideNav, buildFlatItems, type SideNavPagination, type SideNavTarget } from "./SideNav";
import { InputBar, type InputBarHandle } from "./InputBar";
import { TokenStatusBar } from "./TokenStatusBar";
import { buildProcessedMessages, MessageListView } from "./MessageListView";
import { MessageSelectionBar } from "./MessageSelectionBar";
import { QuickActionToolbar } from "./QuickActionToolbar";
import { CommandPopup } from "./CommandPopup";
import { useCommandPopup } from "../../hooks/use-command-popup";
import { ScrollToolbar } from "./ScrollToolbar";
import { QueueCards } from "./QueueCards";
import { GoalActionCard } from "./GoalActionCard";
import { useReturnToSourceSession } from "./primitives/useReturnToSourceSession";
import { MermaidFullscreen } from "./mermaid";
import { RollbackOverlay } from "./RollbackOverlay";
import { ForkDialog } from "./ForkDialog";
import { AttachmentButtons, AttachmentBar } from "./FileAttachment";
import { TextSelectionToolbar } from "./TextSelectionToolbar";
import { ComposerPlaceholderBar } from "./ComposerPlaceholderBar";
import { useAttachmentStore } from "../../stores/use-attachment-store";
import {
  composeInputWithPlaceholders,
  persistComposerPlaceholders,
  useComposerPlaceholderStore,
} from "../../stores/use-composer-placeholder-store";
import { useForkDialogStore } from "../../stores/use-fork-dialog-store";
import type { ChatMessage } from "../../types";
import { useAgentStore } from "../../stores/use-agent-store";
import { agentColorStyle } from "../../utils/agent-color";
import { useSupervisorStore } from "../../stores/use-supervisor-store";
import {
  getProjectDisplayName,
  getSessionIdentity,
  type SessionIdentity,
} from "../../lib/session-identity";
import type { SessionMeta } from "../../types";

const log = createLogger("chat");
const BLOCK_NAV_MAX_RENDER_ATTEMPTS = 60;
const SIDE_NAV_CLICK_SCROLL_LOCK_FALLBACK_MS = 5000;

const MAX_MSG_IDS_CACHE = 10;

const _messageIdsCache = new Map<string, { ref: ChatMessage[]; result: string[] }>();

interface TopLoadScrollAnchor {
  sessionId: string;
  scrollHeight: number;
  scrollTop: number;
}

function findSessionMeta(
  sessionsByProject: Record<string, SessionMeta[]>,
  sessionId: string | null | undefined,
): SessionMeta | null {
  if (!sessionId) return null;
  for (const sessions of Object.values(sessionsByProject)) {
    const match = sessions.find((session) => session.sessionId === sessionId);
    if (match) return match;
  }
  return null;
}

function sessionIdentityClass(identity: SessionIdentity): string {
  if (identity.kind === "subagent") {
    return "border-status-info/30 bg-status-info/10 text-status-info";
  }
  if (identity.kind === "fork") {
    return "border-semantic-accent/30 bg-semantic-accent/10 text-semantic-accent";
  }
  return "border-status-warning/30 bg-status-warning/10 text-status-warning";
}

export function shouldStartTopLoad({
  activeSessionId,
  isAtTop,
  hasMoreMessages,
  isLoadingMore,
  isViewingSubagent,
  lockedSessionId,
}: {
  activeSessionId: string | null | undefined;
  isAtTop: boolean;
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
  isViewingSubagent: boolean;
  lockedSessionId: string | null;
}): boolean {
  return (
    !!activeSessionId &&
    isAtTop &&
    hasMoreMessages &&
    !isLoadingMore &&
    !isViewingSubagent &&
    lockedSessionId !== activeSessionId
  );
}

export function computeTopLoadRestoredScrollTop(
  anchor: TopLoadScrollAnchor,
  nextScrollHeight: number,
): number {
  const addedHeight = Math.max(0, nextScrollHeight - anchor.scrollHeight);
  return anchor.scrollTop + addedHeight;
}

function evictMsgIdsIfNeeded(): void {
  if (_messageIdsCache.size > MAX_MSG_IDS_CACHE) {
    const firstKey = _messageIdsCache.keys().next().value;
    if (firstKey !== undefined) _messageIdsCache.delete(firstKey);
  }
}

const EMPTY_MSGS: never[] = [];

export function getDisplayedMessagesForChatPanel(params: {
  activeSessionId: string | null;
  activeSubsessionId: string | null;
  messagesBySession: Record<string, ChatMessage[] | undefined>;
}): ChatMessage[] {
  const targetSessionId = params.activeSubsessionId ?? params.activeSessionId;
  if (!targetSessionId) return EMPTY_MSGS;
  return params.messagesBySession[targetSessionId] ?? EMPTY_MSGS;
}

function RefineGoalOverlay({ step }: { step: number }) {
  const { t } = useTranslation("chat");
  const steps = [
    { label: t("goal.refineStep.gather"), icon: FolderOpen },
    { label: t("goal.refineStep.llm"), icon: Sparkles },
    { label: t("goal.refineStep.done"), icon: Check },
  ];
  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center gap-3 px-4 bg-bg-secondary/90 backdrop-blur-sm rounded">
      <Loader2 className="w-4 h-4 text-semantic-accent animate-spin shrink-0" />
      <div className="flex items-center gap-2 min-w-0 flex-1">
        {steps.map((s, i) => {
          const isActive = i + 1 === step;
          const isDone = i + 1 < step;
          const IconComp = s.icon;
          return (
            <div
              key={i}
              className={`flex items-center gap-1 text-[11px] whitespace-nowrap transition-colors ${
                isDone
                  ? "text-status-success"
                  : isActive
                    ? "text-semantic-accent font-medium"
                    : "text-text-tertiary/50"
              }`}
            >
              {i > 0 && <span className="text-text-tertiary/30 mx-0.5">›</span>}
              {isDone ? (
                <Check className="w-3 h-3" />
              ) : isActive ? (
                <IconComp className="w-3 h-3" />
              ) : (
                <span className="w-3 h-3 rounded-full border border-current opacity-30" />
              )}
              <span>{s.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ChatPanel() {
  const { t } = useTranslation("chat");
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const parentStatus = useSessionStore((s) =>
    activeSessionId ? (s.sessionStatusMap[activeSessionId] ?? "idle") : "idle",
  );
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
  const subStatus = useSubagentStore((s) =>
    activeSubId ? (s.subagentStatusMap[activeSubId] ?? "idle") : "idle",
  );
  const subSessionStatus = useSessionStore((s) =>
    activeSubId ? s.sessionStatusMap[activeSubId] : undefined,
  );
  const subMessages = useChatStore((s) => {
    return getDisplayedMessagesForChatPanel({
      activeSessionId: null,
      activeSubsessionId: activeSubId,
      messagesBySession: s.messagesBySession,
    });
  });
  const mainMessages = useChatStore((s) => {
    return getDisplayedMessagesForChatPanel({
      activeSessionId,
      activeSubsessionId: null,
      messagesBySession: s.messagesBySession,
    });
  });
  const isViewingSubagent = !!activeSubId;
  const messages: ChatMessage[] = isViewingSubagent ? subMessages : mainMessages;
  const attachmentCount = useAttachmentStore((s) => s.attachments.length);
  const composerPlaceholders = useComposerPlaceholderStore((s) => s.placeholders);
  const hasComposerPlaceholders = composerPlaceholders.length > 0;

  const activeSessionMeta = useSessionStore(
    useCallback((s) => findSessionMeta(s.sessionsByProject, activeSessionId), [activeSessionId]),
  );
  const activeSubSessionMeta = useSessionStore(
    useCallback((s) => findSessionMeta(s.sessionsByProject, activeSubId), [activeSubId]),
  );
  const chatIdentity = isViewingSubagent
    ? getSessionIdentity(
        activeSubSessionMeta ??
          (activeSubId
            ? {
                sessionId: activeSubId,
                delegateParentSessionId: activeSessionId,
                delegateType: "subagent",
              }
            : null),
      )
    : getSessionIdentity(activeSessionMeta);
  const chatProjectPath =
    (isViewingSubagent ? activeSubSessionMeta?.projectPath : activeSessionMeta?.projectPath) ??
    activeSessionMeta?.projectPath ??
    "";
  const chatProjectName = getProjectDisplayName(chatProjectPath);

  const effectiveStatus = isViewingSubagent ? (subSessionStatus ?? subStatus) : parentStatus;

  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const currentModel = useSessionStore((s) => s.currentModel);
  const activeSessionPath = useSessionStore(
    useCallback(
      (s) => {
        if (!activeSessionId) return null;
        for (const sessions of Object.values(s.sessionsByProject)) {
          const match = sessions.find((session) => session.sessionId === activeSessionId);
          if (match?.sessionPath) return match.sessionPath;
        }
        return null;
      },
      [activeSessionId],
    ),
  );
  const projectFailed = useSessionStore(
    useCallback(
      (s) => !!activeProjectId && s.projectStartFailed[activeProjectId],
      [activeProjectId],
    ),
  );
  const projectError = useSessionStore(
    useCallback(
      (s) => (activeProjectId ? (s.projectStartError[activeProjectId] ?? "") : ""),
      [activeProjectId],
    ),
  );
  const retryActiveProject = useSessionStore((s) => s.retryActiveProject);
  const sessionReady = useSessionStore(
    useCallback((s) => !!activeSessionId && s.sessionReady[activeSessionId], [activeSessionId]),
  );
  const agentReady = useSessionStore(
    useCallback((s) => !!activeSessionId && !!s.agentReady[activeSessionId], [activeSessionId]),
  );

  const hasMoreMessages = useChatStore(
    useCallback(
      (s) => !!activeSessionId && !!s.hasMoreMessagesBySession?.[activeSessionId],
      [activeSessionId],
    ),
  );
  const isLoadingMore = useChatStore(
    useCallback(
      (s) => !!activeSessionId && !!s.isLoadingMoreBySession?.[activeSessionId],
      [activeSessionId],
    ),
  );
  const loadMoreMessages = useChatStore((s) => s.loadMoreMessages);
  const inputText = useChatStore((s) => s.inputText);
  const setInputText = useChatStore((s) => s.setInputText);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendSteer = useChatStore((s) => s.sendSteer);
  const sendFollowUp = useChatStore((s) => s.sendFollowUp);
  const setActive = useChatNavStore((s) => s.setActive);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const selectionRootRef = useRef<HTMLDivElement>(null);
  const vlistRef = useRef<VirtualizerHandle>(null);
  const inputBarRef = useRef<InputBarHandle>(null);
  const topLoadScrollAnchorRef = useRef<TopLoadScrollAnchor | null>(null);
  const topLoadLockedSessionRef = useRef<string | null>(null);
  const topLoadRestoreRafRef = useRef<number | null>(null);
  const sideNavRef = useRef<{
    getFirstIconId: () => string | null;
    getLastIconId: () => string | null;
  }>(null);
  const showThinking = useSettingsStore((s) => s.showThinking);
  const showMemoryEntries = useSettingsStore((s) => s.showMemoryEntries);
  const showToolCalls = useSettingsStore((s) => s.showToolCalls);
  const showToolResults = useSettingsStore((s) => s.showToolResults);
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const isMobileOrTablet = breakpoint === "mobile" || breakpoint === "tablet";
  const shouldRenderSideNav = messages.length > 0;
  const renderedMessages = useMemo(
    () =>
      buildProcessedMessages(messages, showMemoryEntries)
        .filter((item) => !item.hide)
        .map((item) => item.msg),
    [messages, showMemoryEntries],
  );
  const messageIds = useMemo(() => {
    if (!activeSessionId) return renderedMessages.map((m) => m.id);
    const cached = _messageIdsCache.get(activeSessionId);
    if (cached && cached.ref === renderedMessages) return cached.result;
    const result = renderedMessages.map((m) => m.id);
    _messageIdsCache.set(activeSessionId, { ref: renderedMessages, result });
    evictMsgIdsIfNeeded();
    return result;
  }, [renderedMessages, activeSessionId]);
  const collapsedMessageIdsForNav = useTurnStore(
    useCallback(
      (s) =>
        shouldRenderSideNav && activeSessionId
          ? (s.collapsedMessageIdsBySession[activeSessionId] ?? EMPTY_SET)
          : EMPTY_SET,
      [activeSessionId, shouldRenderSideNav],
    ),
  );
  const sideNavTargets = useMemo(() => {
    if (!shouldRenderSideNav) return undefined;
    return buildFlatItems(
      renderedMessages,
      showThinking,
      showMemoryEntries,
      collapsedMessageIdsForNav,
      showToolCalls,
      showToolResults,
    ).map((item) => ({
      key: item.key,
      messageId: item.navId,
      blockId: item.blockId,
    }));
  }, [
    renderedMessages,
    shouldRenderSideNav,
    showThinking,
    showMemoryEntries,
    collapsedMessageIdsForNav,
    showToolCalls,
    showToolResults,
  ]);
  const sideNavPagination = useMemo<SideNavPagination | undefined>(() => {
    if (!shouldRenderSideNav || !activeSessionId || isViewingSubagent) return undefined;
    return {
      hasMore: hasMoreMessages,
      isLoading: isLoadingMore,
      onLoadMore: () => {
        const el = messagesScrollRef.current;
        if (el) {
          topLoadScrollAnchorRef.current = {
            sessionId: activeSessionId,
            scrollHeight: el.scrollHeight,
            scrollTop: el.scrollTop,
          };
        }
        void loadMoreMessages(activeSessionId);
      },
    };
  }, [
    activeSessionId,
    hasMoreMessages,
    isLoadingMore,
    isViewingSubagent,
    loadMoreMessages,
    shouldRenderSideNav,
  ]);
  const isStreaming =
    effectiveStatus === "streaming" ||
    effectiveStatus === "compacting" ||
    effectiveStatus === "retrying";
  const isPermissionPending = effectiveStatus === "permission";
  const hasNoModel = effectiveStatus === "idle" && !currentModel;
  const commandPopup = useCommandPopup();
  const setGoal = useSupervisorStore((s) => s.setGoal);
  const refineGoal = useSupervisorStore((s) => s.refineGoal);

  const streamVersion = useChatStore(
    useCallback(
      (s) => (activeSessionId ? (s.streamVersionBySession[activeSessionId] ?? 0) : 0),
      [activeSessionId],
    ),
  );
  const historyLoadVersion = useChatStore(
    useCallback(
      (s) => (activeSessionId ? (s.historyLoadVersionBySession?.[activeSessionId] ?? 0) : 0),
      [activeSessionId],
    ),
  );
  const messageHydration = useChatStore(
    useCallback(
      (s) =>
        activeSessionId ? (s.messageHydrationBySession?.[activeSessionId] ?? "idle") : "idle",
      [activeSessionId],
    ),
  );
  const initialScrollReady =
    isViewingSubagent ||
    !activeSessionId ||
    messageHydration === "ready" ||
    messageHydration === "error";

  const agentColor = useAgentStore(
    useCallback(
      (s) => (activeSessionId ? s.agentDetailBySession[activeSessionId]?.color : undefined),
      [activeSessionId],
    ),
  );
  const agentBorderColor = agentColor ? agentColorStyle(agentColor) : null;

  const pushNotif = useNotificationStore((s) => s.push);
  const [isAborting, setIsAborting] = useState(false);
  const [goalMode, setGoalMode] = useState(false);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [isRefiningGoal, setIsRefiningGoal] = useState(false);
  const [refineStep, setRefineStep] = useState(0); // 0=idle, 1=gathering, 2=calling LLM, 3=done
  const preGoalInputRef = useRef("");
  const abortFallbackRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!activeSessionPath) return;
    void useSubagentStore.getState().loadSubsessions(activeSessionPath);
  }, [activeSessionPath]);

  useEffect(() => {
    if (!isStreaming && isAborting) {
      setIsAborting(false);
      if (abortFallbackRef.current) {
        clearTimeout(abortFallbackRef.current);
        abortFallbackRef.current = undefined;
      }
    }
  }, [isStreaming, isAborting]);

  const handleAbort = useCallback(async () => {
    if (!activeSessionId) return;
    if (activeSubId) return;
    if (isAborting) return;
    setIsAborting(true);
    try {
      const result = await apiClient.call("agent.abort", { sessionId: activeSessionId });
      if (!result.ok) {
        useSessionStore.getState().updateSessionStatus(activeSessionId, "idle");
        pushNotif({ message: "Agent already stopped", level: "info" });
        setIsAborting(false);
        return;
      }
      pushNotif({ message: "Agent stopped", level: "info" });
      abortFallbackRef.current = setTimeout(() => {
        abortFallbackRef.current = undefined;
        const sessionId = activeSessionId as string;
        const status = useSessionStore.getState().sessionStatusMap[sessionId];
        if (status === "streaming" || status === "retrying") {
          useSessionStore.getState().updateSessionStatus(sessionId, "idle");
          log.warn("Abort fallback forced session idle", { sessionId, status });
        }
        setIsAborting(false);
      }, 10000);
    } catch {
      setIsAborting(false);
      pushNotif({ message: "Failed to stop agent, please try again", level: "error" });
    }
  }, [activeSessionId, activeSubId, isAborting, pushNotif]);

  const handleSubagentFork = useCallback(async () => {
    const parentSessionId = useSessionStore.getState().activeSessionId;
    if (!parentSessionId) return;

    try {
      const treeResult = await apiClient.call("agent.getTree", {
        sessionId: parentSessionId,
      });
      const entries = treeResult.entries ?? [];
      if (entries.length === 0) return;
      const lastEntry = entries[entries.length - 1];

      useForkDialogStore.getState().openDialog({
        sessionId: parentSessionId,
        entryId: lastEntry.id,
        source: "chatPanel",
      });
    } catch (err) {
      log.warn("[ChatPanel] subagent fork error:", { err });
    }
  }, []);

  const setNavId = useTurnStore((s) => s.setNavId);
  const lastSetNavIdRef = useRef<string | null>(null);
  const navClickScrollingRef = useRef(false);
  const [isSideNavScrollLocked, setSideNavScrollLocked] = useState(false);
  const navClickScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const releaseSideNavScrollLock = useCallback(() => {
    navClickScrollingRef.current = false;
    setSideNavScrollLocked(false);
    if (navClickScrollTimerRef.current) {
      clearTimeout(navClickScrollTimerRef.current);
      navClickScrollTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    lastSetNavIdRef.current = null;
    releaseSideNavScrollLock();
  }, [activeSessionId, activeSubId, releaseSideNavScrollLock]);

  const {
    handleScroll,
    handleScrollEnd,
    scrollToMessage,
    scrollToEdge,
    isAtTop,
    isAtBottom,
    autoScrollEnabled,
    toggleAutoScroll,
    suspendAutoScroll,
    resumeAutoScroll,
  } = useActiveScrollTracker({
    scrollRef: messagesScrollRef,
    vlistRef,
    messageIds,
    activeTargets: sideNavTargets,
    sessionId: isViewingSubagent ? activeSubId : (activeSessionId ?? undefined),
    setActive: useCallback(
      (id: string | null) => {
        setActive(id);
      },
      [setActive],
    ),
    streamVersion,
    historyLoadVersion,
    initialScrollReady,
  });

  const wrappedHandleScrollEnd = useCallback(() => {
    if (navClickScrollingRef.current) releaseSideNavScrollLock();
    handleScrollEnd();
  }, [handleScrollEnd, releaseSideNavScrollLock]);

  const captureTopLoadScrollAnchor = useCallback(() => {
    if (!activeSessionId) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    topLoadScrollAnchorRef.current = {
      sessionId: activeSessionId,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
    };
  }, [activeSessionId]);

  useLayoutEffect(() => {
    if (isViewingSubagent || isLoadingMore) return;
    const anchor = topLoadScrollAnchorRef.current;
    if (!anchor || anchor.sessionId !== activeSessionId) return;
    const el = messagesScrollRef.current;
    if (!el) return;

    if (topLoadRestoreRafRef.current != null) {
      cancelAnimationFrame(topLoadRestoreRafRef.current);
    }

    topLoadRestoreRafRef.current = requestAnimationFrame(() => {
      topLoadRestoreRafRef.current = requestAnimationFrame(() => {
        topLoadRestoreRafRef.current = null;
        const currentAnchor = topLoadScrollAnchorRef.current;
        if (!currentAnchor || currentAnchor.sessionId !== activeSessionId) return;
        const scrollTop = computeTopLoadRestoredScrollTop(currentAnchor, el.scrollHeight);
        el.scrollTop = scrollTop;
        topLoadScrollAnchorRef.current = null;
      });
    });

    return () => {
      if (topLoadRestoreRafRef.current != null) {
        cancelAnimationFrame(topLoadRestoreRafRef.current);
        topLoadRestoreRafRef.current = null;
      }
    };
  }, [activeSessionId, historyLoadVersion, isLoadingMore, isViewingSubagent]);

  const handleScrollToEdge = useCallback(
    (edge: "top" | "bottom") => {
      if (messageIds.length === 0) return;
      suspendAutoScroll();
      lastSetNavIdRef.current = null;
      scrollToEdge(edge);
      setTimeout(() => {
        const iconId =
          edge === "top"
            ? sideNavRef.current?.getFirstIconId()
            : sideNavRef.current?.getLastIconId();
        if (iconId) {
          lastSetNavIdRef.current = iconId;
          setNavId(iconId);
        }
      }, 200);
    },
    [messageIds, scrollToEdge, suspendAutoScroll, setNavId],
  );

  const scrollBlockIntoViewWhenRendered = useCallback((blockId: string, attempt = 0) => {
    const blockEl = messagesScrollRef.current?.querySelector(`[data-block-id="${blockId}"]`);
    if (blockEl) {
      blockEl.scrollIntoView({ block: "start", behavior: "instant" });
      return;
    }
    if (attempt >= BLOCK_NAV_MAX_RENDER_ATTEMPTS) return;
    requestAnimationFrame(() => scrollBlockIntoViewWhenRendered(blockId, attempt + 1));
  }, []);

  const handleNavDotClick = useCallback(
    (target: SideNavTarget) => {
      suspendAutoScroll();
      navClickScrollingRef.current = true;
      setSideNavScrollLocked(true);
      if (navClickScrollTimerRef.current) clearTimeout(navClickScrollTimerRef.current);
      navClickScrollTimerRef.current = setTimeout(() => {
        releaseSideNavScrollLock();
      }, SIDE_NAV_CLICK_SCROLL_LOCK_FALLBACK_MS);

      if (!messageIds.includes(target.messageId)) {
        releaseSideNavScrollLock();
        return;
      }
      lastSetNavIdRef.current = target.blockId ?? target.messageId;
      scrollToMessage(target.messageId, { align: "start", smooth: !target.blockId });

      if (target.blockId) {
        const { blockId } = target;
        requestAnimationFrame(() => scrollBlockIntoViewWhenRendered(blockId));
      }
    },
    [
      messageIds,
      releaseSideNavScrollLock,
      scrollBlockIntoViewWhenRendered,
      scrollToMessage,
      suspendAutoScroll,
    ],
  );

  const handleSend = async () => {
    if (!inputText.trim() && attachmentCount === 0 && !hasComposerPlaceholders) return;

    const attachmentStore = useAttachmentStore.getState();
    const hasAttachments = attachmentStore.attachments.length > 0;

    if (hasAttachments) {
      const attachments = attachmentStore.attachments;
      const imageAttachments = attachments.filter((a) => a.type.startsWith("image/"));
      const fileAttachments = attachments.filter((a) => !a.type.startsWith("image/"));

      const images: ImageContent[] = [];
      for (const att of imageAttachments) {
        try {
          const arrayBuffer = await att.file.arrayBuffer();
          const { Buffer: BunBuffer } = await import("buffer");
          const base64 = BunBuffer.from(arrayBuffer).toString("base64");
          const ext = att.name.split(".").pop()?.toLowerCase();
          const mimeType =
            ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : ext === "gif"
                ? "image/gif"
                : ext === "webp"
                  ? "image/webp"
                  : "image/png";
          images.push({ type: "image", data: base64, mimeType });
        } catch {
          fileAttachments.push(att);
        }
      }

      let filePaths: string[] = [];
      if (fileAttachments.length > 0) {
        attachmentStore.clearAll();
        for (const att of fileAttachments) {
          useAttachmentStore.getState().addFiles([att.file]);
        }
        const uploaded = await useAttachmentStore.getState().uploadAll();
        filePaths = uploaded.map((a) => a.uploadedPath).filter(Boolean) as string[];
      }

      attachmentStore.clearAll();

      if (images.length > 0) {
        useChatStore.getState().setPendingImages(images);
      }

      if (filePaths.length > 0) {
        const fileRefs = filePaths.map((p) => `@${p}`).join(" ");
        const currentText = useChatStore.getState().inputText;
        const text = currentText.trim() ? `${currentText.trim()}\n${fileRefs}` : fileRefs;
        useChatStore.getState().setInputText(text);
      }
    }

    const placeholders = useComposerPlaceholderStore.getState().placeholders;
    if (placeholders.length > 0) {
      await persistComposerPlaceholders(placeholders, (path, content) =>
        apiClient.call("file.writeFile", { path, content }),
      );
      const currentText = useChatStore.getState().inputText;
      useChatStore.getState().setInputText(composeInputWithPlaceholders(currentText, placeholders));
    }

    if (isStreaming) {
      await sendSteer();
    } else {
      await sendMessage();
    }
    if (placeholders.length > 0) {
      useComposerPlaceholderStore.getState().clearPlaceholders();
    }
    resumeAutoScroll();
    if (isMobileOrTablet) {
      inputBarRef.current?.blur();
    }
  };

  const startGoalMode = useCallback(
    (objective?: string) => {
      if (isViewingSubagent) return;
      if (goalMode) {
        // Toggle off: exit goal mode
        setGoalMode(false);
        setInputText(preGoalInputRef.current);
        preGoalInputRef.current = "";
        return;
      }
      preGoalInputRef.current = inputText;
      setInputText(objective ?? inputText);
      setGoalMode(true);
      commandPopup.closePopup();
      requestAnimationFrame(() => inputBarRef.current?.focus?.());
    },
    [commandPopup, goalMode, inputText, isViewingSubagent, setInputText],
  );

  const handleCreateGoal = useCallback(async () => {
    const objective = inputText.trim();
    if (!activeSessionId || !objective || isCreatingGoal) return;
    setIsCreatingGoal(true);
    try {
      await setGoal(activeSessionId, objective);
      if (effectiveStatus === "idle") {
        await sendMessage();
      }
      setInputText("");
      setGoalMode(false);
      preGoalInputRef.current = "";
      resumeAutoScroll();
      if (isMobileOrTablet) {
        inputBarRef.current?.blur();
      }
    } finally {
      setIsCreatingGoal(false);
    }
  }, [
    activeSessionId,
    effectiveStatus,
    inputText,
    isCreatingGoal,
    isMobileOrTablet,
    resumeAutoScroll,
    sendMessage,
    setGoal,
  ]);

  const handleRefineGoal = useCallback(async () => {
    const objective = inputText.trim();
    if (!activeSessionId || !objective || isRefiningGoal) return;
    setIsRefiningGoal(true);
    setRefineStep(1);
    // Simulate the gathering step visible to user, then call LLM
    await new Promise((r) => setTimeout(r, 300));
    setRefineStep(2);
    try {
      const result = await refineGoal(activeSessionId, objective);
      if (result.success && result.objective) {
        setInputText(result.objective);
      }
      setRefineStep(3);
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      setIsRefiningGoal(false);
      setRefineStep(0);
    }
  }, [activeSessionId, inputText, isRefiningGoal, refineGoal, setInputText]);

  const handleFollowUp = async () => {
    if (!inputText.trim() || !isStreaming) return;
    await sendFollowUp();
  };

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    const files: File[] = [];
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === "file") {
          const file = item.getAsFile();
          if (file) files.push(file);
        }
      }
    }
    const clipboardFiles = Array.from(e.clipboardData?.files ?? []);
    for (const file of clipboardFiles) {
      if (!files.some((existing) => existing.name === file.name && existing.size === file.size)) {
        files.push(file);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      useAttachmentStore.getState().addFiles(files);
    }
  }, []);

  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    const items = e.dataTransfer?.items;
    if (!items) return;
    const files: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.kind === "file") {
        const file = item.getAsFile();
        if (file) files.push(file);
      }
    }
    if (files.length > 0) {
      useAttachmentStore.getState().addFiles(files);
    }
  }, []);

  useEffect(() => {
    if (!isAtTop || !hasMoreMessages || isViewingSubagent) {
      topLoadLockedSessionRef.current = null;
    }
  }, [activeSessionId, hasMoreMessages, isAtTop, isViewingSubagent]);

  useEffect(() => {
    if (
      !shouldStartTopLoad({
        activeSessionId,
        isAtTop,
        hasMoreMessages,
        isLoadingMore,
        isViewingSubagent,
        lockedSessionId: topLoadLockedSessionRef.current,
      })
    ) {
      return;
    }
    const sessionId = activeSessionId;
    if (!sessionId) return;
    topLoadLockedSessionRef.current = sessionId;
    captureTopLoadScrollAnchor();
    loadMoreMessages?.(sessionId);
  }, [
    activeSessionId,
    captureTopLoadScrollAnchor,
    isAtTop,
    hasMoreMessages,
    isLoadingMore,
    isViewingSubagent,
    loadMoreMessages,
  ]);

  return (
    <div
      className="flex-1 min-h-0 flex flex-col overflow-hidden relative bg-bg-elevated"
      style={agentBorderColor ? { borderLeft: `2px solid ${agentBorderColor.border}` } : undefined}
    >
      <MermaidFullscreen />
      <RollbackOverlay />
      <ForkDialog />
      <div className="flex items-center gap-4 px-4 py-1.5 bg-bg-secondary/90 border-b border-border-primary text-[11px] text-text-tertiary flex-shrink-0">
        <SessionToggleIcon />
        {activeSessionId && <TokenStatusBar sessionId={activeSessionId} />}
        <ReturnToSourceButton variant="top" />
        {chatIdentity && (
          <span
            data-testid="chat-session-identity-badge"
            data-session-kind={chatIdentity.kind}
            className={`inline-flex min-w-0 max-w-[220px] items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${sessionIdentityClass(chatIdentity)}`}
            title={
              chatProjectPath ? `${chatIdentity.title} · ${chatProjectPath}` : chatIdentity.title
            }
          >
            {chatIdentity.kind === "fork" ? (
              <GitFork className="h-3 w-3 shrink-0" />
            ) : (
              <Bot className="h-3 w-3 shrink-0" />
            )}
            <span className="shrink-0">{chatIdentity.label}</span>
            {chatProjectName && (
              <span className="min-w-0 truncate text-current/75">{chatProjectName}</span>
            )}
          </span>
        )}
        <div className="ml-auto flex items-center gap-1">
          <UIPendingCenter />
          <NotificationCenter />
          <ChangeReviewBell />
          <StatusToggleIcon />
        </div>
      </div>

      <RetryNotification />

      <div className="flex-1 min-h-0 flex overflow-hidden">
        <div className="flex-1 min-h-0 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 min-w-0 relative overflow-hidden">
            {projectFailed && !isViewingSubagent ? (
              <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 max-w-xs text-center">
                  <AlertTriangle className="w-8 h-8 text-status-warning" />
                  <div className="text-sm text-text-secondary">{t("sessionStartFailed")}</div>
                  {projectError && (
                    <div className="whitespace-pre-line break-words text-xs text-text-tertiary">
                      {projectError}
                    </div>
                  )}
                  <button
                    onClick={retryActiveProject}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-semantic-accent text-white text-xs hover:bg-semantic-accent transition-colors"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    {t("retry")}
                  </button>
                </div>
              </div>
            ) : (
              <div ref={selectionRootRef} className="relative h-full">
                <MessageListView
                  source={isViewingSubagent ? "sub" : "main"}
                  scrollRef={messagesScrollRef}
                  vlistRef={vlistRef}
                  onScroll={handleScroll}
                  onScrollEnd={wrappedHandleScrollEnd}
                  isLoadingMore={!isViewingSubagent ? isLoadingMore : undefined}
                  hasMoreMessages={!isViewingSubagent ? hasMoreMessages : undefined}
                  activeSessionId={(isViewingSubagent ? activeSubId : activeSessionId) ?? undefined}
                  bufferSize={isMobileOrTablet ? 360 : 800}
                />
                <TextSelectionToolbar
                  rootRef={selectionRootRef}
                  onQuoteText={(text) => useComposerPlaceholderStore.getState().addTextQuote(text)}
                  onFocusInput={() => inputBarRef.current?.focus()}
                />
              </div>
            )}
            {messages.length > 0 && (
              <ScrollToolbar
                isAtTop={isAtTop}
                isAtBottom={isAtBottom}
                autoScrollEnabled={autoScrollEnabled}
                onScrollToTop={() => handleScrollToEdge("top")}
                onScrollToBottom={() => handleScrollToEdge("bottom")}
                onToggleAutoScroll={toggleAutoScroll}
              />
            )}
          </div>
          {activeSessionId && !isViewingSubagent && (
            <>
              {!goalMode && <GoalActionCard sessionId={activeSessionId} onEdit={startGoalMode} />}
              <QueueCards sessionId={activeSessionId} />
            </>
          )}
        </div>
        {shouldRenderSideNav && (
          <div className="w-10 shrink-0 overflow-hidden">
            <SideNav
              ref={sideNavRef}
              messages={renderedMessages}
              onNavDotClick={handleNavDotClick}
              pagination={sideNavPagination}
              isScrollLocked={isSideNavScrollLocked}
            />
          </div>
        )}
      </div>

      <MessageSelectionBar
        messageIds={messageIds}
        messages={messages}
        onDeleteSelected={(ids) => {
          void ids;
        }}
      />

      {!goalMode && !isViewingSubagent && (
        <QuickActionToolbar onGoalClick={() => startGoalMode()} />
      )}

      <div
        className={`px-3 pt-1.5 pb-1 flex-shrink-0 bg-bg-secondary border-t border-border-primary relative ${isDragOver ? "ring-2 ring-semantic-accent/50 bg-semantic-accent/5" : ""}`}
        style={
          isMobileOrTablet
            ? undefined
            : { paddingBottom: "calc(0.25rem + env(safe-area-inset-bottom))" }
        }
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <ProjectRuntimePendingRequests
          activeSessionId={isViewingSubagent ? activeSubId : activeSessionId}
          placement="composerOverlay"
        />
        {!isViewingSubagent ? (
          (!sessionReady || !agentReady) && !projectFailed ? (
            <div className="flex-1 flex items-center justify-center gap-2 py-2">
              <Loader2 className="w-3.5 h-3.5 text-text-tertiary animate-spin" />
              <span className="text-xs text-text-tertiary">{t("sessionStarting")}</span>
            </div>
          ) : (
            <>
              <div className="flex items-end gap-1.5">
                <div className="relative flex-1 overflow-visible rounded-xl border border-border-primary bg-bg-elevated/95 transition-colors focus-within:border-border-focus focus-within:shadow-sm">
                  {isRefiningGoal && <RefineGoalOverlay step={refineStep} />}
                  {!goalMode && <AttachmentBar />}
                  {!goalMode && <ComposerPlaceholderBar />}
                  <InputBar
                    ref={inputBarRef}
                    onSend={goalMode ? handleCreateGoal : handleSend}
                    sessionId={activeSessionId ?? ""}
                    disabled={!activeSessionId || isCreatingGoal}
                    placeholder={goalMode ? t("goal.inputPlaceholder") : undefined}
                    historyEnabled={!goalMode}
                    hasExternalContent={!goalMode && hasComposerPlaceholders}
                    embedded
                    onPasteTextAsPlaceholder={
                      !goalMode
                        ? (text) =>
                            Boolean(
                              useComposerPlaceholderStore.getState().addLongContentPaste(text),
                            )
                        : undefined
                    }
                    onTriggerPopup={
                      !goalMode && !isMobileOrTablet ? commandPopup.openPopup : undefined
                    }
                    popupOpen={!goalMode && !isMobileOrTablet && !!commandPopup.popupMode}
                    onPopupConfirm={commandPopup.confirmSelection}
                    onPopupCancel={commandPopup.closePopup}
                    onPopupArrowUp={commandPopup.navigateUp}
                    onPopupArrowDown={commandPopup.navigateDown}
                  />
                  <div className="flex min-h-10 items-center justify-between gap-2 border-t border-border-primary/70 px-2.5 py-1.5">
                    <AttachmentButtons
                      layout="compact"
                      mode={goalMode ? "goal" : "normal"}
                      onGoalClick={() => startGoalMode()}
                      onExitGoalMode={() => startGoalMode()}
                    />
                    {!goalMode && (
                      <div className="hidden text-[11px] text-text-tertiary sm:block">
                        {attachmentCount > 0
                          ? t("fileAttachment.count", { count: attachmentCount })
                          : t("composerActionsHint")}
                      </div>
                    )}
                  </div>
                </div>

                <div className="flex shrink-0 flex-col justify-end gap-1.5 py-1">
                  {goalMode ? (
                    <button
                      onClick={() => void handleRefineGoal()}
                      disabled={isCreatingGoal || isRefiningGoal || !inputText.trim()}
                      className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${isRefiningGoal ? "bg-semantic-accent/20 text-semantic-accent" : "bg-surface-dim text-text-secondary hover:bg-surface-hover hover:text-semantic-accent"} disabled:opacity-50 disabled:cursor-not-allowed`}
                      title={t("goal.refine")}
                      aria-label={t("goal.refine")}
                    >
                      {isRefiningGoal ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Sparkles className="w-4 h-4" />
                      )}
                    </button>
                  ) : isStreaming && inputText.trim() ? (
                    <button
                      onClick={handleFollowUp}
                      className="p-2.5 rounded-lg transition-colors flex items-center justify-center bg-status-info text-white hover:bg-status-info shadow-sm shadow-status-info/20"
                      title={t("sendFollowUp")}
                      aria-label={t("sendFollowUp")}
                    >
                      <Clock className="w-4 h-4" />
                    </button>
                  ) : isStreaming ? (
                    <button
                      onClick={handleAbort}
                      disabled={isAborting}
                      className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${isAborting ? "bg-status-error/40 text-white/70 cursor-wait" : "bg-status-error text-white hover:bg-status-error active:scale-90"}`}
                      title={isAborting ? t("stopping") : t("stop")}
                      aria-label={isAborting ? t("stopping") : t("stop")}
                    >
                      {isAborting ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Square className="w-4 h-4" />
                      )}
                    </button>
                  ) : (
                    <button
                      disabled
                      className="p-2.5 rounded-lg transition-colors flex items-center justify-center bg-status-error/30 text-status-error/50 cursor-not-allowed"
                      title={t("stop")}
                      aria-label={t("stop")}
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() =>
                      goalMode ? void handleCreateGoal() : inputBarRef.current?.send()
                    }
                    disabled={
                      !agentReady ||
                      isAborting ||
                      isCreatingGoal ||
                      isPermissionPending ||
                      (goalMode
                        ? !inputText.trim()
                        : !inputText.trim() && attachmentCount === 0 && !hasComposerPlaceholders) ||
                      !activeSessionId ||
                      hasNoModel
                    }
                    className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${!isAborting && !isCreatingGoal && (inputText.trim() || (!goalMode && (attachmentCount > 0 || hasComposerPlaceholders))) && activeSessionId && !hasNoModel ? (goalMode ? "bg-semantic-accent text-white hover:bg-semantic-accent shadow-sm shadow-semantic-accent/20" : isStreaming ? "bg-status-warning text-white hover:bg-status-warning shadow-sm shadow-status-warning/20" : "bg-semantic-accent text-white hover:bg-semantic-accent shadow-sm shadow-semantic-accent/20") : "bg-surface-dim text-text-tertiary cursor-not-allowed"}`}
                    title={
                      isPermissionPending
                        ? t("waitPermission")
                        : hasNoModel
                          ? t("sendDisabledNoModel")
                          : goalMode
                            ? t("goal.create")
                            : isStreaming
                              ? t("steer")
                              : t("send")
                    }
                    aria-label={
                      isPermissionPending
                        ? t("waitPermission")
                        : hasNoModel
                          ? t("sendDisabledNoModel")
                          : goalMode
                            ? t("goal.create")
                            : isStreaming
                              ? t("steer")
                              : t("send")
                    }
                  >
                    {isCreatingGoal ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : goalMode ? (
                      <Target className="w-4 h-4" />
                    ) : isStreaming ? (
                      <Zap className="w-4 h-4" />
                    ) : (
                      <ArrowUp className="w-4 h-4" />
                    )}
                  </button>
                </div>
              </div>
            </>
          )
        ) : null}
        {isViewingSubagent && (
          <div className="flex-1 flex items-center justify-center gap-3 py-2">
            <span className="text-[11px] text-text-tertiary">{t("subagentReadonly")}</span>
            <ReturnToSourceButton variant="bottom" />
            <button
              onClick={handleSubagentFork}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium
                bg-semantic-accent/15 text-semantic-accent hover:bg-semantic-accent/25 hover:text-semantic-accent
                border border-semantic-accent/20 transition-colors"
              title={t("fork")}
            >
              <GitFork className="w-3 h-3" />
              {t("fork")}
            </button>
          </div>
        )}
        {!isMobileOrTablet && !isViewingSubagent && (
          <CommandPopup
            popupMode={commandPopup.popupMode}
            atTab={commandPopup.atTab}
            items={commandPopup.items}
            loading={commandPopup.loading}
            activeIndex={commandPopup.activeIndex}
            query={commandPopup.query}
            fileBreadcrumbs={commandPopup.fileBreadcrumbs}
            onSetAtTab={commandPopup.setAtTab}
            onSelect={commandPopup.handleSelect}
            onClose={commandPopup.closePopup}
            onBreadcrumb={commandPopup.handleBreadcrumb}
            onListKeyDown={commandPopup.handleListKeyDown}
            onSetActiveIndex={commandPopup.setActiveIndex}
          />
        )}
      </div>
    </div>
  );
}

export function ReturnToSourceButton({ variant = "bottom" }: { variant?: "top" | "bottom" }) {
  const { t } = useTranslation("chat");
  const returnTarget = useReturnToSourceSession();
  if (!returnTarget) return null;

  const label =
    returnTarget.kind === "subagent"
      ? t("backToMain")
      : returnTarget.kind === "delegate"
        ? t("backToDelegate", "返回委派方")
        : t("backToSource", "返回来源");
  const sizeClass = variant === "top" ? "px-2 py-0.5 text-[10px]" : "px-2.5 py-1 text-[11px]";

  return (
    <button
      type="button"
      onClick={returnTarget.handleReturn}
      className={`inline-flex items-center justify-center gap-1 rounded-md font-medium whitespace-nowrap text-semantic-agent bg-semantic-agent/10 hover:bg-semantic-agent/15 border border-semantic-agent/20 transition-colors ${sizeClass}`}
      title={label}
      aria-label={label}
    >
      <ArrowLeft className="w-3 h-3 shrink-0" />
      <Bot className="w-3 h-3 shrink-0" />
      <span>{label}</span>
    </button>
  );
}

export function BackToMainSessionButton({
  activeSessionId,
  onBack,
}: {
  activeSessionId?: string | null;
  onBack?: () => void;
}) {
  const { t } = useTranslation("chat");

  const handleClick = useCallback(() => {
    if (onBack) {
      onBack();
      return;
    }
    if (activeSessionId) {
      useSubagentStore.getState().setActiveSubsession(activeSessionId, null);
    }
  }, [activeSessionId, onBack]);

  return (
    <button
      type="button"
      onClick={handleClick}
      className="inline-flex items-center justify-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap text-semantic-agent bg-semantic-agent/10 hover:bg-semantic-agent/15 border border-semantic-agent/20 transition-colors"
      title={t("backToMain")}
      aria-label={t("backToMain")}
    >
      <ArrowLeft className="w-3 h-3 shrink-0" />
      <Bot className="w-3 h-3 shrink-0" />
      <span>{t("backToMain")}</span>
    </button>
  );
}

function SessionToggleIcon() {
  const { t } = useTranslation("chat");
  const sessionPanel = useLayoutStore((s) => s.sessionPanel);
  const sessionCollapsed = useLayoutStore((s) => s.sessionCollapsed);
  const toggleSessionCollapse = useLayoutStore((s) => s.toggleSessionCollapse);
  const showSession = useLayoutStore((s) => s.showSession);
  const hideSession = useLayoutStore((s) => s.hideSession);
  const isMobile = useLayoutStore((s) => s.breakpoint) === "mobile";

  if (sessionCollapsed && !isMobile) {
    return (
      <button
        onClick={(e) => {
          e.stopPropagation();
          toggleSessionCollapse();
        }}
        className="p-1 rounded transition-colors text-text-tertiary hover:text-text-primary hover:bg-surface-hover"
        title={t("openSessionPanel")}
      >
        <PanelLeft className="w-3.5 h-3.5" />
      </button>
    );
  }

  if (sessionPanel === "pinned" && !isMobile) return null;

  const isVisible = sessionPanel === "visible";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (isVisible) {
          hideSession();
        } else {
          showSession();
        }
      }}
      className={`p-1 rounded transition-colors ${isVisible ? "text-semantic-accent hover:text-semantic-accent bg-semantic-accent/10" : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover"}`}
      title={isVisible ? t("closeSessionPanel") : t("openSessionPanel")}
    >
      <PanelLeft className="w-3.5 h-3.5" />
    </button>
  );
}

function StatusToggleIcon() {
  const { t } = useTranslation("chat");
  const statusPanel = useLayoutStore((s) => s.statusPanel);
  const showStatus = useLayoutStore((s) => s.showStatus);
  const hideStatus = useLayoutStore((s) => s.hideStatus);
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const isMobile = breakpoint === "mobile";
  const isTablet = breakpoint === "tablet";

  if (statusPanel === "pinned" && !isMobile && !isTablet) return null;

  const isVisible = statusPanel === "visible";

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        if (isVisible) {
          hideStatus();
        } else {
          showStatus();
        }
      }}
      className={`p-1 rounded transition-colors ${isVisible ? "text-semantic-accent hover:text-semantic-accent bg-semantic-accent/10" : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover"}`}
      title={isVisible ? t("closeStatusPanel") : t("openStatusPanel")}
    >
      <PanelRight className="w-3.5 h-3.5" />
    </button>
  );
}

function ChangeReviewBell() {
  const pendingReviewCount = useChangeReviewStore(
    (s) => s.changes.filter((c) => c.status === "pending").length,
  );
  const fetchPending = useChangeReviewStore((s) => s.fetchPending);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const { t } = useTranslation("sidebar");

  useEffect(() => {
    if (activeSessionId) {
      fetchPending();
    }
  }, [activeSessionId, fetchPending]);

  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        const layout = useLayoutStore.getState();
        layout.openStatusPanel("changeReview");
        fetchPending();
      }}
      className="p-1 rounded transition-colors text-text-tertiary dark:text-text-secondary hover:text-text-primary dark:hover:text-text-secondary relative"
      title={t("changeReview")}
      aria-label={t("changeReview")}
    >
      <ClipboardCheck className="w-3.5 h-3.5" />
      {pendingReviewCount > 0 && (
        <span className="absolute -top-0.5 -right-0.5 min-w-[10px] h-[10px] flex items-center justify-center bg-status-warning rounded-full text-[7px] leading-none text-white font-bold px-[2px]">
          {pendingReviewCount > 9 ? "9+" : pendingReviewCount}
        </span>
      )}
    </button>
  );
}
