import { useCallback, useEffect, useMemo, useRef } from "react";
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
  GitBranch,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/use-chat-store";
import { useSessionStore } from "../../stores/use-session-store";
import { NotificationCenter } from "./NotificationCenter";
import { UIPendingCenter } from "./UIPendingCenter";
import { RetryNotification } from "./RetryNotification";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useChatNavStore } from "../../stores/use-chat-nav-store";
import { useTurnStore } from "../../stores/use-turn-store";
import { apiClient } from "../../lib/api-client";
import { useActiveScrollTracker } from "../../hooks/use-active-scroll-tracker";
import type { VirtualizerHandle } from "virtua";
import { SideNav } from "./SideNav";
import { InputBar, type InputBarHandle } from "./InputBar";
import { TokenStatusBar } from "./TokenStatusBar";
import { MessageListView } from "./MessageListView";
import { MessageSelectionBar } from "./MessageSelectionBar";
import { QuickActionToolbar } from "./QuickActionToolbar";
import { CommandPopup } from "./CommandPopup";
import { useCommandPopup } from "../../hooks/use-command-popup";
import { ScrollToolbar } from "./ScrollToolbar";
import { QueueCards } from "./QueueCards";
import { MarkdownExpandOverlay } from "./MarkdownExpandOverlay";
import { MermaidFullscreen } from "./mermaid";
import { RollbackOverlay } from "./RollbackOverlay";
import { AttachmentButtons, AttachmentBar } from "./FileAttachment";
import { useAttachmentStore } from "../../stores/use-attachment-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useTierStore } from "../../stores/use-tier-store";
import { insertAfterPinned } from "../../stores/use-session-store";
import type { ChatMessage, SessionMeta } from "../../types";

const EMPTY_MSGS: never[] = [];

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
  const subMessages = useSubagentStore((s) => {
    if (!activeSubId) return EMPTY_MSGS;
    return s.messagesBySubsession[activeSubId] || EMPTY_MSGS;
  });
  const mainMessages = useChatStore((s) => {
    if (!activeSessionId) return EMPTY_MSGS;
    return s.messagesBySession[activeSessionId] || EMPTY_MSGS;
  });
  const isViewingSubagent = !!activeSubId;
  const messages: ChatMessage[] = isViewingSubagent ? subMessages : mainMessages;

  const effectiveStatus = isViewingSubagent ? subStatus : parentStatus;

  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const currentModel = useSessionStore((s) => s.currentModel);
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

  const isLoading = useChatStore(
    useCallback(
      (s) => !!activeSessionId && s.loadingSessions.has(activeSessionId),
      [activeSessionId],
    ),
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
  const sendMessage = useChatStore((s) => s.sendMessage);
  const sendSteer = useChatStore((s) => s.sendSteer);
  const sendFollowUp = useChatStore((s) => s.sendFollowUp);
  const setInputText = useChatStore((s) => s.setInputText);
  const setActive = useChatNavStore((s) => s.setActive);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const vlistRef = useRef<VirtualizerHandle>(null);
  const inputBarRef = useRef<InputBarHandle>(null);
  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const isStreaming =
    effectiveStatus === "streaming" ||
    effectiveStatus === "compacting" ||
    effectiveStatus === "retrying";
  const hasNoModel = effectiveStatus === "idle" && !currentModel;
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const isMobileOrTablet = breakpoint === "mobile" || breakpoint === "tablet";
  const commandPopup = useCommandPopup();

  const streamVersion = useChatStore((s) => s.streamContentVersion);
  const historyLoadVersion = useChatStore((s) => s.historyLoadVersion);

  const handleAbort = useCallback(async () => {
    if (!activeSessionId) return;
    if (activeSubId) return;
    try {
      await apiClient.call("agent.abort", { sessionId: activeSessionId });
    } catch {
      /* ignore */
    }
  }, [activeSessionId, activeSubId]);

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

      const result = await apiClient
        .call("agent.fork", {
          sessionId: parentSessionId,
          entryId: lastEntry.id,
          position: "at",
        })
        .catch((err) => {
          console.warn("[ChatPanel] fork failed:", err);
          return undefined;
        });

      if (!result || result.cancelled || !result.newSessionId || !result.newSessionFile) return;

      const state = useSessionStore.getState();
      const activeTab = state.projectTabs.find((t) => t.id === state.activeProjectId);
      if (!activeTab) return;

      // Fetch original session name for the "fork:" prefix
      const allSessions = state.sessionsByProject[activeTab.path] ?? [];
      const originalSession = allSessions.find((s) => s.sessionId === parentSessionId);
      const originalName = originalSession
        ? originalSession.name || originalSession.firstMessage || ""
        : "";

      const now = Date.now();
      const forkedSession: SessionMeta = {
        sessionId: result.newSessionId,
        name: originalName ? `fork: ${originalName}` : "",
        sessionPath: result.newSessionFile,
        projectPath: activeTab.path,
        parentSessionPath: null,
        messageCount: 0,
        firstMessage: "",
        createdAt: now,
        updatedAt: now,
        status: "idle",
      };

      useSessionStore.setState((s) => ({
        sessionsByProject: {
          ...s.sessionsByProject,
          [activeTab.path]: insertAfterPinned(
            s.sessionsByProject[activeTab.path] || [],
            forkedSession,
          ),
        },
      }));

      useSessionStore.getState().setActiveSession(result.newSessionId);
      useChatStore.getState().loadSessionMessages(result.newSessionId, {
        force: true,
      });

      // Inherit current tier config
      const currentTier = useTierStore.getState().currentTier;
      if (currentTier) {
        useTierStore.getState().switchToTier(currentTier, result.newSessionId);
      }

      const pushNotification = useNotificationStore.getState().push;
      pushNotification({
        message: t("messageCard.forked"),
        level: "info",
      });
    } catch (err) {
      console.warn("[ChatPanel] subagent fork error:", err);
    }
  }, [t]);

  const setNavId = useTurnStore((s) => s.setNavId);
  const lastSetNavIdRef = useRef<string | null>(null);
  const navScrollingRef = useRef(false);
  const navScrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    lastSetNavIdRef.current = null;
    navScrollingRef.current = false;
    if (navScrollTimerRef.current) {
      clearTimeout(navScrollTimerRef.current);
      navScrollTimerRef.current = null;
    }
  }, [activeSessionId, activeSubId]);

  const {
    handleScroll,
    handleScrollEnd,
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
    sessionId: isViewingSubagent ? activeSubId : (activeSessionId ?? undefined),
    setActive: useCallback(
      (id: string | null) => {
        setActive(id);
        if (navScrollingRef.current) return;
        if (id && id !== lastSetNavIdRef.current) {
          lastSetNavIdRef.current = id;
          setNavId(id);
        }
      },
      [setActive, setNavId],
    ),
    streamVersion,
    historyLoadVersion,
  });

  const wrappedHandleScrollEnd = useCallback(() => {
    navScrollingRef.current = false;
    if (navScrollTimerRef.current) {
      clearTimeout(navScrollTimerRef.current);
      navScrollTimerRef.current = null;
    }
    handleScrollEnd();
  }, [handleScrollEnd]);

  const handleScrollToEdge = useCallback(
    (edge: "top" | "bottom") => {
      if (messageIds.length === 0) return;
      const id = edge === "top" ? messageIds[0] : messageIds[messageIds.length - 1];
      setNavId(id);
      if (edge === "top") suspendAutoScroll();
      scrollToEdge(edge);
    },
    [messageIds, setNavId, scrollToEdge, suspendAutoScroll],
  );

  const handleNavDotClick = useCallback(
    (navId: string) => {
      suspendAutoScroll();
      navScrollingRef.current = true;
      if (navScrollTimerRef.current) clearTimeout(navScrollTimerRef.current);
      navScrollTimerRef.current = setTimeout(() => {
        navScrollingRef.current = false;
        navScrollTimerRef.current = null;
      }, 800);

      let index = messageIds.indexOf(navId);
      if (index !== -1) {
        lastSetNavIdRef.current = navId;
        vlistRef.current?.scrollToIndex(index, { smooth: true });
        return;
      }

      const lastDashIdx = navId.lastIndexOf("-");
      if (lastDashIdx < 0) return;
      const msgId = navId.slice(0, lastDashIdx);
      index = messageIds.indexOf(msgId);
      if (index === -1) return;
      lastSetNavIdRef.current = msgId;
      vlistRef.current?.scrollToIndex(index, { smooth: true });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          const blockEl = messagesScrollRef.current?.querySelector(`[data-block-id="${navId}"]`);
          if (blockEl) blockEl.scrollIntoView({ block: "start", behavior: "instant" });
        });
      });
    },
    [messageIds, suspendAutoScroll],
  );

  const handleSend = async () => {
    if (!sessionReady) return;
    if (!inputText.trim() && useAttachmentStore.getState().attachments.length === 0) return;

    const attachmentStore = useAttachmentStore.getState();
    const hasAttachments = attachmentStore.attachments.length > 0;

    if (hasAttachments) {
      const uploaded = await attachmentStore.uploadAll();
      const failedCount = attachmentStore.attachments.filter((a) => a.status === "error").length;

      if (failedCount > 0 && uploaded.length === 0) return;

      const filePaths = uploaded.map((a) => a.uploadedPath).filter(Boolean) as string[];
      attachmentStore.clearAll();

      if (filePaths.length > 0) {
        const fileRefs = filePaths.map((p) => `@${p}`).join(" ");
        const text = inputText.trim() ? `${inputText.trim()}\n${fileRefs}` : fileRefs;
        useChatStore.getState().setInputText(text);
      }
    }

    if (isStreaming) {
      await sendSteer();
    } else {
      await sendMessage();
    }
    resumeAutoScroll();
    if (isMobileOrTablet) {
      inputBarRef.current?.blur();
    }
  };

  const handleFollowUp = async () => {
    if (!inputText.trim() || !isStreaming) return;
    await sendFollowUp();
  };

  useEffect(() => {
    if (!activeSessionId || !isAtTop || !hasMoreMessages || isLoadingMore || isViewingSubagent)
      return;
    loadMoreMessages?.(activeSessionId);
  }, [
    activeSessionId,
    isAtTop,
    hasMoreMessages,
    isLoadingMore,
    isViewingSubagent,
    loadMoreMessages,
  ]);

  const handleBackToMain = () => {
    if (activeSessionId) {
      useSubagentStore.getState().setActiveSubsession(activeSessionId, null);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative bg-white dark:bg-gray-950">
      <MarkdownExpandOverlay />
      <MermaidFullscreen />
      <RollbackOverlay />
      <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-100/80 dark:bg-gray-900/80 border-b border-gray-300 dark:border-gray-800 text-[11px] text-gray-500 dark:text-gray-500 flex-shrink-0">
        <SessionToggleIcon />
        {isViewingSubagent && (
          <button
            onClick={handleBackToMain}
            className="flex items-center gap-1 text-semantic-agent hover:text-semantic-agent transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            <Bot className="w-3 h-3" />
            <span>{t("backToMain")}</span>
          </button>
        )}
        {activeSessionId && <TokenStatusBar sessionId={activeSessionId} />}
        <div className="ml-auto flex items-center gap-1">
          <UIPendingCenter />
          <NotificationCenter />
          <StatusToggleIcon />
        </div>
      </div>

      <RetryNotification />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0 relative">
          {projectFailed && !isViewingSubagent && !isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-3 max-w-xs text-center">
                <AlertTriangle className="w-8 h-8 text-status-warning" />
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  {t("sessionStartFailed")}
                </div>
                {projectError && (
                  <div className="text-xs text-gray-400 dark:text-gray-500 break-all">
                    {projectError}
                  </div>
                )}
                <button
                  onClick={retryActiveProject}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs hover:bg-indigo-700 transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t("retry")}
                </button>
              </div>
            </div>
          ) : isLoading ? (
            <div className="h-full flex items-center justify-center">
              <div className="flex flex-col items-center gap-2 opacity-50">
                <Loader2 className="w-5 h-5 text-gray-400 dark:text-gray-500 animate-spin" />
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {t("loadingSession")}
                </span>
              </div>
            </div>
          ) : isViewingSubagent ? (
            <MessageListView
              messages={messages}
              scrollRef={messagesScrollRef}
              vlistRef={vlistRef}
              onScroll={handleScroll}
              onScrollEnd={wrappedHandleScrollEnd}
            />
          ) : (
            <MessageListView
              messages={mainMessages}
              scrollRef={messagesScrollRef}
              vlistRef={vlistRef}
              onScroll={handleScroll}
              onScrollEnd={wrappedHandleScrollEnd}
              isLoadingMore={isLoadingMore}
              hasMoreMessages={hasMoreMessages}
            />
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
        <div className="w-12 shrink-0 overflow-hidden">
          <SideNav messages={messages} onNavDotClick={handleNavDotClick} />
        </div>
      </div>

      <MessageSelectionBar
        messageIds={messageIds}
        messages={messages}
        onDeleteSelected={(ids) => {
          void ids;
        }}
      />

      {!isViewingSubagent && <QuickActionToolbar />}

      {activeSessionId && !isViewingSubagent && <QueueCards sessionId={activeSessionId} />}

      <div
        className="px-3 pt-2 pb-1.5 flex-shrink-0 flex items-stretch gap-1.5 bg-gray-100 dark:bg-gray-900 border-t border-gray-300 dark:border-gray-800 relative"
        style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
      >
        {!isViewingSubagent && (
          <>
            {!sessionReady && !projectFailed ? (
              <div className="flex-1 flex items-center justify-center gap-2 py-2">
                <Loader2 className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500 animate-spin" />
                <span className="text-xs text-gray-400 dark:text-gray-500">
                  {t("sessionStarting")}
                </span>
              </div>
            ) : (
              <>
                <AttachmentBar />
                {!isMobileOrTablet && <AttachmentButtons />}

                <InputBar
                  ref={inputBarRef}
                  value={inputText}
                  onChange={setInputText}
                  onSend={handleSend}
                  sessionId={activeSessionId ?? ""}
                  disabled={!sessionReady}
                  onTriggerPopup={!isMobileOrTablet ? commandPopup.openPopup : undefined}
                  popupOpen={!isMobileOrTablet && !!commandPopup.popupMode}
                  onPopupConfirm={commandPopup.confirmSelection}
                  onPopupCancel={commandPopup.closePopup}
                  onPopupArrowUp={commandPopup.navigateUp}
                  onPopupArrowDown={commandPopup.navigateDown}
                />

                <div className="flex flex-col gap-1.5 shrink-0 justify-between py-1">
                  {isStreaming && inputText.trim() ? (
                    <button
                      onClick={handleFollowUp}
                      className="p-2.5 rounded-lg transition-colors flex items-center justify-center bg-blue-600 text-white hover:bg-blue-700 shadow-sm shadow-blue-500/20"
                      title={t("sendFollowUp")}
                      aria-label={t("sendFollowUp")}
                    >
                      <Clock className="w-4 h-4" />
                    </button>
                  ) : isStreaming ? (
                    <button
                      onClick={handleAbort}
                      disabled={!isStreaming}
                      className="p-2.5 rounded-lg transition-colors flex items-center justify-center bg-red-600 text-white hover:bg-red-700"
                      title={t("stop")}
                      aria-label={t("stop")}
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  ) : (
                    <button
                      disabled
                      className="p-2.5 rounded-lg transition-colors flex items-center justify-center bg-red-900/30 text-red-500/50 cursor-not-allowed"
                      title={t("stop")}
                      aria-label={t("stop")}
                    >
                      <Square className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    onClick={() => inputBarRef.current?.send()}
                    disabled={
                      (!inputText.trim() &&
                        useAttachmentStore.getState().attachments.length === 0) ||
                      !sessionReady ||
                      hasNoModel
                    }
                    className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${(inputText.trim() || useAttachmentStore.getState().attachments.length > 0) && sessionReady && !hasNoModel ? (isStreaming ? "bg-amber-600 text-white hover:bg-amber-700 shadow-sm shadow-amber-500/20" : "bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm shadow-indigo-500/20") : "bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-600 cursor-not-allowed"}`}
                    title={
                      hasNoModel ? t("sendDisabledNoModel") : isStreaming ? t("steer") : t("send")
                    }
                    aria-label={
                      hasNoModel ? t("sendDisabledNoModel") : isStreaming ? t("steer") : t("send")
                    }
                  >
                    {isStreaming ? <Zap className="w-4 h-4" /> : <ArrowUp className="w-4 h-4" />}
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {isViewingSubagent && (
          <div className="flex-1 flex items-center justify-center gap-3 py-2">
            <span className="text-[11px] text-gray-400 dark:text-gray-600">
              {t("subagentReadonly")}
            </span>
            <button
              onClick={handleSubagentFork}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium
                bg-indigo-500/15 text-semantic-accent hover:bg-indigo-500/25 hover:text-semantic-accent
                border border-indigo-500/20 transition-colors"
              title={t("fork")}
            >
              <GitBranch className="w-3 h-3" />
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
        className="p-1 rounded transition-colors text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300"
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
      className={`p-1 rounded transition-colors ${isVisible ? "text-semantic-accent hover:text-semantic-accent" : "text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300"}`}
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
  const isMobile = useLayoutStore((s) => s.breakpoint) === "mobile";

  if (statusPanel === "pinned" && !isMobile) return null;

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
      className={`p-1 rounded transition-colors ${isVisible ? "text-semantic-accent hover:text-semantic-accent" : "text-gray-400 dark:text-gray-600 hover:text-gray-700 dark:hover:text-gray-300"}`}
      title={isVisible ? t("closeStatusPanel") : t("openStatusPanel")}
    >
      <PanelRight className="w-3.5 h-3.5" />
    </button>
  );
}
