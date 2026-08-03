import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { InputBarHandle } from "./InputBar";
import { useGoalStore } from "../../stores/use-goal-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { bootstrapGoalSetupWithRetry } from "../../lib/goal-setup";
import { buildGoalDraftMarkdown } from "./goal-draft";
import { createLogger } from "../../../shared/lib/logger";

const log = createLogger("chat");

interface CommandPopupHandle {
  closePopup: () => void;
}

export interface UseGoalModeDeps {
  activeSessionId: string | null;
  isViewingSubagent: boolean;
  inputText: string;
  setInputText: (text: string) => void;
  effectiveStatus: string | undefined;
  projectName: string;
  projectPath: string;
  sessionTitle: string;
  messageCount: number;
  attachmentCount: number;
  hasComposerPlaceholders: boolean;
  isMobileOrTablet: boolean;
  sendMessage: () => Promise<void>;
  inputBarRef: React.RefObject<InputBarHandle | null>;
  commandPopup: CommandPopupHandle;
}

export interface GoalModeApi {
  goalMode: boolean;
  isCreatingGoal: boolean;
  isRefiningGoal: boolean;
  refineStep: number;
  goalDraft: string;
  isGoalDraftEditing: boolean;
  setGoalDraft: (text: string) => void;
  startGoalMode: (objective?: string) => void;
  exitGoalMode: () => void;
  generateGoalDraft: () => void;
  handleEditGoalDraft: () => void;
  handleCancelGoalDraftEdit: () => void;
  handleSaveGoalDraftEdit: () => void;
  /**
   * Submits the goal. Caller is responsible for post-create UI cleanup
   * (resumeAutoScroll etc.) — see handleCreateGoalWithCleanup below.
   * Returns true when the goal was actually created.
   */
  handleCreateGoal: () => Promise<boolean>;
  handleRefineGoal: () => Promise<void>;
}

/**
 * Encapsulates goal-mode state and handlers for ChatPanel.
 *
 * Pulled out so ChatPanel.tsx stops being a 5400-line monolith and the
 * goal-mode flow (start → edit draft → create / refine) can be reasoned
 * about in isolation.
 *
 * Caller must wrap handleCreateGoal with any post-create side effects
 * (scroll reset, input blur on mobile) since those depend on late-bound
 * ChatPanel state that isn't available when this hook is invoked.
 */
export function useGoalMode(deps: UseGoalModeDeps): GoalModeApi {
  const { t } = useTranslation("chat");
  const [goalMode, setGoalMode] = useState(false);
  const [isCreatingGoal, setIsCreatingGoal] = useState(false);
  const [isRefiningGoal, setIsRefiningGoal] = useState(false);
  const [refineStep, setRefineStep] = useState(0);
  const [goalDraft, setGoalDraft] = useState("");
  const [isGoalDraftEditing, setIsGoalDraftEditing] = useState(false);
  const preGoalInputRef = useRef("");
  const preEditGoalDraftRef = useRef("");

  const startSetup = useGoalStore((s) => s.startSetup);
  const refineGoal = useGoalStore((s) => s.refineGoal);

  const exitGoalMode = useCallback(() => {
    setGoalMode(false);
    setGoalDraft("");
    setIsGoalDraftEditing(false);
    deps.setInputText(preGoalInputRef.current);
    preGoalInputRef.current = "";
    preEditGoalDraftRef.current = "";
  }, [deps]);

  const startGoalMode = useCallback(
    (objective?: string) => {
      if (deps.isViewingSubagent) return;
      if (goalMode) {
        exitGoalMode();
        return;
      }
      const draftHint = objective ?? deps.inputText;
      const draft = buildGoalDraftMarkdown({
        projectName: deps.projectName,
        projectPath: deps.projectPath,
        sessionTitle: deps.sessionTitle,
        hint: draftHint,
        messageCount: deps.messageCount,
        hasAttachments: deps.attachmentCount > 0 || deps.hasComposerPlaceholders,
      });
      preGoalInputRef.current = deps.inputText;
      deps.setInputText(draftHint);
      setGoalDraft(draft);
      setIsGoalDraftEditing(false);
      preEditGoalDraftRef.current = "";
      setGoalMode(true);
      deps.commandPopup.closePopup();
      requestAnimationFrame(() => deps.inputBarRef.current?.focus?.());
    },
    [deps, exitGoalMode, goalMode],
  );

  const generateGoalDraft = useCallback(() => {
    const draft = buildGoalDraftMarkdown({
      projectName: deps.projectName,
      projectPath: deps.projectPath,
      sessionTitle: deps.sessionTitle,
      hint: deps.inputText,
      messageCount: deps.messageCount,
      hasAttachments: deps.attachmentCount > 0 || deps.hasComposerPlaceholders,
    });
    setGoalDraft(draft);
    setIsGoalDraftEditing(false);
  }, [deps]);

  const handleEditGoalDraft = useCallback(() => {
    preEditGoalDraftRef.current = goalDraft;
    setIsGoalDraftEditing(true);
  }, [goalDraft]);

  const handleCancelGoalDraftEdit = useCallback(() => {
    if (preEditGoalDraftRef.current) {
      setGoalDraft(preEditGoalDraftRef.current);
    }
    setIsGoalDraftEditing(false);
  }, []);

  const handleSaveGoalDraftEdit = useCallback(() => {
    preEditGoalDraftRef.current = "";
    setIsGoalDraftEditing(false);
  }, []);

  const handleCreateGoal = useCallback(async () => {
    const objective = (goalDraft || deps.inputText).trim();
    if (!deps.activeSessionId || !objective || isCreatingGoal) return false;
    setIsCreatingGoal(true);
    try {
      const needsBootstrap = deps.effectiveStatus === "idle" || deps.effectiveStatus === undefined;
      if (needsBootstrap) {
        deps.setInputText(objective);
        await deps.sendMessage();
        const setupResult = await bootstrapGoalSetupWithRetry(deps.activeSessionId, objective, {
          startSetup,
        });
        if (!setupResult.started) {
          const pushNotif = useNotificationStore.getState().push;
          pushNotif({
            message: t("goal.startSetupFailed", {
              defaultValue: `Goal 启动失败：${setupResult.error ?? "unknown"}`,
              error: setupResult.error ?? "",
            }),
            level: "error",
          });
          log.warn("Goal startSetup did not become ready", {
            sessionId: deps.activeSessionId,
            error: setupResult.error,
          });
          return false;
        }
      } else {
        await startSetup(deps.activeSessionId, objective);
        deps.setInputText(objective);
        await deps.sendMessage();
      }
      deps.setInputText("");
      setGoalDraft("");
      setIsGoalDraftEditing(false);
      setGoalMode(false);
      preGoalInputRef.current = "";
      preEditGoalDraftRef.current = "";
      if (deps.isMobileOrTablet) {
        deps.inputBarRef.current?.blur();
      }
      return true;
    } finally {
      setIsCreatingGoal(false);
    }
  }, [deps, goalDraft, isCreatingGoal, startSetup, t]);

  const handleRefineGoal = useCallback(async () => {
    const objective = (goalDraft || deps.inputText).trim();
    if (!deps.activeSessionId || !objective || isRefiningGoal) return;
    setIsRefiningGoal(true);
    setRefineStep(1);
    await new Promise((r) => setTimeout(r, 300));
    setRefineStep(2);
    try {
      const result = await refineGoal(deps.activeSessionId, objective);
      if (result.success && result.objective) {
        if (goalDraft) {
          setGoalDraft(result.objective);
        } else {
          deps.setInputText(result.objective);
        }
      }
      setRefineStep(3);
      await new Promise((r) => setTimeout(r, 600));
    } finally {
      setIsRefiningGoal(false);
      setRefineStep(0);
    }
  }, [deps, goalDraft, isRefiningGoal, refineGoal]);

  return {
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
    handleCreateGoal,
    handleRefineGoal,
  };
}
