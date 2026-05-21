import { memo, useCallback, useEffect, useRef, useState } from "react";
import { GitFork, X, Zap, Sparkles, Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useForkDialogStore } from "../../stores/use-fork-dialog-store";
import { useAgentStore, AGENT_ICONS } from "../../stores/use-agent-store";
import { useTierStore, TIER_KEYS } from "../../stores/use-tier-store";
import type { TierKey } from "../../stores/use-tier-store";
import { useSessionStore, insertAfterPinned } from "../../stores/use-session-store";
import { useChatStore } from "../../stores/use-chat-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useFocusTrap } from "../../hooks/use-focus-trap";
import { apiClient } from "../../lib/api-client";
import type { SessionMeta } from "../../types";
import { createLogger } from "../../../shared/lib/logger";

const log = createLogger("fork-dialog");

const TIER_ICONS: Record<TierKey, typeof Zap> = { fast: Zap, pro: Sparkles, max: Brain };
const TIER_COLORS: Record<TierKey, string> = {
  fast: "text-status-info",
  pro: "text-semantic-accent",
  max: "text-semantic-agent",
};

export const ForkDialog = memo(function ForkDialog() {
  const { t } = useTranslation("chat");
  const open = useForkDialogStore((s) => s.open);
  const config = useForkDialogStore((s) => s.config);
  const forking = useForkDialogStore((s) => s.forking);
  const closeDialog = useForkDialogStore((s) => s.closeDialog);
  const setForking = useForkDialogStore((s) => s.setForking);
  const containerRef = useRef<HTMLDivElement>(null);

  const agents = useAgentStore((s) => s.agents);
  const currentTier = useTierStore((s) => s.currentTier);
  const tierModels = useTierStore((s) => s.tierModels);

  const [selectedAgent, setSelectedAgent] = useState("build");
  const [selectedTier, setSelectedTier] = useState<TierKey>("pro");

  useEffect(() => {
    if (open && config) {
      const agent = useAgentStore.getState().getCurrentAgentForSession(config.sessionId);
      setSelectedAgent(agent);
      const tier = useTierStore.getState().currentTier ?? "pro";
      setSelectedTier(tier as TierKey);
    }
  }, [open, config]);

  useFocusTrap(containerRef, { onEscape: closeDialog });

  const handleFork = useCallback(async () => {
    const cfg = useForkDialogStore.getState().config;
    if (!cfg) return;

    setForking(true);
    try {
      const result = await apiClient
        .call("agent.fork", { sessionId: cfg.sessionId, entryId: cfg.entryId, position: "at" })
        .catch((err) => {
          log.warn("fork failed", { err });
          return undefined;
        });

      if (!result || result.cancelled || !result.newSessionId || !result.newSessionFile) {
        setForking(false);
        return;
      }

      const state = useSessionStore.getState();
      const activeTab = state.projectTabs.find(
        (t: { id: string }) => t.id === state.activeProjectId,
      );
      if (!activeTab) {
        setForking(false);
        return;
      }

      const allSessions = state.sessionsByProject[activeTab.path] ?? [];
      const originalSession = allSessions.find((s) => s.sessionId === cfg.sessionId);
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
        delegateParentSessionId: null,
        delegateType: null,
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

      state.setActiveSession(result.newSessionId, undefined, {
        skipCleanup: true,
        forceNewProcess: true,
      });
      useChatStore.getState().loadSessionMessages(result.newSessionId, { force: true });

      const currentAgentName = useAgentStore.getState().getCurrentAgentForSession(cfg.sessionId);
      if (selectedAgent !== currentAgentName) {
        await apiClient.call("agent.switchAgent", {
          sessionId: result.newSessionId,
          agentName: selectedAgent,
        });
      }

      if (selectedTier !== currentTier) {
        await useTierStore.getState().switchToTier(selectedTier, result.newSessionId);
      }

      useNotificationStore.getState().push({ message: t("messageCard.forked"), level: "info" });
      closeDialog();
    } catch (err) {
      log.warn("fork error", { err });
    } finally {
      setForking(false);
    }
  }, [selectedAgent, selectedTier, currentTier, t, closeDialog, setForking]);

  if (!open || !config) return null;

  return (
    <div
      ref={containerRef}
      className="fixed inset-0 z-50 flex flex-col bg-bg-elevated/98 dark:bg-surface-code/98 backdrop-blur-sm overflow-hidden"
    >
      <div
        className="flex items-center gap-2 px-4 py-2 bg-surface-dim/90 dark:bg-surface-code/90 border-b border-border-secondary flex-shrink-0"
        style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top, 0px))" }}
      >
        <GitFork className="w-4 h-4 text-semantic-accent shrink-0" />
        <span className="text-sm font-medium text-text-primary truncate flex-1 min-w-0">
          {t("forkDialog.title")}
        </span>
        <button
          onClick={closeDialog}
          className="p-2 rounded text-text-tertiary hover:text-text-primary dark:hover:text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors"
          title={t("forkDialog.cancel")}
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div
        className="flex-1 overflow-y-auto overscroll-contain"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="max-w-2xl w-full mx-auto px-4 sm:px-6 py-6">
          <div className="mb-6">
            <label className="block text-sm font-medium text-text-primary mb-2">
              {t("forkDialog.agent")}
            </label>
            <div className="flex flex-wrap gap-2">
              {agents.map((agent) => {
                const isSelected = selectedAgent === agent.name;
                const icon = AGENT_ICONS[agent.name] ?? "🤖";
                return (
                  <button
                    key={agent.name}
                    onClick={() => setSelectedAgent(agent.name)}
                    className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 transition-colors ${
                      isSelected
                        ? "border-semantic-accent bg-semantic-accent/10 text-text-primary"
                        : "border-border-secondary text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover"
                    }`}
                  >
                    <span>{icon}</span>
                    <span className="font-medium">{agent.name}</span>
                    {agent.description && (
                      <span className="text-xs text-text-tertiary hidden sm:inline">
                        {agent.description}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mb-6">
            <label className="block text-sm font-medium text-text-primary mb-2">
              {t("forkDialog.model")}
            </label>
            <div className="flex flex-wrap gap-2">
              {TIER_KEYS.map((tier) => {
                const isSelected = selectedTier === tier;
                const Icon = TIER_ICONS[tier];
                const modelName = tierModels[tier];
                return (
                  <button
                    key={tier}
                    onClick={() => setSelectedTier(tier)}
                    className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 transition-colors ${
                      isSelected
                        ? "border-semantic-accent bg-semantic-accent/10 text-text-primary"
                        : "border-border-secondary text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover"
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${TIER_COLORS[tier]}`} />
                    <span className="font-medium">
                      {t(`tier${tier.charAt(0).toUpperCase() + tier.slice(1)}`)}
                    </span>
                    {modelName && (
                      <span className="text-xs text-text-tertiary hidden sm:inline max-w-[200px] truncate">
                        {modelName.split("/").pop()}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div
        className="flex items-center justify-end gap-3 px-4 sm:px-6 py-3 border-t border-border-secondary flex-shrink-0"
        style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <button
          onClick={closeDialog}
          disabled={forking}
          className="px-4 py-2 text-sm rounded-lg border border-border-secondary text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors disabled:opacity-50"
        >
          {t("forkDialog.cancel")}
        </button>
        <button
          onClick={handleFork}
          disabled={forking}
          className="px-4 py-2 text-sm rounded-lg bg-semantic-accent hover:bg-semantic-accent/80 text-white transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {forking && (
            <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          )}
          <GitFork className="w-3.5 h-3.5" />
          {t("forkDialog.confirm")}
        </button>
      </div>
    </div>
  );
});
