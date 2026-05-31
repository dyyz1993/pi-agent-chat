import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/use-chat-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { NotificationCenter } from "./NotificationCenter";
import { UIPendingCenter } from "./UIPendingCenter";
import { useChangeReviewStore } from "../../stores/use-change-review-store";
import { RetryNotification } from "./RetryNotification";
import { InlineErrorToast } from "./InlineErrorToast";
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
import { MermaidFullscreen } from "./mermaid";
import { RollbackOverlay } from "./RollbackOverlay";
import { ForkDialog } from "./ForkDialog";
import { AttachmentButtons, AttachmentBar } from "./FileAttachment";
import { useAttachmentStore } from "../../stores/use-attachment-store";
import { useForkDialogStore } from "../../stores/use-fork-dialog-store";
import type { ChatMessage } from "../../types";
import { createLogger } from "../../../shared/lib/logger";
import { useAgentStore } from "../../stores/use-agent-store";
import { agentColorStyle } from "../../utils/agent-color";

const log = createLogger("chat");

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
  const setActive = useChatNavStore((s) => s.setActive);
  const messagesScrollRef = useRef<HTMLDivElement>(null);
  const vlistRef = useRef<VirtualizerHandle>(null);
  const inputBarRef = useRef<InputBarHandle>(null);
  const sideNavRef = useRef<{
    getFirstIconId: () => string | null;
    getLastIconId: () => string | null;
  }>(null);
  const messageIds = useMemo(() => messages.map((m) => m.id), [messages]);
  const isStreaming =
    effectiveStatus === "streaming" ||
    effectiveStatus === "compacting" ||
    effectiveStatus === "retrying";
  const isPermissionPending = effectiveStatus === "permission";
  const hasNoModel = effectiveStatus === "idle" && !currentModel;
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const isMobileOrTablet = breakpoint === "mobile" || breakpoint === "tablet";
  const commandPopup = useCommandPopup();

  const streamVersion = useChatStore((s) => s.streamContentVersion);
  const historyLoadVersion = useChatStore((s) => s.historyLoadVersion);

  const agentDetailBySession = useAgentStore((s) => s.agentDetailBySession);
  const agentBorderColor = activeSessionId
    ? agentColorStyle(agentDetailBySession[activeSessionId]?.color)
    : null;

  const pushNotif = useNotificationStore((s) => s.push);
  const [isAborting, setIsAborting] = useState(false);
  const abortFallbackRef = useRef<ReturnType<typeof setTimeout>>();

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
      await apiClient.call("agent.abort", { sessionId: activeSessionId });
      pushNotif({ message: "Agent stopped", level: "info" });
      abortFallbackRef.current = setTimeout(() => {
        abortFallbackRef.current = undefined;
        const sessionId = activeSessionId as string;
        const status = useSessionStore.getState().sessionStatusMap[sessionId];
        if (status === "streaming" || status === "retrying") {
          useSessionStore.getState().updateSessionStatus(sessionId, "idle");
          pushNotif({ message: "Session recovered after abort timeout", level: "warning" });
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
          let navKey = id;
          const msgEl = messagesScrollRef.current?.querySelector(`[data-msg-card-id="${id}"]`);
          if (msgEl) {
            const containerRect = messagesScrollRef.current!.getBoundingClientRect();
            const blocks = msgEl.querySelectorAll("[data-block-id]");
            for (const block of blocks) {
              const rect = block.getBoundingClientRect();
              if (rect.top >= containerRect.top - 20 && rect.top <= containerRect.bottom) {
                navKey = block.getAttribute("data-block-id") ?? id;
                break;
              }
            }
          }
          setNavId(navKey);
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
      const iconId =
        edge === "top" ? sideNavRef.current?.getFirstIconId() : sideNavRef.current?.getLastIconId();
      if (iconId) setNavId(iconId);
      suspendAutoScroll();
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
      let blockNavId: string | undefined;

      if (index === -1) {
        const dashIdx = navId.lastIndexOf("-");
        if (dashIdx >= 0) {
          const msgId = navId.slice(0, dashIdx);
          index = messageIds.indexOf(msgId);
          if (index !== -1) blockNavId = navId;
        }
      }

      if (index !== -1) {
        lastSetNavIdRef.current = messageIds[index];
        vlistRef.current?.scrollToIndex(index, { smooth: true });

        if (blockNavId) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              const blockEl = messagesScrollRef.current?.querySelector(
                `[data-block-id="${blockNavId}"]`,
              );
              if (blockEl) blockEl.scrollIntoView({ block: "start", behavior: "instant" });
            });
          });
        }
      }
    },
    [messageIds, suspendAutoScroll, setNavId],
  );

  const handleSend = async () => {
    if (!sessionReady) {
      pushNotif({ message: "Session not ready, please wait", level: "warning" });
      return;
    }
    if (!inputText.trim() && useAttachmentStore.getState().attachments.length === 0) return;

    const attachmentStore = useAttachmentStore.getState();
    const hasAttachments = attachmentStore.attachments.length > 0;

    if (hasAttachments) {
      const attachments = attachmentStore.attachments;
      const imageAttachments = attachments.filter((a) => a.type.startsWith("image/"));
      const fileAttachments = attachments.filter((a) => !a.type.startsWith("image/"));

      const images: import("@dyyz1993/pi-ai").ImageContent[] = [];
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

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
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
    <div
      className="flex-1 flex flex-col overflow-hidden relative bg-bg-elevated"
      style={agentBorderColor ? { borderLeft: `2px solid ${agentBorderColor.border}` } : undefined}
    >
      <MermaidFullscreen />
      <RollbackOverlay />
      <ForkDialog />
      <div className="flex items-center gap-4 px-4 py-1.5 bg-bg-secondary/90 border-b border-border-primary text-[11px] text-text-tertiary flex-shrink-0">
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
          <ChangeReviewBell />
          <StatusToggleIcon />
        </div>
      </div>

      <RetryNotification />
      <InlineErrorToast />

      <div className="flex-1 flex overflow-hidden">
        <div className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-w-0 relative overflow-hidden">
            {projectFailed && !isViewingSubagent && !isLoading ? (
              <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-3 max-w-xs text-center">
                  <AlertTriangle className="w-8 h-8 text-status-warning" />
                  <div className="text-sm text-text-secondary">{t("sessionStartFailed")}</div>
                  {projectError && (
                    <div className="text-xs text-text-tertiary break-all">{projectError}</div>
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
            ) : isLoading ? (
              <div className="h-full flex items-center justify-center">
                <div className="flex flex-col items-center gap-2 opacity-50">
                  <Loader2 className="w-5 h-5 text-text-tertiary animate-spin" />
                  <span className="text-xs text-text-tertiary">{t("loadingSession")}</span>
                </div>
              </div>
            ) : isViewingSubagent ? (
              <MessageListView
                source="sub"
                scrollRef={messagesScrollRef}
                vlistRef={vlistRef}
                onScroll={handleScroll}
                onScrollEnd={wrappedHandleScrollEnd}
                activeSessionId={activeSubId ?? undefined}
              />
            ) : (
              <MessageListView
                source="main"
                scrollRef={messagesScrollRef}
                vlistRef={vlistRef}
                onScroll={handleScroll}
                onScrollEnd={wrappedHandleScrollEnd}
                isLoadingMore={isLoadingMore}
                hasMoreMessages={hasMoreMessages}
                activeSessionId={activeSessionId ?? undefined}
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
          {activeSessionId && !isViewingSubagent && <QueueCards sessionId={activeSessionId} />}
        </div>
        <div className="w-12 shrink-0 overflow-hidden">
          <SideNav ref={sideNavRef} messages={messages} onNavDotClick={handleNavDotClick} />
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

      <div
        className={`px-3 pt-2 pb-1.5 flex-shrink-0 bg-bg-secondary border-t border-border-primary relative ${isDragOver ? "ring-2 ring-semantic-accent/50 bg-semantic-accent/5" : ""}`}
        style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
        onPaste={handlePaste}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {!isViewingSubagent && (
          <>
            {!sessionReady && !projectFailed ? (
              <div className="flex-1 flex items-center justify-center gap-2 py-2">
                <Loader2 className="w-3.5 h-3.5 text-text-tertiary animate-spin" />
                <span className="text-xs text-text-tertiary">{t("sessionStarting")}</span>
              </div>
            ) : (
              <>
                <AttachmentBar />
                <div className="flex items-stretch gap-1.5">
                  {!isMobileOrTablet && <AttachmentButtons />}

                  <InputBar
                    ref={inputBarRef}
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
                    onClick={() => inputBarRef.current?.send()}
                    disabled={
                      isAborting ||
                      isPermissionPending ||
                      (!inputText.trim() &&
                        useAttachmentStore.getState().attachments.length === 0) ||
                      !sessionReady ||
                      hasNoModel
                    }
                    className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${!isAborting && (inputText.trim() || useAttachmentStore.getState().attachments.length > 0) && sessionReady && !hasNoModel ? (isStreaming ? "bg-status-warning text-white hover:bg-status-warning shadow-sm shadow-status-warning/20" : "bg-semantic-accent text-white hover:bg-semantic-accent shadow-sm shadow-semantic-accent/20") : "bg-surface-dim text-text-tertiary cursor-not-allowed"}`}
                    title={
                      isPermissionPending
                        ? t("waitPermission")
                        : hasNoModel
                          ? t("sendDisabledNoModel")
                          : isStreaming
                            ? t("steer")
                            : t("send")
                    }
                    aria-label={
                      isPermissionPending
                        ? t("waitPermission")
                        : hasNoModel
                          ? t("sendDisabledNoModel")
                          : isStreaming
                            ? t("steer")
                            : t("send")
                    }
                  >
                    {isStreaming ? <Zap className="w-4 h-4" /> : <ArrowUp className="w-4 h-4" />}
                  </button>
                </div>
                </div>
              </>
            )}
          </>
        )}
        {isViewingSubagent && (
          <div className="flex-1 flex items-center justify-center gap-3 py-2">
            <span className="text-[11px] text-text-tertiary">{t("subagentReadonly")}</span>
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
        layout.setActivePanelTab("changeReview");
        if (layout.statusPanel === "hidden") {
          layout.showStatus();
        }
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
