import { memo, useCallback, useEffect, useState } from "react";
import { Bot, GitFork, Zap, Sparkles, Brain } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useForkDialogStore } from "../../stores/use-fork-dialog-store";
import { useAgentStore } from "../../stores/use-agent-store";
import { useTierStore, TIER_KEYS } from "../../stores/use-tier-store";
import type { TierKey } from "../../stores/use-tier-store";
import { useSessionStore, insertAfterPinned } from "../../stores/use-session-store";
import { useChatStore } from "../../stores/use-chat-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { apiClient } from "../../lib/api-client";
import type { SessionMeta } from "../../types";
import { createLogger } from "../../../shared/lib/logger";
import { Button, FullscreenOverlay } from "../primitives";
import { agentColorStyle } from "../../utils/agent-color";
import { AgentAvatar } from "../agent-avatar/AgentAvatar";

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

  const agents = useAgentStore((s) => s.agents);
  const forkSessionId = useForkDialogStore((s) => s.config?.sessionId);
  const currentTier = useTierStore((s) =>
    forkSessionId ? (s.dataBySession[forkSessionId]?.currentTier ?? null) : null,
  );
  const forkTierModels = useTierStore((s) =>
    forkSessionId ? s.dataBySession[forkSessionId]?.tierModels : undefined,
  );
  const globalDefaults = useTierStore((s) => s.globalDefaults);
  const tierModels = forkTierModels ?? globalDefaults;

  const [selectedAgent, setSelectedAgent] = useState("build");
  const [selectedTier, setSelectedTier] = useState<TierKey>("pro");

  useEffect(() => {
    if (open && config) {
      const agent = useAgentStore.getState().getCurrentAgentForSession(config.sessionId);
      setSelectedAgent(agent);
      const tier =
        (forkSessionId ? useTierStore.getState().getCurrentTier(forkSessionId) : null) ?? "pro";
      setSelectedTier(tier as TierKey);
    }
  }, [open, config]);

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
    <FullscreenOverlay
      title={t("forkDialog.title")}
      icon={<GitFork className="w-4 h-4 text-semantic-accent shrink-0" />}
      onClose={closeDialog}
      closeLabel={t("forkDialog.cancel")}
      footer={
        <>
          <Button size="md" variant="secondary" onClick={closeDialog} disabled={forking}>
            {t("forkDialog.cancel")}
          </Button>
          <Button
            size="md"
            variant="primary"
            onClick={handleFork}
            loading={forking}
            leadingIcon={<GitFork className="w-3.5 h-3.5" />}
          >
            {t("forkDialog.confirm")}
          </Button>
        </>
      }
    >
      <div className="max-w-2xl w-full mx-auto px-4 sm:px-6 py-6">
        <div className="mb-6">
          <label className="block text-sm font-medium text-text-primary mb-2">
            {t("forkDialog.agent")}
          </label>
          <div className="flex flex-wrap gap-2">
            {agents.map((agent) => {
              const isSelected = selectedAgent === agent.name;
              const cs = agentColorStyle(agent.color);
              return (
                <button
                  key={agent.name}
                  onClick={() => setSelectedAgent(agent.name)}
                  className={`px-3 py-2 rounded-lg border text-sm flex items-center gap-2 transition-colors ${
                    isSelected
                      ? "border-semantic-accent bg-semantic-accent/10 text-text-primary"
                      : "border-border-secondary text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover"
                  }`}
                  style={
                    isSelected && cs
                      ? { borderColor: cs.border, backgroundColor: cs.bg }
                      : undefined
                  }
                >
                  <AgentAvatar
                    avatar={agent.avatar}
                    agentFilePath={agent.filePath}
                    color={agent.color}
                    fallbackIcon={Bot}
                    className="w-5 h-5 rounded-full shrink-0 text-[13px]"
                    fallbackClassName={cs ? "" : "text-text-tertiary"}
                    title={agent.name}
                  />
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
    </FullscreenOverlay>
  );
});
