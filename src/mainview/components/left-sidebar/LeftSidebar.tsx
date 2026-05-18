import { Pin, Plus, PanelLeft, PanelLeftClose } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useGitStore } from "../../stores/use-git-store";
import { SessionSidebar } from "../session-sidebar/SessionSidebar";
import { SidebarBottomControls } from "./SidebarBottomControls";
import { useState } from "react";

interface LeftSidebarProps {
  width: number;
  overlay: boolean;
}

export function LeftSidebar({ width, overlay }: LeftSidebarProps) {
  const { t } = useTranslation("sidebar");
  const sessionPanel = useLayoutStore((s) => s.sessionPanel);
  const toggleSession = useLayoutStore((s) => s.toggleSession);

  const isPinned = sessionPanel === "pinned";
  const hideSession = useLayoutStore((s) => s.hideSession);

  const [showSuccessToast, setShowSuccessToast] = useState(false);
  const [showErrorToast, setShowErrorToast] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  return (
    <div
      className={`flex flex-col bg-bg-elevated dark:bg-surface-code border-r border-border-secondary overflow-x-hidden z-20 ${
        overlay
          ? "animate-slide-in-left shadow-xl shadow-black/10 dark:shadow-black/30 will-change-transform"
          : ""
      }`}
      style={overlay ? { position: "absolute", left: 0, top: 0, bottom: 0, width } : { width }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-secondary dark:border-border-secondary/80 shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-text-primary tracking-wide"></span>
          <span className="text-[10px] text-text-tertiary dark:text-text-secondary bg-surface-dim px-1.5 py-0.5 rounded-full font-mono">
            {useSessionCount()}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            data-testid="new-session-button"
            onClick={async (e) => {
              e.stopPropagation();
              if (isCreating) return;

              setIsCreating(true);
              const state = useSessionStore.getState();
              const worktrees = useGitStore.getState().worktrees;
              const activeSession = state.activeSessionId
                ? Object.values(state.sessionsByProject)
                    .flat()
                    .find((s) => s.sessionId === state.activeSessionId)
                : null;
              const workspace = activeSession
                ? worktrees.find((wt) => activeSession.projectPath.startsWith(wt.path))
                : null;

              try {
                await state.createNewSession(workspace?.path);
                setShowSuccessToast(true);
                setTimeout(() => setShowSuccessToast(false), 2000);
              } catch (error) {
                const errMsg = error instanceof Error ? error.message : String(error);
                setShowErrorToast(errMsg);
                setTimeout(() => setShowErrorToast(""), 3000);
              } finally {
                setIsCreating(false);
              }
            }}
            disabled={isCreating}
            className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed relative"
            title={t("newSession")}
            aria-label={t("newSession")}
          >
            <Plus className="w-3.5 h-3.5" />
            {isCreating && (
              <div className="absolute inset-0 flex items-center justify-center bg-bg-elevated/80 dark:bg-surface-code/80 rounded">
                <div className="w-2.5 h-2.5 border-2 border-semantic-accent border-t-transparent rounded-full animate-spin" />
              </div>
            )}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              toggleSession();
            }}
            className={`p-1 rounded transition-colors max-sm:hidden ${isPinned ? "text-semantic-accent" : "text-text-tertiary dark:text-text-secondary hover:text-text-secondary dark:hover:text-tertiary"}`}
            title={isPinned ? t("unpinPanel") : t("pinPanel")}
            aria-label={isPinned ? t("unpinPanel") : t("pinPanel")}
          >
            <Pin className="w-3.5 h-3.5" fill={isPinned ? "currentColor" : "none"} />
          </button>
          {overlay ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                hideSession();
              }}
              className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors"
              title={t("closePanel")}
              aria-label={t("closePanel")}
            >
              <PanelLeft className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                useLayoutStore.getState().toggleSessionCollapse();
              }}
              className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-dim text-text-tertiary hover:text-text-secondary dark:hover:text-text-secondary transition-colors max-sm:hidden"
              title={t("collapseSidebar")}
              aria-label={t("collapseSidebar")}
            >
              <PanelLeftClose className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden">
        <SessionSidebar />
      </div>

      <SidebarBottomControls />

      {showSuccessToast && (
        <div className="fixed bottom-16 left-4 z-50 bg-status-success/90 text-white px-4 py-2 rounded-md shadow-lg animate-slide-in-left">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-white" />
            <span className="text-sm">{t("sessionCreated")}</span>
          </div>
        </div>
      )}

      {showErrorToast && (
        <div className="fixed bottom-16 left-4 z-50 bg-status-error/90 text-white px-4 py-2 rounded-md shadow-lg animate-slide-in-left max-w-md">
          <div className="flex items-start gap-2">
            <div className="w-2 h-2 rounded-full bg-white mt-0.5 shrink-0" />
            <span className="text-sm">{t("createFailed", { error: showErrorToast })}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function useSessionCount(): number {
  const sessions = useSessionStore((s) => {
    const tab = s.projectTabs.find((t) => t.id === s.activeProjectId);
    if (!tab) return 0;
    return (s.sessionsByProject[tab.path] || []).length;
  });
  return sessions;
}
