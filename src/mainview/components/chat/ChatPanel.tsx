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
  Eye,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Message } from "@dyyz1993/pi-ai";
import { createLogger } from "../../../shared/lib/logger";
import { normalizeToolBlocks, useChatStore } from "../../stores/use-chat-store";
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
import { useStatusStore } from "../../stores/use-status-store";
import { apiClient } from "../../lib/api-client";
import { messageToChatMessage } from "../../lib/message-mapper";
import { useActiveScrollTracker } from "../../hooks/use-active-scroll-tracker";
import { useAsyncGuard } from "../../hooks/use-async-guard";
import type { VirtualizerHandle } from "virtua";
import { SideNav, getCachedFlatItems, type SideNavPagination, type SideNavTarget } from "./SideNav";
import { InputBar, type InputBarHandle } from "./InputBar";
import { TokenStatusBar } from "./TokenStatusBar";
import { getProcessedMessagesForSession, MessageListView } from "./MessageListView";
import { MessageSelectionBar } from "./MessageSelectionBar";
import { QuickActionToolbar } from "./QuickActionToolbar";
import { CommandPopup } from "./CommandPopup";
import { useCommandPopup } from "../../hooks/use-command-popup";
import { ScrollToolbar } from "./ScrollToolbar";
import { QueueCards } from "./QueueCards";
import { GoalVendorActionCard } from "./GoalVendorActionCard";
import { CachedReactMarkdown } from "./CachedReactMarkdown";
import {
  useReturnToSourceSession,
  type ReturnSourceTarget,
} from "./primitives/useReturnToSourceSession";
import { MermaidFullscreen } from "./mermaid";
import { RollbackOverlay } from "./RollbackOverlay";
import { ForkDialog } from "./ForkDialog";
import { AttachmentButtons, AttachmentBar } from "./FileAttachment";
import { TextSelectionToolbar } from "./TextSelectionToolbar";
import { ComposerPlaceholderBar } from "./ComposerPlaceholderBar";
import { useAttachmentStore } from "../../stores/use-attachment-store";
import {
  useComposerPlaceholderStore,
} from "../../stores/use-composer-placeholder-store";
import { useForkDialogStore } from "../../stores/use-fork-dialog-store";
import type { ChatMessage } from "../../types";
import type { AgentMessageForUI } from "../../../shared/modules/agent";
import { useAgentStore } from "../../stores/use-agent-store";
import { agentColorStyle } from "../../utils/agent-color";
import { useGoalMode } from "./use-goal-mode";
import { useGoalStore } from "../../stores/use-goal-store";
import { CardPrimitive } from "../primitives/CardPrimitive";
import { useMessageActions } from "./use-message-actions";
import { useAttachmentDrop } from "./use-attachment-drop";
import { useSendMessage } from "./use-send-message";
import { ChatReloadButton, shouldShowChatReloadButton } from "./SessionReloadButton";
import { FileOverlay } from "../file-preview/FileOverlay";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { useChatOverlayStore } from "../../stores/use-chat-overlay-store";
import {
  getProjectDisplayName,
  getSessionIdentity,
  type SessionIdentity,
} from "../../lib/session-identity";
import type { SessionMeta } from "../../types";

const log = createLogger("chat");
const BLOCK_NAV_MAX_RENDER_ATTEMPTS = 60;
const SIDE_NAV_CLICK_SCROLL_LOCK_FALLBACK_MS = 5000;
const INITIAL_SCROLL_REVEAL_GRACE_MS = 450;
const SIDE_NAV_PAGE_SIZE = 200;
const SIDE_NAV_WINDOW_SIZE = 200;
const TOP_LOAD_RESTORE_MAX_ATTEMPTS = 6;

const MAX_MSG_IDS_CACHE = 10;

const _messageIdsCache = new Map<string, { ref: ChatMessage[]; result: string[] }>();

export { ChatReloadButton, shouldShowChatReloadButton };

interface TopLoadScrollAnchor {
  sessionId: string;
  scrollHeight: number;
  scrollTop: number;
  messageId?: string;
  messageTop?: number;
  messageIndex?: number;
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
    return "border-accent/30 bg-accent/10 text-accent";
  }
  return "border-status-warning/30 bg-status-warning/10 text-status-warning";
}

export function shouldStartTopLoad({
  activeSessionId,
  isAtTop,
  hasMoreMessages,
  isLoadingMore,
  isViewingSubagent,
  initialScrollComplete,
  lockedSessionId,
}: {
  activeSessionId: string | null | undefined;
  isAtTop: boolean;
  hasMoreMessages: boolean;
  isLoadingMore: boolean;
  isViewingSubagent: boolean;
  initialScrollComplete: boolean;
  lockedSessionId: string | null;
}): boolean {
  return (
    !!activeSessionId &&
    isAtTop &&
    hasMoreMessages &&
    !isLoadingMore &&
    !isViewingSubagent &&
    initialScrollComplete &&
    lockedSessionId !== activeSessionId
  );
}

export function shouldHideMessageSurfaceUntilInitialBottom({
  effectiveSessionId,
  messageCount,
  initialScrollCompleteSessionId,
  revealFallbackSessionId,
}: {
  effectiveSessionId: string | null | undefined;
  messageCount: number;
  initialScrollCompleteSessionId: string | null;
  revealFallbackSessionId?: string | null;
}): boolean {
  return (
    !!effectiveSessionId &&
    messageCount > 0 &&
    initialScrollCompleteSessionId !== effectiveSessionId &&
    revealFallbackSessionId !== effectiveSessionId
  );
}

export function shouldBlockComposerForRemoteDisconnect({
  projectConnected,
  projectRuntime,
  hasRemoteProjectRef,
  remoteRuntimeEnabled,
  remoteConnectionStatus,
}: {
  projectConnected?: boolean;
  projectRuntime?: string;
  hasRemoteProjectRef?: boolean;
  remoteRuntimeEnabled?: boolean;
  remoteConnectionStatus?: string;
}): boolean {
  const isRemoteProject =
    projectRuntime === "ssh" || hasRemoteProjectRef === true || remoteRuntimeEnabled === true;
  if (!isRemoteProject) return false;
  return (
    projectConnected === false ||
    remoteConnectionStatus === "disconnected" ||
    remoteConnectionStatus === "error"
  );
}

export function computeTopLoadRestoredScrollTop(
  anchor: TopLoadScrollAnchor,
  nextScrollHeight: number,
): number {
  const addedHeight = Math.max(0, nextScrollHeight - anchor.scrollHeight);
  return anchor.scrollTop + addedHeight;
}

export function computeTopLoadRestoredVirtualOffset(
  anchor: Pick<TopLoadScrollAnchor, "messageTop">,
  nextItemOffset: number,
): number {
  return Math.max(0, nextItemOffset - (anchor.messageTop ?? 0));
}

export function hasTopLoadAnchorContentShifted(
  anchor: TopLoadScrollAnchor,
  messageIds: string[],
  nextScrollHeight: number,
): boolean {
  if (anchor.messageId && anchor.messageIndex != null) {
    const nextIndex = messageIds.indexOf(anchor.messageId);
    if (nextIndex >= 0) return nextIndex > anchor.messageIndex;
  }
  return nextScrollHeight > anchor.scrollHeight;
}

function getTopVisibleMessageAnchor(
  container: HTMLElement,
  messageIds: string[],
  handle: VirtualizerHandle | null,
): Pick<TopLoadScrollAnchor, "messageId" | "messageTop" | "messageIndex"> {
  const containerRect = container.getBoundingClientRect();
  const visibleMessages = Array.from(container.querySelectorAll<HTMLElement>("[data-msg-id]"))
    .map((element) => {
      const messageId = element.dataset.msgId;
      if (!messageId) return null;
      const rect = element.getBoundingClientRect();
      if (rect.bottom < containerRect.top || rect.top > containerRect.bottom) return null;
      return {
        messageId,
        messageTop: rect.top - containerRect.top,
        distance: Math.abs(rect.top - containerRect.top),
      };
    })
    .filter((item): item is { messageId: string; messageTop: number; distance: number } => !!item)
    .sort((a, b) => a.distance - b.distance);

  const messageId = visibleMessages[0]?.messageId ?? messageIds[0];
  if (!messageId) return {};
  const messageIndex = messageIds.indexOf(messageId);
  let messageTop = visibleMessages[0]?.messageTop;
  if (messageTop == null && messageIndex >= 0 && handle) {
    try {
      messageTop = handle.getItemOffset(messageIndex) - handle.scrollOffset;
    } catch {
      messageTop = 0;
    }
  }
  return {
    messageId,
    messageTop: messageTop ?? 0,
    messageIndex: messageIndex >= 0 ? messageIndex : undefined,
  };
}

function correctTopLoadDomAnchor(container: HTMLElement, anchor: TopLoadScrollAnchor): boolean {
  if (!anchor.messageId || anchor.messageTop == null) return false;
  const element =
    Array.from(container.querySelectorAll<HTMLElement>("[data-msg-id]")).find(
      (candidate) => candidate.dataset.msgId === anchor.messageId,
    ) ?? null;
  if (!element) return false;
  const containerRect = container.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  const delta = rect.top - containerRect.top - anchor.messageTop;
  if (Math.abs(delta) > 0.5) {
    container.scrollTop += delta;
  }
  return true;
}

function evictMsgIdsIfNeeded(): void {
  if (_messageIdsCache.size > MAX_MSG_IDS_CACHE) {
    const firstKey = _messageIdsCache.keys().next().value;
    if (firstKey !== undefined) _messageIdsCache.delete(firstKey);
  }
}

function mapNavMessages(rawMessages: AgentMessageForUI[]): ChatMessage[] {
  const toolCallNameMap: Record<string, string> = {};
  for (const raw of rawMessages) {
    if (raw.role !== "assistant" || !Array.isArray(raw.content)) continue;
    for (const block of raw.content) {
      if (block.type === "toolCall" && block.id && block.name) {
        toolCallNameMap[block.id] = block.name;
      }
    }
  }
  const messages = rawMessages
    .map((raw) => messageToChatMessage(raw as unknown as Message, raw.id, toolCallNameMap))
    .filter((message): message is ChatMessage => !!message);
  normalizeToolBlocks(messages, true, false);
  return messages;
}

function mergeSideNavMessages(
  olderMessages: ChatMessage[],
  newerMessages: ChatMessage[],
): ChatMessage[] {
  const seen = new Set<string>();
  const merged: ChatMessage[] = [];
  for (const message of [...olderMessages, ...newerMessages]) {
    if (seen.has(message.id)) continue;
    seen.add(message.id);
    merged.push(message);
  }
  return merged;
}

export function shouldUseIndependentSideNavHistory(breakpoint: string | null | undefined): boolean {
  return breakpoint !== "mobile" && breakpoint !== "tablet";
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
      <Loader2 className="w-4 h-4 text-accent animate-spin shrink-0" />
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
                    ? "text-accent font-medium"
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

export function GoalDraftCard({
  draft,
  editing,
  disabled,
  onChange,
  onGenerate,
  onEdit,
  onSave,
  onCancel,
  onClose,
  onAdd,
}: {
  draft: string;
  editing: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  onGenerate: () => void;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onClose: () => void;
  onAdd: () => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <CardPrimitive
      tone="accent"
      data-testid="goal-draft-card"
      className="mx-2 mt-2 overflow-hidden max-sm:mx-0 max-sm:rounded-none"
    >
      <div className="flex items-center gap-2 border-b border-accent/15 px-3 py-2 max-sm:px-2">
        <button
          type="button"
          data-testid="goal-draft-close"
          onClick={onClose}
          disabled={disabled}
          className="shrink-0 rounded-md p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          title={t("goal.cancelCompose")}
          aria-label={t("goal.cancelCompose")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Target className="h-3.5 w-3.5 shrink-0 text-accent" />
          <div className="min-w-0">
            <div className="text-xs font-medium text-text-primary">{t("goal.draft.title")}</div>
            <div className="text-[11px] text-text-tertiary">{t("goal.draft.subtitle")}</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {editing ? (
            <>
              <button
                type="button"
                data-testid="goal-draft-cancel-edit"
                onClick={onCancel}
                disabled={disabled}
                className="inline-flex items-center gap-1 rounded-md border border-border-primary bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-3 w-3" />
                {t("goal.draft.cancelEdit")}
              </button>
              <button
                type="button"
                data-testid="goal-draft-save-preview"
                onClick={onSave}
                disabled={(disabled ?? false) || !draft.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Eye className="h-3 w-3" />
                {t("goal.draft.save")}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                data-testid="goal-draft-regenerate"
                onClick={onGenerate}
                disabled={disabled}
                className="inline-flex items-center gap-1 rounded-md border border-border-primary bg-transparent px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent hover:border-accent disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RefreshCw className="h-3 w-3" />
                <span className="max-sm:hidden">{t("goal.draft.regenerate")}</span>
                <span className="sm:hidden">{t("goal.draft.generateShort")}</span>
              </button>
              <button
                type="button"
                data-testid="goal-draft-add"
                onClick={onAdd}
                disabled={(disabled ?? false) || !draft.trim()}
                className="inline-flex items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-[11px] font-bold text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Check className="h-3 w-3" />
                {t("goal.draft.confirm")}
              </button>
            </>
          )}
        </div>
      </div>
      <div
        className={`max-h-[34vh] overflow-y-auto px-3 py-2 max-sm:max-h-[28vh] max-sm:px-2${
          editing ? "" : " cursor-pointer"
        }`}
        onClick={editing ? undefined : onEdit}
      >
        {editing ? (
          <textarea
            value={draft}
            data-testid="goal-draft-editor"
            onChange={(event) => onChange(event.target.value)}
            className="min-h-48 w-full resize-y rounded-md border border-border-primary bg-bg-elevated px-3 py-2 font-mono text-xs leading-5 text-text-primary outline-none transition-colors focus:border-border-focus max-sm:min-h-64 max-sm:px-2"
            aria-label={t("goal.draft.editorLabel")}
          />
        ) : (
          <>
            <div className="prose prose-sm max-w-none text-xs text-text-secondary dark:prose-invert prose-headings:my-2 prose-p:my-1.5 prose-ul:my-1.5 prose-li:my-0.5">
              <CachedReactMarkdown>{draft}</CachedReactMarkdown>
            </div>
            <div className="mt-1 border-t border-dashed border-border-primary/50 pt-1 text-[10px] text-text-tertiary">
              ✏️ {t("goal.draft.clickToEdit")}
            </div>
          </>
        )}
      </div>
    </CardPrimitive>
  );
}

export function ChatPanel() {
  const { t } = useTranslation("chat");
  const overlay = useChatOverlayStore((s) => s.overlay);
  const closeOverlay = useChatOverlayStore((s) => s.close);
  const filePreview = useExplorerStore((s) => s.filePreview);
  const loadingFile = useExplorerStore((s) => s.loadingFile);
  const saveFileContent = useExplorerStore((s) => s.saveFileContent);
  const setFileEditable = useExplorerStore((s) => s.setFileEditable);
  const handleSaveFile = useCallback(
    async (content: string) => {
      if (filePreview?.path) {
        await saveFileContent(filePreview.path, content);
      }
    },
    [saveFileContent, filePreview?.path],
  );
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
  const isViewingSubagent = !!activeSubId;
  const effectiveScrollSessionId = isViewingSubagent ? activeSubId : activeSessionId;
  const messageViewMode = useChatStore(
    useCallback(
      (s) =>
        effectiveScrollSessionId
          ? (s.messageViewBySession[effectiveScrollSessionId] ?? "tail")
          : "tail",
      [effectiveScrollSessionId],
    ),
  );
  const subMessages = useChatStore((s) => {
    if (activeSubId && (s.messageViewBySession[activeSubId] ?? "tail") === "focus") {
      return s.focusMessagesBySession[activeSubId] ?? EMPTY_MSGS;
    }
    return getDisplayedMessagesForChatPanel({
      activeSessionId: null,
      activeSubsessionId: activeSubId,
      messagesBySession: s.messagesBySession,
    });
  });
  const mainMessages = useChatStore((s) => {
    if (activeSessionId && (s.messageViewBySession[activeSessionId] ?? "tail") === "focus") {
      return s.focusMessagesBySession[activeSessionId] ?? EMPTY_MSGS;
    }
    return getDisplayedMessagesForChatPanel({
      activeSessionId,
      activeSubsessionId: null,
      messagesBySession: s.messagesBySession,
    });
  });
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
  const activeProjectTab = useSessionStore(
    useCallback((s) => s.projectTabs.find((tab) => tab.id === s.activeProjectId) ?? null, []),
  );
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
  const activeSideNavSessionPath = isViewingSubagent
    ? (activeSubSessionMeta?.sessionPath ?? null)
    : activeSessionPath;
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
  const effectiveRemoteRuntime = useStatusStore(
    useCallback(
      (s) =>
        effectiveScrollSessionId
          ? (s.remoteRuntimeBySession[effectiveScrollSessionId] ?? null)
          : null,
      [effectiveScrollSessionId],
    ),
  );
  const remoteConnectionStatus = effectiveRemoteRuntime?.status;
  const activeRemoteDisconnected = shouldBlockComposerForRemoteDisconnect({
    projectConnected: activeProjectTab?.connected,
    projectRuntime: activeProjectTab?.runtime,
    hasRemoteProjectRef: Boolean(activeProjectTab?.remote),
    remoteRuntimeEnabled: effectiveRemoteRuntime?.enabled,
    remoteConnectionStatus,
  });
  const remoteDisconnectedMessage = activeRemoteDisconnected
    ? (effectiveRemoteRuntime?.error ?? t("remoteDisconnectedComposer"))
    : "";
  const sessionReady = useSessionStore(
    useCallback((s) => !!activeSessionId && s.sessionReady[activeSessionId], [activeSessionId]),
  );
  const agentReady = useSessionStore(
    useCallback((s) => !!activeSessionId && !!s.agentReady[activeSessionId], [activeSessionId]),
  );

  const hasMoreMessages = useChatStore(
    useCallback(
      (s) => !!effectiveScrollSessionId && !!s.hasMoreMessagesBySession?.[effectiveScrollSessionId],
      [effectiveScrollSessionId],
    ),
  );
  const isLoadingMore = useChatStore(
    useCallback(
      (s) => !!effectiveScrollSessionId && !!s.isLoadingMoreBySession?.[effectiveScrollSessionId],
      [effectiveScrollSessionId],
    ),
  );
  const hasTrimmedTailMessages = useChatStore(
    useCallback(
      (s) =>
        !!effectiveScrollSessionId &&
        !!s.hasTrimmedTailMessagesBySession?.[effectiveScrollSessionId],
      [effectiveScrollSessionId],
    ),
  );
  const messageNextCursor = useChatStore(
    useCallback(
      (s) =>
        effectiveScrollSessionId
          ? (s.nextCursorBySession?.[effectiveScrollSessionId] ?? null)
          : null,
      [effectiveScrollSessionId],
    ),
  );
  const loadMoreMessages = useChatStore((s) => s.loadMoreMessages);
  const loadTopMessages = useChatStore((s) => s.loadTopMessages);
  const clearTopWindowMessages = useChatStore((s) => s.clearTopWindowMessages);
  const loadSessionMessages = useChatStore((s) => s.loadSessionMessages);
  const loadFocusedMessagesAround = useChatStore((s) => s.loadFocusedMessagesAround);
  const clearFocusedMessages = useChatStore((s) => s.clearFocusedMessages);
  const deleteMessagesForSession = useChatStore((s) => s.deleteMessagesForSession);
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
  const topSeekSessionRef = useRef<string | null>(null);
  const topSeekRunIdRef = useRef(0);
  const [isSeekingTop, setIsSeekingTop] = useState(false);
  const [initialScrollCompleteSessionId, setInitialScrollCompleteSessionId] = useState<
    string | null
  >(null);
  const [initialScrollRevealFallbackSessionId, setInitialScrollRevealFallbackSessionId] = useState<
    string | null
  >(null);
  const [sideNavExtraMessages, setSideNavExtraMessages] = useState<ChatMessage[]>([]);
  const [sideNavCursor, setSideNavCursor] = useState<string | null>(null);
  const [sideNavHasMore, setSideNavHasMore] = useState(false);
  const [sideNavNewestExtraCursor, setSideNavNewestExtraCursor] = useState<string | null>(null);
  const [sideNavHasMoreNewer, setSideNavHasMoreNewer] = useState(false);
  const [isSideNavLoadingMore, setIsSideNavLoadingMore] = useState(false);
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
  const useIndependentSideNavHistory = shouldUseIndependentSideNavHistory(breakpoint);
  const returnSourceTarget = useReturnToSourceSession();
  const shouldRenderSideNav = messages.length > 0;
  const renderedMessages = useMemo(
    () =>
      getProcessedMessagesForSession({
        activeSessionId: isViewingSubagent
          ? (activeSubId ?? undefined)
          : (activeSessionId ?? undefined),
        visibleMessages: messages,
        showMemoryEntries,
        sessionStatus: effectiveStatus,
      })
        .filter((item) => !item.hide)
        .map((item) => item.msg),
    [activeSessionId, activeSubId, effectiveStatus, isViewingSubagent, messages, showMemoryEntries],
  );
  const messageIds = useMemo(() => {
    if (!effectiveScrollSessionId) return renderedMessages.map((m) => m.id);
    const cacheKey = `${effectiveScrollSessionId}:${messageViewMode}`;
    const cached = _messageIdsCache.get(cacheKey);
    if (cached && cached.ref === renderedMessages) return cached.result;
    const result = renderedMessages.map((m) => m.id);
    _messageIdsCache.set(cacheKey, { ref: renderedMessages, result });
    evictMsgIdsIfNeeded();
    return result;
  }, [renderedMessages, effectiveScrollSessionId, messageViewMode]);
  const sideNavMessages = useMemo(() => {
    if (!useIndependentSideNavHistory || sideNavExtraMessages.length === 0) return renderedMessages;
    return mergeSideNavMessages(sideNavExtraMessages, renderedMessages);
  }, [renderedMessages, sideNavExtraMessages, useIndependentSideNavHistory]);
  const collapsedMessageIdsForNav = useTurnStore(
    useCallback(
      (s) =>
        shouldRenderSideNav && effectiveScrollSessionId
          ? (s.collapsedMessageIdsBySession[effectiveScrollSessionId] ?? EMPTY_SET)
          : EMPTY_SET,
      [effectiveScrollSessionId, shouldRenderSideNav],
    ),
  );
  const sideNavRenderedTargets = useMemo(() => {
    if (!shouldRenderSideNav) return undefined;
    return getCachedFlatItems({
      sessionId: effectiveScrollSessionId ?? undefined,
      messages: renderedMessages,
      showThinking,
      showMemoryEntries,
      collapsedMessageIds: collapsedMessageIdsForNav,
      showToolCalls,
      showToolResults,
    }).map((item) => ({
      key: item.key,
      messageId: item.navId,
      blockId: item.blockId,
    }));
  }, [
    renderedMessages,
    effectiveScrollSessionId,
    shouldRenderSideNav,
    showThinking,
    showMemoryEntries,
    collapsedMessageIdsForNav,
    showToolCalls,
    showToolResults,
  ]);
  const isStreaming =
    effectiveStatus === "streaming" ||
    effectiveStatus === "compacting" ||
    effectiveStatus === "retrying";
  const isPermissionPending = effectiveStatus === "permission";
  const hasNoModel = effectiveStatus === "idle" && !currentModel;
  const commandPopup = useCommandPopup();

  const streamVersion = useChatStore(
    useCallback(
      (s) =>
        effectiveScrollSessionId ? (s.streamVersionBySession[effectiveScrollSessionId] ?? 0) : 0,
      [effectiveScrollSessionId],
    ),
  );
  const historyLoadVersion = useChatStore(
    useCallback(
      (s) =>
        effectiveScrollSessionId
          ? (s.historyLoadVersionBySession?.[effectiveScrollSessionId] ?? 0)
          : 0,
      [effectiveScrollSessionId],
    ),
  );
  const messageHydration = useChatStore(
    useCallback(
      (s) =>
        effectiveScrollSessionId
          ? (s.messageHydrationBySession?.[effectiveScrollSessionId] ?? "idle")
          : "idle",
      [effectiveScrollSessionId],
    ),
  );
  const initialScrollReady =
    !effectiveScrollSessionId || messageHydration === "ready" || messageHydration === "error";
  const hideMessageSurfaceUntilInitialBottom = shouldHideMessageSurfaceUntilInitialBottom({
    effectiveSessionId: effectiveScrollSessionId,
    messageCount: messageIds.length,
    initialScrollCompleteSessionId,
    revealFallbackSessionId: initialScrollRevealFallbackSessionId,
  });

  const agentColor = useAgentStore(
    useCallback(
      (s) => (activeSessionId ? s.agentDetailBySession[activeSessionId]?.color : undefined),
      [activeSessionId],
    ),
  );
  const agentBorderColor = agentColor ? agentColorStyle(agentColor) : null;

  const pushNotif = useNotificationStore((s) => s.push);
  const clearMessageSelection = useTurnStore((s) => s.clearSelection);
  const [isAborting, setIsAborting] = useState(false);
  const abortFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const {
    goalMode,
    isCreatingGoal,
    isRefiningGoal,
    refineStep,
    goalDraft,
    isGoalDraftEditing,
    setGoalDraft,
    startGoalMode,
    exitGoalMode,
    generateGoalDraft,
    handleEditGoalDraft,
    handleCancelGoalDraftEdit,
    handleSaveGoalDraftEdit,
    handleCreateGoal: handleCreateGoalBase,
    handleRefineGoal,
  } = useGoalMode({
    activeSessionId,
    isViewingSubagent,
    inputText,
    setInputText,
    effectiveStatus,
    projectName: activeProjectTab?.name ?? chatProjectName,
    projectPath: chatProjectPath,
    sessionTitle: chatIdentity?.title ?? "",
    messageCount: messages.length,
    attachmentCount,
    hasComposerPlaceholders,
    isMobileOrTablet,
    sendMessage,
    inputBarRef,
    commandPopup,
  });
  const showComposerUtilityRow = !isMobileOrTablet || goalMode || !!returnSourceTarget;
  const hasSendableContent = goalMode
    ? inputText.trim().length > 0 || goalDraft.trim().length > 0
    : inputText.trim().length > 0 || attachmentCount > 0 || hasComposerPlaceholders;
  const composerInputDisabled = !activeSessionId || isCreatingGoal || activeRemoteDisconnected;
  const sendDisabled =
    !agentReady ||
    isAborting ||
    isCreatingGoal ||
    isPermissionPending ||
    !hasSendableContent ||
    !activeSessionId ||
    hasNoModel ||
    activeRemoteDisconnected;

  useEffect(() => {
    if (!activeSessionPath) return;
    void useSubagentStore.getState().loadSubsessions(activeSessionPath);
  }, [activeSessionPath]);

  useEffect(() => {
    setInitialScrollCompleteSessionId(null);
    topLoadScrollAnchorRef.current = null;
    topSeekRunIdRef.current++;
    topSeekSessionRef.current = null;
    setIsSeekingTop(false);
    if (topLoadRestoreRafRef.current != null) {
      cancelAnimationFrame(topLoadRestoreRafRef.current);
      topLoadRestoreRafRef.current = null;
    }
  }, [effectiveScrollSessionId]);

  useEffect(() => {
    if (!isStreaming && isAborting) {
      setIsAborting(false);
      if (abortFallbackRef.current) {
        clearTimeout(abortFallbackRef.current);
        abortFallbackRef.current = null;
      }
    }
  }, [isStreaming, isAborting]);

  const [handleAbort, isAbortRunning] = useAsyncGuard(
    useCallback(async () => {
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
          abortFallbackRef.current = null;
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
    }, [activeSessionId, activeSubId, isAborting, pushNotif]),
  );

  const {
    handleDeleteSelectedMessages,
    handleSummarizeSelectedMessages,
    handleRememberSelectedMessages,
  } = useMessageActions({
    activeSessionId,
    activeSubId,
    isViewingSubagent,
    messages,
    chatProjectPath,
    deleteMessagesForSession,
    clearMessageSelection,
    loadSessionMessages,
    pushNotif,
  });

  const [handleSubagentFork, isForking] = useAsyncGuard(
    useCallback(async () => {
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
    }, []),
  );

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

  useEffect(() => {
    setSideNavExtraMessages([]);
    setSideNavCursor(messageNextCursor);
    setSideNavHasMore(hasMoreMessages);
    setSideNavNewestExtraCursor(null);
    setSideNavHasMoreNewer(false);
    setIsSideNavLoadingMore(false);
  }, [effectiveScrollSessionId, hasMoreMessages, messageNextCursor]);

  useEffect(() => {
    if (sideNavExtraMessages.length > 0 || isSideNavLoadingMore) return;
    setSideNavCursor(messageNextCursor);
    setSideNavHasMore(hasMoreMessages);
  }, [hasMoreMessages, isSideNavLoadingMore, messageNextCursor, sideNavExtraMessages.length]);

  useEffect(() => {
    if (
      !effectiveScrollSessionId ||
      messageIds.length === 0 ||
      initialScrollCompleteSessionId === effectiveScrollSessionId
    ) {
      setInitialScrollRevealFallbackSessionId(null);
      return;
    }

    setInitialScrollRevealFallbackSessionId((prev) =>
      prev === effectiveScrollSessionId ? prev : null,
    );

    const timeout = window.setTimeout(() => {
      setInitialScrollRevealFallbackSessionId(effectiveScrollSessionId);
    }, INITIAL_SCROLL_REVEAL_GRACE_MS);

    return () => window.clearTimeout(timeout);
  }, [effectiveScrollSessionId, initialScrollCompleteSessionId, messageIds.length]);

  const handleInitialScrollComplete = useCallback(() => {
    setInitialScrollCompleteSessionId(effectiveScrollSessionId ?? null);
  }, [effectiveScrollSessionId]);

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
    activeTargets: sideNavRenderedTargets,
    sessionId: effectiveScrollSessionId ?? undefined,
    setActive: useCallback(
      (id: string | null) => {
        setActive(id);
      },
      [setActive],
    ),
    streamVersion,
    historyLoadVersion,
    initialScrollReady,
    onInitComplete: handleInitialScrollComplete,
  });

  const wrappedHandleScrollEnd = useCallback(() => {
    if (navClickScrollingRef.current) releaseSideNavScrollLock();
    handleScrollEnd();
  }, [handleScrollEnd, releaseSideNavScrollLock]);

  // Resume auto-scroll after the goal is actually created. resumeAutoScroll
  // comes from useActiveScrollTracker (defined later than useGoalMode), so we
  // wrap handleCreateGoalBase here instead of pulling it into the hook deps.
  const handleCreateGoal = useCallback(async () => {
    const created = await handleCreateGoalBase();
    if (created) resumeAutoScroll();
  }, [handleCreateGoalBase, resumeAutoScroll]);

  const handleSend = useSendMessage({
    inputText,
    attachmentCount,
    hasComposerPlaceholders,
    isStreaming,
    isMobileOrTablet,
    sendMessage,
    sendSteer,
    resumeAutoScroll,
    inputBarRef,
  });

  const captureTopLoadScrollAnchor = useCallback(() => {
    if (!activeSessionId) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    const handle = vlistRef.current;
    topLoadScrollAnchorRef.current = {
      sessionId: activeSessionId,
      scrollHeight: el.scrollHeight,
      scrollTop: el.scrollTop,
      ...getTopVisibleMessageAnchor(el, messageIds, handle),
    };
  }, [activeSessionId, messageIds]);

  const correctTopLoadAnchorAfterRender = useCallback(
    (anchor: TopLoadScrollAnchor, attempt = 0) => {
      if (anchor.sessionId !== activeSessionId) return;
      const el = messagesScrollRef.current;
      if (!el) return;

      const corrected = correctTopLoadDomAnchor(el, anchor);
      if (corrected && attempt >= 1) return;
      if (attempt >= TOP_LOAD_RESTORE_MAX_ATTEMPTS) return;

      topLoadRestoreRafRef.current = requestAnimationFrame(() => {
        topLoadRestoreRafRef.current = null;
        correctTopLoadAnchorAfterRender(anchor, attempt + 1);
      });
    },
    [activeSessionId],
  );

  const restoreTopLoadScrollAnchor = useCallback(
    (anchor: TopLoadScrollAnchor) => {
      const el = messagesScrollRef.current;
      if (!el) return;
      if (topLoadRestoreRafRef.current != null) {
        cancelAnimationFrame(topLoadRestoreRafRef.current);
        topLoadRestoreRafRef.current = null;
      }

      const handle = vlistRef.current;
      let restoredByMessageAnchor = false;
      if (anchor.messageId && handle) {
        const nextIndex = messageIds.indexOf(anchor.messageId);
        if (nextIndex >= 0) {
          try {
            const nextItemOffset = handle.getItemOffset(nextIndex);
            handle.scrollTo(computeTopLoadRestoredVirtualOffset(anchor, nextItemOffset));
            restoredByMessageAnchor = true;
          } catch {
            restoredByMessageAnchor = false;
          }
        }
      }

      if (!restoredByMessageAnchor) {
        el.scrollTop = computeTopLoadRestoredScrollTop(anchor, el.scrollHeight);
      }

      correctTopLoadAnchorAfterRender(anchor);
    },
    [correctTopLoadAnchorAfterRender, messageIds],
  );

  useLayoutEffect(() => {
    if (isViewingSubagent) return;
    const anchor = topLoadScrollAnchorRef.current;
    if (!anchor || anchor.sessionId !== activeSessionId) return;
    const el = messagesScrollRef.current;
    if (!el) return;
    if (!hasTopLoadAnchorContentShifted(anchor, messageIds, el.scrollHeight)) {
      if (!isLoadingMore) {
        topLoadScrollAnchorRef.current = null;
      }
      return;
    }
    restoreTopLoadScrollAnchor(anchor);
    topLoadScrollAnchorRef.current = null;
  }, [
    activeSessionId,
    historyLoadVersion,
    isLoadingMore,
    isViewingSubagent,
    messageIds,
    restoreTopLoadScrollAnchor,
  ]);

  const seekSideNavToOldest = useCallback(async () => {
    if (!useIndependentSideNavHistory) return;
    if (!effectiveScrollSessionId) return;
    const sessionId = effectiveScrollSessionId;
    setIsSideNavLoadingMore(true);
    try {
      const result = await apiClient.call("agent.getMessageNavPage", {
        sessionId,
        sessionPath: activeSideNavSessionPath ?? undefined,
        fromStart: true,
        limit: SIDE_NAV_WINDOW_SIZE,
      });
      const oldestMessages = mapNavMessages(result.messages);
      if (oldestMessages.length === 0) return;
      setSideNavExtraMessages(oldestMessages);
      setSideNavCursor(oldestMessages[0]?.id ?? null);
      setSideNavHasMore(false);
      setSideNavNewestExtraCursor(oldestMessages[oldestMessages.length - 1]?.id ?? null);
      setSideNavHasMoreNewer(oldestMessages.length >= SIDE_NAV_WINDOW_SIZE);
    } catch (err) {
      log.warn("Failed to seek side nav to oldest", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSideNavLoadingMore(false);
    }
  }, [activeSideNavSessionPath, effectiveScrollSessionId, useIndependentSideNavHistory]);

  const resetSideNavToLatest = useCallback(() => {
    setSideNavExtraMessages([]);
    setSideNavNewestExtraCursor(null);
    setSideNavHasMoreNewer(false);
    setSideNavCursor(messageNextCursor);
    setSideNavHasMore(hasMoreMessages);
  }, [hasMoreMessages, messageNextCursor]);

  const seekToAbsoluteTop = useCallback(async () => {
    if (!activeSessionId || isViewingSubagent) {
      scrollToEdge("top");
      return;
    }

    const sessionId = activeSessionId;
    const runId = topSeekRunIdRef.current + 1;
    topSeekRunIdRef.current = runId;
    topSeekSessionRef.current = sessionId;
    topLoadLockedSessionRef.current = sessionId;
    topLoadScrollAnchorRef.current = null;
    setIsSeekingTop(true);
    try {
      if (useIndependentSideNavHistory) {
        await Promise.all([loadTopMessages(sessionId), seekSideNavToOldest()]);
      } else {
        await loadTopMessages(sessionId);
      }
    } finally {
      if (topSeekRunIdRef.current === runId) {
        topSeekSessionRef.current = null;
        topLoadLockedSessionRef.current = null;
        setIsSeekingTop(false);
        scrollToEdge("top");
        requestAnimationFrame(() => {
          const iconId = sideNavRef.current?.getFirstIconId();
          if (iconId) {
            lastSetNavIdRef.current = iconId;
            setNavId(iconId);
          }
        });
      }
    }
  }, [
    activeSessionId,
    isViewingSubagent,
    loadTopMessages,
    scrollToEdge,
    seekSideNavToOldest,
    setNavId,
    useIndependentSideNavHistory,
  ]);

  const handleScrollToEdge = useCallback(
    (edge: "top" | "bottom") => {
      if (messageIds.length === 0) return;
      suspendAutoScroll();
      lastSetNavIdRef.current = null;
      if (edge === "top") {
        if (effectiveScrollSessionId && messageViewMode === "focus") {
          clearFocusedMessages(effectiveScrollSessionId);
          requestAnimationFrame(() => void seekToAbsoluteTop());
          return;
        }
        void seekToAbsoluteTop();
        return;
      }
      if (effectiveScrollSessionId && messageViewMode === "focus") {
        clearFocusedMessages(effectiveScrollSessionId);
        requestAnimationFrame(() => {
          scrollToEdge("bottom");
          setTimeout(() => {
            const iconId = sideNavRef.current?.getLastIconId();
            if (iconId) {
              lastSetNavIdRef.current = iconId;
              setNavId(iconId);
            }
          }, 200);
        });
        return;
      }
      if (activeSessionId && !isViewingSubagent) {
        clearTopWindowMessages(activeSessionId);
        resetSideNavToLatest();
        if (hasTrimmedTailMessages) {
          void (async () => {
            await loadSessionMessages(activeSessionId, { force: true });
            requestAnimationFrame(() => {
              scrollToEdge("bottom");
              setTimeout(() => {
                const iconId = sideNavRef.current?.getLastIconId();
                if (iconId) {
                  lastSetNavIdRef.current = iconId;
                  setNavId(iconId);
                }
              }, 200);
            });
          })();
          return;
        }
      }
      scrollToEdge(edge);
      setTimeout(() => {
        const iconId = sideNavRef.current?.getLastIconId();
        if (iconId) {
          lastSetNavIdRef.current = iconId;
          setNavId(iconId);
        }
      }, 200);
    },
    [
      activeSessionId,
      clearFocusedMessages,
      clearTopWindowMessages,
      effectiveScrollSessionId,
      hasTrimmedTailMessages,
      isViewingSubagent,
      loadSessionMessages,
      messageIds,
      messageViewMode,
      scrollToEdge,
      seekToAbsoluteTop,
      suspendAutoScroll,
      resetSideNavToLatest,
      setNavId,
    ],
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

  const loadMoreSideNav = useCallback(async () => {
    if (!useIndependentSideNavHistory) return;
    if (!effectiveScrollSessionId || isSideNavLoadingMore || !sideNavHasMore) return;
    const sessionId = effectiveScrollSessionId;
    setIsSideNavLoadingMore(true);
    try {
      const result = await apiClient.call("agent.getMessageNavPage", {
        sessionId,
        sessionPath: activeSideNavSessionPath ?? undefined,
        afterEntryId: sideNavCursor ?? undefined,
        limit: SIDE_NAV_PAGE_SIZE,
      });
      const olderMessages = mapNavMessages(result.messages);
      setSideNavExtraMessages((prev) => {
        const merged = mergeSideNavMessages(olderMessages, prev);
        if (prev.length === 0 && merged.length > 0) {
          setSideNavNewestExtraCursor(merged[merged.length - 1]?.id ?? null);
        }
        if (merged.length <= SIDE_NAV_WINDOW_SIZE) return merged;
        const trimmed = merged.slice(0, SIDE_NAV_WINDOW_SIZE);
        setSideNavNewestExtraCursor(trimmed[trimmed.length - 1]?.id ?? null);
        setSideNavHasMoreNewer(true);
        return trimmed;
      });
      setSideNavCursor(result.nextCursor ?? null);
      setSideNavHasMore(result.hasMore === true);
    } catch (err) {
      log.warn("Failed to load side nav page", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSideNavLoadingMore(false);
    }
  }, [
    activeSideNavSessionPath,
    effectiveScrollSessionId,
    isSideNavLoadingMore,
    sideNavCursor,
    sideNavHasMore,
    useIndependentSideNavHistory,
  ]);

  const loadNewerSideNav = useCallback(async () => {
    if (!useIndependentSideNavHistory) return;
    if (!effectiveScrollSessionId || isSideNavLoadingMore || !sideNavHasMoreNewer) return;
    const sessionId = effectiveScrollSessionId;
    setIsSideNavLoadingMore(true);
    try {
      const result = await apiClient.call("agent.getMessageNavPage", {
        sessionId,
        sessionPath: activeSideNavSessionPath ?? undefined,
        beforeEntryId: sideNavNewestExtraCursor ?? undefined,
        limit: SIDE_NAV_PAGE_SIZE,
      });
      const newerMessages = mapNavMessages(result.messages);
      setSideNavExtraMessages((prev) => {
        const merged = mergeSideNavMessages(prev, newerMessages);
        if (merged.length <= SIDE_NAV_WINDOW_SIZE) return merged;
        const trimmed = merged.slice(merged.length - SIDE_NAV_WINDOW_SIZE);
        const newOldest = trimmed[0];
        if (newOldest) {
          setSideNavCursor(newOldest.id);
          setSideNavHasMore(true);
        }
        return trimmed;
      });
      setSideNavNewestExtraCursor(result.nextCursor ?? null);
      setSideNavHasMoreNewer(result.hasMore === true);
    } catch (err) {
      log.warn("Failed to load newer side nav page", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsSideNavLoadingMore(false);
    }
  }, [
    activeSideNavSessionPath,
    effectiveScrollSessionId,
    isSideNavLoadingMore,
    sideNavHasMoreNewer,
    sideNavNewestExtraCursor,
    useIndependentSideNavHistory,
  ]);

  const sideNavPagination = useMemo<SideNavPagination | undefined>(() => {
    if (!shouldRenderSideNav || !effectiveScrollSessionId) return undefined;
    if (!useIndependentSideNavHistory) return undefined;
    return {
      hasMore: sideNavHasMore,
      isLoading: isSideNavLoadingMore,
      onLoadMore: loadMoreSideNav,
      hasMoreNewer: sideNavHasMoreNewer,
      onLoadNewer: loadNewerSideNav,
    };
  }, [
    effectiveScrollSessionId,
    isSideNavLoadingMore,
    loadMoreSideNav,
    loadNewerSideNav,
    shouldRenderSideNav,
    sideNavHasMore,
    sideNavHasMoreNewer,
    useIndependentSideNavHistory,
  ]);

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
        const sessionId = effectiveScrollSessionId;
        if (!sessionId) {
          releaseSideNavScrollLock();
          return;
        }
        void (async () => {
          const loaded = await loadFocusedMessagesAround(sessionId, target.messageId, {
            sessionPath: activeSideNavSessionPath ?? undefined,
          });
          if (!loaded) {
            releaseSideNavScrollLock();
            return;
          }
          requestAnimationFrame(() => {
            lastSetNavIdRef.current = target.blockId ?? target.messageId;
            scrollToMessage(target.messageId, { align: "start", smooth: false });
            if (target.blockId) {
              scrollBlockIntoViewWhenRendered(target.blockId);
            }
          });
        })();
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
      activeSideNavSessionPath,
      effectiveScrollSessionId,
      loadFocusedMessagesAround,
      messageIds,
      releaseSideNavScrollLock,
      scrollBlockIntoViewWhenRendered,
      scrollToMessage,
      suspendAutoScroll,
    ],
  );


  const [handleFollowUp, isFollowUpRunning] = useAsyncGuard(async () => {
    if (!inputText.trim() || !isStreaming) return;
    await sendFollowUp();
  });

  const {
    isDragOver,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  } = useAttachmentDrop();


  useEffect(() => {
    if (!isAtTop || !hasMoreMessages || isViewingSubagent || messageViewMode === "focus") {
      topLoadLockedSessionRef.current = null;
    }
  }, [activeSessionId, hasMoreMessages, isAtTop, isViewingSubagent, messageViewMode]);

  useEffect(() => {
    if (
      topSeekSessionRef.current === activeSessionId ||
      !shouldStartTopLoad({
        activeSessionId,
        isAtTop,
        hasMoreMessages: messageViewMode === "focus" ? false : hasMoreMessages,
        isLoadingMore,
        isViewingSubagent,
        initialScrollComplete: initialScrollCompleteSessionId === activeSessionId,
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
    initialScrollCompleteSessionId,
    isLoadingMore,
    isViewingSubagent,
    loadMoreMessages,
    messageViewMode,
  ]);

  const isFilePreviewOpen = overlay === "file" && !!filePreview;
  const chatIdentityTitle = chatIdentity
    ? chatProjectPath
      ? `${chatIdentity.title} · ${chatProjectPath}`
      : chatIdentity.title
    : "";
  const chatIdentityClassName = chatIdentity ? sessionIdentityClass(chatIdentity) : "";

  return (
    <div
      className="flex-1 min-h-0 flex flex-col overflow-hidden relative bg-bg-elevated"
      style={agentBorderColor ? { borderLeft: `2px solid ${agentBorderColor.border}` } : undefined}
    >
      <MermaidFullscreen />
      <RollbackOverlay />
      <ForkDialog />
      <>
        <div className="flex items-center gap-2 px-2 py-1.5 bg-bg-secondary/90 border-b border-border-primary text-[11px] text-text-tertiary flex-shrink-0 sm:gap-4 sm:px-4">
          <SessionToggleIcon />
          {activeSessionId && <TokenStatusBar sessionId={activeSessionId} />}
          {chatIdentity && (
            <span
              data-testid="chat-session-identity-badge"
              data-session-kind={chatIdentity.kind}
              className={`inline-flex min-w-0 max-w-[220px] items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-medium ${chatIdentityClassName}`}
              title={chatIdentityTitle}
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

        <div
          className={`flex-1 min-h-0 flex overflow-hidden ${
            hideMessageSurfaceUntilInitialBottom ? "pointer-events-none opacity-0" : ""
          }`}
          aria-busy={hideMessageSurfaceUntilInitialBottom ? "true" : undefined}
        >
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
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-xs hover:bg-accent-hover transition-colors"
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
                    activeSessionId={
                      (isViewingSubagent ? activeSubId : activeSessionId) ?? undefined
                    }
                    bufferSize={isMobileOrTablet ? 720 : 1600}
                  />
                  <TextSelectionToolbar
                    rootRef={selectionRootRef}
                    onQuoteText={(text) =>
                      useComposerPlaceholderStore.getState().addTextQuote(text)
                    }
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
                  isSeekingTop={isSeekingTop}
                />
              )}
            </div>
            {activeSessionId && !isViewingSubagent && (
              <>
                <QueueCards sessionId={activeSessionId} />
              </>
            )}
          </div>
          {shouldRenderSideNav && (
            <div className="w-10 shrink-0 overflow-hidden">
              <SideNav
                ref={sideNavRef}
                messages={sideNavMessages}
                onNavDotClick={handleNavDotClick}
                pagination={sideNavPagination}
                isScrollLocked={isSideNavScrollLocked}
                compactMotion={isMobileOrTablet}
              />
            </div>
          )}
        </div>

        <MessageSelectionBar
          messageIds={messageIds}
          messages={messages}
          onSummarizeSelected={handleSummarizeSelectedMessages}
          onRememberSelected={handleRememberSelectedMessages}
          onDeleteSelected={handleDeleteSelectedMessages}
        />

        {!goalMode && !isViewingSubagent && (
          <QuickActionToolbar onGoalClick={() => startGoalMode()} />
        )}

        <div
          className={`px-3 pt-1.5 pb-1 flex-shrink-0 bg-bg-secondary border-t border-border-primary relative ${isDragOver ? "ring-2 ring-accent/50 bg-accent/5" : ""}`}
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
                {!goalMode && (
                  <GoalVendorActionCard
                    sessionId={activeSessionId}
                    onEdit={startGoalMode}
                    onCancel={(sid) => {
                      void useGoalStore.getState().clearGoal(sid);
                      pushNotif({ message: t("goal.cancelled"), level: "info" });
                    }}
                  />
                )}
                <div className="flex items-end gap-1.5">
                  <div className="relative flex-1 overflow-visible rounded-xl border border-border-primary bg-bg-elevated/95 transition-colors focus-within:border-border-focus focus-within:shadow-sm">
                    {isRefiningGoal && <RefineGoalOverlay step={refineStep} />}
                    {!goalMode && <AttachmentBar />}
                    {!goalMode && <ComposerPlaceholderBar />}
                    {goalMode && (
                      <div className="mx-2 mt-2 flex flex-col gap-2 rounded-lg border border-border-primary/70 bg-bg-secondary/60 px-2.5 py-2 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 text-[11px] leading-4 text-text-tertiary">
                          <span className="font-medium text-text-secondary">
                            {t("goal.draft.entryTitle")}
                          </span>
                          <span className="ml-1">{t("goal.draft.entryHint")}</span>
                        </div>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <button
                            type="button"
                            onClick={generateGoalDraft}
                            disabled={isCreatingGoal || isRefiningGoal}
                            className="inline-flex shrink-0 items-center justify-center gap-1 rounded-md bg-surface-dim px-2.5 py-1.5 text-[11px] font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <Sparkles className="h-3.5 w-3.5" />
                            {goalDraft ? t("goal.draft.regenerate") : t("goal.draft.generate")}
                          </button>
                          <button
                            type="button"
                            data-testid="goal-draft-entry-close"
                            onClick={exitGoalMode}
                            disabled={isCreatingGoal || isRefiningGoal}
                            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                            title={t("goal.cancelCompose")}
                            aria-label={t("goal.cancelCompose")}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                    {goalMode && goalDraft && (
                      <GoalDraftCard
                        draft={goalDraft}
                        editing={isGoalDraftEditing}
                        disabled={isCreatingGoal || isRefiningGoal}
                        onChange={setGoalDraft}
                        onGenerate={generateGoalDraft}
                        onEdit={handleEditGoalDraft}
                        onSave={handleSaveGoalDraftEdit}
                        onCancel={handleCancelGoalDraftEdit}
                        onClose={exitGoalMode}
                        onAdd={() => void handleCreateGoal()}
                      />
                    )}
                    {activeRemoteDisconnected && (
                      <CardPrimitive
                        tone="error"
                        data-testid="composer-remote-disconnected"
                        className="mx-2 mt-2 flex items-start gap-2 px-2.5 py-2 text-[11px] leading-4 text-status-error"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold">{t("remoteDisconnectedTitle")}</div>
                          <div className="break-words text-status-error/80">
                            {remoteDisconnectedMessage}
                          </div>
                        </div>
                      </CardPrimitive>
                    )}
                    <InputBar
                      ref={inputBarRef}
                      onSend={goalMode ? handleCreateGoal : handleSend}
                      sessionId={activeSessionId ?? ""}
                      disabled={composerInputDisabled}
                      placeholder={
                        activeRemoteDisconnected
                          ? t("remoteDisconnectedPlaceholder")
                          : goalMode
                            ? t("goal.inputPlaceholder")
                            : undefined
                      }
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
                    {showComposerUtilityRow && (
                      <div className="flex min-h-10 items-center justify-between gap-2 border-t border-border-primary/70 px-2.5 py-1.5 max-lg:min-h-8 max-lg:py-1">
                        {(!isMobileOrTablet || goalMode) && (
                          <AttachmentButtons
                            layout="compact"
                            mode={goalMode ? "goal" : "normal"}
                            onGoalClick={() => startGoalMode()}
                            onExitGoalMode={exitGoalMode}
                          />
                        )}
                        {!goalMode && (
                          <ReturnToSourceButton variant="bottom" target={returnSourceTarget} />
                        )}
                        {!goalMode && !isMobileOrTablet && (
                          <div className="hidden text-[11px] text-text-tertiary sm:block">
                            {attachmentCount > 0
                              ? t("fileAttachment.count", { count: attachmentCount })
                              : t("composerActionsHint")}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col justify-end gap-1.5 py-1">
                    {goalMode ? (
                      <button
                        onClick={() => void handleRefineGoal()}
                        disabled={
                          isCreatingGoal || isRefiningGoal || !(goalDraft || inputText).trim()
                        }
                        className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${isRefiningGoal ? "bg-accent/20 text-accent" : "bg-surface-dim text-text-secondary hover:bg-surface-hover hover:text-accent"} disabled:opacity-50 disabled:cursor-not-allowed`}
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
                        disabled={isFollowUpRunning}
                        className="p-2.5 rounded-lg transition-colors flex items-center justify-center bg-status-info text-white hover:bg-status-info shadow-sm shadow-status-info/20 disabled:opacity-50 disabled:cursor-not-allowed"
                        title={t("sendFollowUp")}
                        aria-label={t("sendFollowUp")}
                      >
                        <Clock className="w-4 h-4" />
                      </button>
                    ) : isStreaming ? (
                      <button
                        onClick={handleAbort}
                        disabled={isAborting || isAbortRunning}
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
                      disabled={sendDisabled}
                      className={`p-2.5 rounded-lg transition-colors flex items-center justify-center ${!sendDisabled ? (goalMode ? "bg-accent text-white hover:bg-accent-hover shadow-sm shadow-accent/20" : isStreaming ? "bg-status-warning text-white hover:bg-status-warning shadow-sm shadow-status-warning/20" : "bg-accent text-white hover:bg-accent-hover shadow-sm shadow-accent/20") : "bg-surface-dim text-text-tertiary cursor-not-allowed"}`}
                      title={
                        isPermissionPending
                          ? t("waitPermission")
                          : activeRemoteDisconnected
                            ? t("remoteDisconnectedPlaceholder")
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
                disabled={isForking}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium
                bg-accent/15 text-accent hover:bg-accent/25 hover:text-accent
                border border-accent/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title={t("enterChat")}
              >
                <GitFork className="w-3 h-3" />
                {t("enterChat")}
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
      </>
      {isFilePreviewOpen && (
        <div className="absolute inset-0 z-20 bg-bg-elevated">
          <FileOverlay
            preview={filePreview}
            loading={loadingFile}
            onClose={closeOverlay}
            onSave={handleSaveFile}
            onToggleEdit={setFileEditable}
            embedded
          />
        </div>
      )}
    </div>
  );
}

export function ReturnToSourceButton({
  variant = "bottom",
  target,
}: {
  variant?: "top" | "bottom";
  target?: ReturnSourceTarget | null;
}) {
  const { t } = useTranslation("chat");
  const fallbackTarget = useReturnToSourceSession();
  const returnTarget = target === undefined ? fallbackTarget : target;
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
        className="p-1 rounded transition-colors text-text-tertiary hover:text-text-primary hover:bg-surface-hover max-sm:-ml-1"
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
      className={`p-1 rounded transition-colors max-sm:-ml-1 ${isVisible ? "text-accent hover:text-accent bg-accent/10" : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover"}`}
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
      className={`p-1 rounded transition-colors max-sm:-mr-1 ${isVisible ? "text-accent hover:text-accent bg-accent/10" : "text-text-tertiary hover:text-text-primary hover:bg-surface-hover"}`}
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
