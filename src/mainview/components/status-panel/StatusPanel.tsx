import { useState, useCallback, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Cable,
  CloudCog,
  Zap,
  ShieldCheck,
  ClipboardList,
  Terminal,
  Plug,
  Network,
  Puzzle,
  Radar,
  CheckCircle2,
  Circle,
  AlertTriangle,
  BookOpen,
  Eye,
  EyeOff,
  Trash2,
  Copy,
  Check,
  RotateCw,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { useStatusStore, type MCPServerInfo } from "../../stores/use-status-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useSessionTodoStore } from "../../stores/use-session-todo-store";
import type { TodoPriority } from "../../stores/use-session-todo-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useLspStore } from "../../stores/use-lsp-store";
import { useBashStore } from "../../stores/use-bash-store";
import { BashProcessCard, LogViewer } from "../bash-panel/BashPanel";
import type { LspDiagnosticsMode } from "../../../shared/modules/lsp";
import type { StatusSection } from "../../stores/use-status-store";
import { useClipboard } from "../chat/preview/use-clipboard";
import type { PluginInfo } from "../../stores/use-status-store";
import { useIssueMonitorStore } from "../../stores/use-issue-monitor-store";
import { formatFilePath } from "../../lib/format-path";
import { apiClient } from "../../lib/api-client";
import type { RemoteProjectRef } from "../../../shared/modules/project";
import type { RemoteSshStatus } from "../../../shared/modules/agent";
import { useEffectiveSessionId } from "../../hooks/use-effective-session-id";

const PRIORITY_STYLES: Record<TodoPriority, { dot: string; label: string }> = {
  high: { dot: "bg-status-error", label: "H" },
  medium: { dot: "bg-status-warning", label: "M" },
  low: { dot: "bg-text-tertiary", label: "L" },
};

function isRemoteProjectLocalPath(projectPath: string | undefined): boolean {
  return Boolean(
    projectPath &&
    /\/(?:\.pi-agent-chat|\.pi\/chat)\/remote-projects\/ssh-[^/]+(?:\/|$)/.test(projectPath),
  );
}

function PluginCopyButton({ plugin }: { plugin: PluginInfo }) {
  const { t } = useTranslation("status");
  const { copied, copy } = useClipboard(1500, { showToast: true });
  const handleCopy = useCallback(() => {
    const scopeLabel = plugin.scope === "global" ? t("global") : t("project");
    const lines = [
      `${t("nameLabel")} ${plugin.name}`,
      `${t("locationLabel")} ${scopeLabel}`,
      `${t("pathFieldLabel")} ${plugin.path}`,
      `${t("toolsFieldLabel", { count: plugin.toolNames.length })} ${plugin.toolNames.join(", ") || t("none")}`,
      `${t("commandsFieldLabel", { count: plugin.commandNames.length })} ${plugin.commandNames.join(", ") || t("none")}`,
      `${t("channelsFieldLabel", { count: plugin.channelNames.length })} ${plugin.channelNames.join(", ") || t("none")}`,
      `${t("eventsFieldLabel", { count: plugin.eventNames.length })} ${plugin.eventNames.join(", ") || t("none")}`,
      `${t("permissionProvidersFieldLabel", { count: plugin.permissionProviderNames.length })} ${plugin.permissionProviderNames.join(", ") || t("none")}`,
    ];
    if (plugin.usageNotice) {
      lines.push(`${t("usageNoticeLabel")} ${plugin.usageNotice.message}`);
    }
    copy(lines.join("\n"));
  }, [plugin, t, copy]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-text-tertiary hover:text-text-secondary transition-colors mt-0.5"
    >
      {copied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? t("copied") : t("copyInfo")}</span>
    </button>
  );
}

export function StatusPanel() {
  const { t } = useTranslation("status");
  const permissionProfile = useStatusStore((s) => s.permissionProfile);
  const permissionProfileLoading = useStatusStore((s) => s.permissionProfileLoading);
  const projectTrust = useStatusStore((s) => s.projectTrust);
  const projectTrustLoading = useStatusStore((s) => s.projectTrustLoading);
  const executionSandbox = useStatusStore((s) => s.executionSandbox);
  const executionSandboxLoading = useStatusStore((s) => s.executionSandboxLoading);
  const setRemoteRuntimeStatus = useStatusStore((s) => s.setRemoteRuntimeStatus);
  const activeSessionId = useEffectiveSessionId();
  const liveRemoteStatus = useStatusStore((s) =>
    activeSessionId ? (s.remoteRuntimeBySession?.[activeSessionId] ?? null) : null,
  );
  const plugins = useStatusStore((s) => s.plugins);
  const skills = useStatusStore((s) => s.skills);
  const expandedSkill = useStatusStore((s) => s.expandedSkill);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
  const activeSubsessionInfo = useSubagentStore(
    useShallow((s) =>
      activeSubId
        ? (Object.values(s.subsessionsByParent ?? {})
            .flat()
            .find((sub) => sub.sessionId === activeSubId) ?? null)
        : null,
    ),
  );
  const todosBySession = useSessionTodoStore((s) => s.todosBySession);
  const allProcesses = useBashStore(useShallow((s) => s.processesBySession[activeSessionId ?? ""]));
  const backgroundedIds = useBashStore((s) => s.backgroundedIds);
  const [logViewer, setLogViewer] = useState<{ logPath: string; toolCallId: string } | null>(null);
  const todos = activeSessionId ? todosBySession[activeSessionId] : undefined;
  const lspStore = useLspStore((s) => s.statusBySession);
  const lspData = activeSessionId ? lspStore[activeSessionId] : undefined;
  const collapsedSections = useStatusStore((s) => s.collapsedSections);
  const toggleSection = useStatusStore((s) => s.toggleSection);
  const setPermissionProfile = useStatusStore((s) => s.setPermissionProfile);
  const trustCurrentProject = useStatusStore((s) => s.trustCurrentProject);
  const refreshExecutionSandbox = useStatusStore((s) => s.refreshExecutionSandbox);
  const setExecutionSandboxMode = useStatusStore((s) => s.setExecutionSandboxMode);
  const toggleSkillExpanded = useStatusStore((s) => s.toggleSkillExpanded);
  const toggleSkillEnabled = useStatusStore((s) => s.toggleSkillEnabled);
  const expandedPlugin = useStatusStore((s) => s.expandedPlugin);
  const togglePluginExpanded = useStatusStore((s) => s.togglePluginExpanded);
  const togglePluginEnabled = useStatusStore((s) => s.togglePluginEnabled);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const safeProjectTabs = projectTabs ?? [];
  const safeSessionsByProject = sessionsByProject ?? {};
  const activeProjectTab = safeProjectTabs.find((tab) => tab.id === activeProjectId) ?? null;
  const listedSessionMeta =
    activeProjectTab && activeSessionId
      ? safeSessionsByProject[activeProjectTab.path]?.find((s) => s.sessionId === activeSessionId)
      : null;
  const activeSessionMeta =
    listedSessionMeta ??
    (activeSubsessionInfo
      ? {
          sessionId: activeSubsessionInfo.sessionId,
          sessionPath: activeSubsessionInfo.sessionPath,
          projectPath: activeProjectTab?.path,
        }
      : null);
  const backgroundProcesses = allProcesses?.filter((p) => backgroundedIds.has(p.toolCallId)) ?? [];
  const hasProcesses = backgroundProcesses.length > 0;
  const [showPermissionAdvanced, setShowPermissionAdvanced] = useState(false);
  const [remoteStatus, setRemoteStatus] = useState<RemoteSshStatus | null>(null);
  const [recoveredRemoteRef, setRecoveredRemoteRef] = useState<RemoteProjectRef | null>(null);
  const activeRemoteRef = activeProjectTab?.remote ?? recoveredRemoteRef;
  const activeProjectIsRemote = Boolean(
    activeRemoteRef ||
    activeProjectTab?.runtime === "ssh" ||
    isRemoteProjectLocalPath(activeProjectTab?.path),
  );
  const effectiveRemoteStatus = activeProjectIsRemote ? (liveRemoteStatus ?? remoteStatus) : null;
  const activeSshRuntimeKind =
    activeRemoteRef?.sshRuntimeKind ??
    (effectiveRemoteStatus?.enabled ? "ssh-command" : "remote-agent-child");
  const displayRemoteStatus = effectiveRemoteStatus?.status;
  const displayRemoteDisconnected =
    displayRemoteStatus === "disconnected" || displayRemoteStatus === "error";
  const displayRemoteConnecting = displayRemoteStatus === "connecting";
  const displayRemoteEnabled = Boolean(
    activeRemoteRef ?? effectiveRemoteStatus?.enabled ?? activeProjectTab?.runtime === "ssh",
  );
  const displayRemoteHost = activeRemoteRef?.host ?? effectiveRemoteStatus?.host;
  const displayRemotePath =
    activeRemoteRef?.remotePath ?? effectiveRemoteStatus?.remoteCwd ?? activeProjectTab?.path;

  const permissionPresets = [
    {
      id: "normal" as const,
      label: t("permissionPresetAsk"),
      access: t("permissionAccessWorkspace"),
      approval: t("permissionApprovalOnRequest"),
      description: t("permissionPresetAskDesc"),
      icon: ShieldCheck,
      tone: "success",
      disabled: false,
    },
    {
      id: "autopilot" as const,
      label: t("permissionPresetAutopilot"),
      access: t("permissionAccessWorkspace"),
      approval: t("permissionApprovalAutopilot"),
      description: t("permissionPresetAutopilotDesc"),
      icon: Zap,
      tone: "info",
      disabled: false,
    },
    {
      id: "yolo" as const,
      label: t("permissionPresetFull"),
      access: t("permissionAccessFull"),
      approval: t("permissionApprovalNever"),
      description: t("permissionPresetFullDesc"),
      icon: Zap,
      tone: "warning",
      disabled: false,
    },
    {
      id: "readonly" as const,
      label: t("permissionPresetReadonly"),
      access: t("permissionAccessReadonly"),
      approval: t("permissionApprovalNever"),
      description: t("permissionPresetReadonlyDesc"),
      icon: ShieldCheck,
      tone: "success",
      disabled: false,
    },
  ];
  const activePermissionPreset =
    permissionPresets.find((preset) => preset.id === permissionProfile) ?? permissionPresets[0];
  const projectTrusted = projectTrust?.trusted === true;
  const executionSandboxMode = executionSandbox?.mode ?? "off";

  useEffect(() => {
    if (activeProjectTab?.path) {
      refreshExecutionSandbox(activeProjectTab.path);
    }
  }, [activeProjectTab?.path, refreshExecutionSandbox]);

  useEffect(() => {
    let cancelled = false;
    if (!activeSessionId || !activeProjectIsRemote) {
      setRemoteStatus(null);
      if (activeSessionId) {
        setRemoteRuntimeStatus(activeSessionId, null);
      }
      return;
    }
    const recheckRemoteConnection = async () => {
      if (!activeRemoteRef?.host || !activeRemoteRef?.remotePath) return false;
      const refreshed = await apiClient.call("agent.remoteSshTestConnection", {
        sessionId: activeSessionId,
        host: activeRemoteRef.host,
        remoteCwd: activeRemoteRef.remotePath,
      });
      if (cancelled) return true;
      setRemoteStatus(refreshed.status);
      setRemoteRuntimeStatus(activeSessionId, refreshed.status);
      return true;
    };
    apiClient
      .call("agent.remoteSshGetStatus", { sessionId: activeSessionId })
      .then(async (status) => {
        if (cancelled) return;
        setRemoteStatus(status);
        setRemoteRuntimeStatus(activeSessionId, status);

        if (
          (status?.status === "disconnected" || status?.status === "error") &&
          activeRemoteRef?.host &&
          activeRemoteRef?.remotePath
        ) {
          await recheckRemoteConnection();
        }
      })
      .catch(async () => {
        if (cancelled) return;
        if (await recheckRemoteConnection()) return;
        setRemoteStatus(null);
        setRemoteRuntimeStatus(activeSessionId, null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProjectIsRemote, activeRemoteRef, activeSessionId, setRemoteRuntimeStatus]);

  useEffect(() => {
    let cancelled = false;
    setRecoveredRemoteRef(null);

    if (!activeProjectTab?.path || activeProjectTab.remote) {
      return () => {
        cancelled = true;
      };
    }

    apiClient
      .call("project.listRecent", {})
      .then((result) => {
        if (cancelled) return;
        const recovered =
          result.projects.find((project) => project.path === activeProjectTab.path)?.remote ?? null;
        setRecoveredRemoteRef(recovered);
      })
      .catch(() => {
        if (!cancelled) setRecoveredRemoteRef(null);
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectTab?.path, activeProjectTab?.remote]);

  const BASE_SECTIONS: { id: StatusSection; label: string; icon: React.ElementType }[] = [
    { id: "permission", label: t("permissionMode"), icon: ShieldCheck },
    {
      id: "remote",
      label: t("remoteRuntime"),
      icon: activeSshRuntimeKind === "ssh-command" ? Cable : CloudCog,
    },
    { id: "plan", label: t("planMode"), icon: ClipboardList },
    { id: "shell", label: t("shell"), icon: Terminal },
    { id: "mcp", label: t("mcpTools"), icon: Plug },
    { id: "lsp", label: t("lsp"), icon: Network },
    { id: "plugins", label: t("plugins"), icon: Puzzle },
    { id: "skills", label: t("skills"), icon: BookOpen },
    { id: "issue-monitor", label: "Issue Monitor", icon: Radar },
  ];
  const SECTIONS = BASE_SECTIONS.filter(
    (section) => section.id !== "remote" || activeProjectIsRemote,
  );

  const [refreshing, setRefreshing] = useState(false);

  const handleRefresh = useCallback(() => {
    if (!activeSessionId || refreshing) return;
    setRefreshing(true);
    useSessionStore.getState().refreshSessionResources(activeSessionId);
    setTimeout(() => setRefreshing(false), 1500);
  }, [activeSessionId, refreshing]);

  return (
    <>
      <div className="px-1.5 py-1.5 space-y-1">
        <div className="flex items-center justify-between px-2 py-1">
          <span className="text-[10px] font-medium text-text-tertiary uppercase tracking-wider">
            {t("status")}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing || !activeSessionId}
            className="p-1 rounded-md hover:bg-surface-hover/60 transition-colors disabled:opacity-30"
            title={t("refreshResources")}
          >
            <RotateCw
              className={`w-3 h-3 text-text-tertiary ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
        </div>
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const collapsed = collapsedSections.has(id);
          return (
            <div key={id} className="rounded-md overflow-hidden">
              <button
                onClick={() => toggleSection(id)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover/60 transition-colors rounded-md"
              >
                {collapsed ? (
                  <ChevronRight className="w-3 h-3 shrink-0" />
                ) : (
                  <ChevronDown className="w-3 h-3 shrink-0" />
                )}
                <Icon className="w-3 h-3 shrink-0" />
                <span>{label}</span>
              </button>
              {!collapsed && (
                <div className="px-2.5 pb-2 text-[10px] text-text-tertiary">
                  {id === "permission" && (
                    <div className="space-y-2 pt-0.5">
                      <div className="grid grid-cols-2 gap-1">
                        {permissionPresets.map((preset) => {
                          const active = permissionProfile === preset.id;
                          const Icon = preset.icon;
                          return (
                            <button
                              key={preset.id}
                              onClick={() => setPermissionProfile(preset.id, activeSessionId)}
                              disabled={permissionProfileLoading || active || preset.disabled}
                              title={preset.description}
                              className={`min-h-8 px-2 py-1.5 rounded-md text-[10px] transition-colors flex items-center justify-center gap-1 ${
                                active
                                  ? preset.tone === "warning"
                                    ? "bg-status-warning/25 text-status-warning"
                                    : "bg-status-success/20 text-status-success"
                                  : preset.disabled
                                    ? "text-text-tertiary/50 bg-surface-hover/20 cursor-not-allowed"
                                    : "text-text-tertiary hover:text-text-secondary hover:bg-surface-hover"
                              } ${permissionProfileLoading ? "opacity-60 cursor-wait" : ""}`}
                            >
                              <Icon className="h-3 w-3 shrink-0" />
                              <span>{preset.label}</span>
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-start gap-1.5 text-[10px] leading-4 text-text-tertiary">
                        {activePermissionPreset.id === "yolo" ? (
                          <Zap className="mt-0.5 h-3 w-3 shrink-0 text-status-warning" />
                        ) : (
                          <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-status-success" />
                        )}
                        <div>
                          <div className="text-text-secondary">
                            {t("permissionCurrentStrategy", {
                              access: activePermissionPreset.access,
                              approval: activePermissionPreset.approval,
                            })}
                          </div>
                          <div>{activePermissionPreset.description}</div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setShowPermissionAdvanced((value) => !value)}
                        className="text-[10px] text-accent hover:text-accent-hover transition-colors"
                      >
                        {showPermissionAdvanced
                          ? t("permissionAdvancedHide")
                          : t("permissionAdvancedShow")}
                      </button>
                      {showPermissionAdvanced && (
                        <div className="space-y-1 rounded-md border border-border-secondary/60 bg-surface-hover/25 p-2">
                          <div className="grid grid-cols-[4.5rem_1fr] gap-x-2 gap-y-1">
                            <span className="text-text-tertiary">{t("permissionAccessAxis")}</span>
                            <span className="text-text-secondary">
                              {activePermissionPreset.access}
                            </span>
                            <span className="text-text-tertiary">
                              {t("permissionApprovalAxis")}
                            </span>
                            <span className="text-text-secondary">
                              {activePermissionPreset.approval}
                            </span>
                            <span className="text-text-tertiary">{t("permissionScopeAxis")}</span>
                            <span className="text-text-secondary">
                              {projectTrusted
                                ? t("permissionScopeProject")
                                : t("permissionScopeSession")}
                            </span>
                            <span className="text-text-tertiary">{t("permissionTrustAxis")}</span>
                            <span className="flex items-center gap-1 text-text-secondary">
                              {projectTrusted ? (
                                <ShieldCheck className="h-3 w-3 text-status-success" />
                              ) : (
                                <AlertTriangle className="h-3 w-3 text-status-warning" />
                              )}
                              {projectTrusted
                                ? t("permissionTrustTrusted")
                                : t("permissionTrustUntrusted")}
                            </span>
                            <span className="text-text-tertiary">{t("executionSandboxAxis")}</span>
                            <span className="flex items-center gap-1 text-text-secondary">
                              {executionSandboxMode === "filesystem" ? (
                                <ShieldCheck className="h-3 w-3 text-status-success" />
                              ) : (
                                <AlertTriangle className="h-3 w-3 text-text-tertiary" />
                              )}
                              {executionSandboxMode === "filesystem"
                                ? t("executionSandboxFilesystem")
                                : t("executionSandboxOff")}
                            </span>
                          </div>
                          <div className="pt-1 text-[10px] leading-4 text-text-tertiary">
                            {projectTrusted
                              ? t("permissionTrustHintProject")
                              : t("permissionTrustHintSession")}
                          </div>
                          <div className="flex items-center justify-between gap-2 rounded-md border border-border-secondary/50 bg-bg-primary/35 px-2 py-1.5">
                            <div className="min-w-0">
                              <div className="text-[10px] font-medium text-text-secondary">
                                {t("executionSandboxTitle")}
                              </div>
                              <div className="truncate text-[9px] text-text-tertiary">
                                {t("executionSandboxHint")}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setExecutionSandboxMode(
                                  executionSandboxMode === "filesystem" ? "off" : "filesystem",
                                  {
                                    sessionId: activeSessionId ?? undefined,
                                    projectPath: activeProjectTab?.path,
                                    sessionPath: activeSessionMeta?.sessionPath,
                                  },
                                )
                              }
                              disabled={executionSandboxLoading || !activeProjectTab}
                              className={`shrink-0 rounded-md px-2 py-1 text-[10px] font-medium transition-colors disabled:cursor-wait disabled:opacity-60 ${
                                executionSandboxMode === "filesystem"
                                  ? "bg-status-success/20 text-status-success hover:bg-status-success/25"
                                  : "bg-surface-hover/60 text-text-tertiary hover:text-text-secondary"
                              }`}
                              title={executionSandbox?.configPath}
                            >
                              {executionSandboxLoading
                                ? t("executionSandboxApplying")
                                : executionSandboxMode === "filesystem"
                                  ? t("executionSandboxOn")
                                  : t("executionSandboxEnable")}
                            </button>
                          </div>
                          {!projectTrusted && activeSessionId && activeProjectTab && (
                            <button
                              type="button"
                              onClick={() =>
                                trustCurrentProject(
                                  activeSessionId,
                                  activeProjectTab.path,
                                  activeSessionMeta?.sessionPath,
                                )
                              }
                              disabled={projectTrustLoading}
                              className="mt-1 inline-flex min-h-7 items-center gap-1 rounded-md border border-status-warning/35 bg-status-warning/10 px-2 py-1 text-[10px] font-medium text-status-warning hover:bg-status-warning/15 disabled:cursor-wait disabled:opacity-60"
                              title={activeProjectTab.path}
                            >
                              <ShieldCheck className="h-3 w-3" />
                              {projectTrustLoading
                                ? t("permissionTrusting")
                                : t("permissionTrustAction")}
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                  {id === "remote" && (
                    <div className="space-y-2 pt-0.5">
                      <div className="flex items-start gap-1.5 text-[10px] leading-4 text-text-tertiary">
                        <span
                          className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${
                            displayRemoteDisconnected
                              ? "bg-status-error"
                              : displayRemoteConnecting
                                ? "bg-status-warning animate-pulse"
                                : displayRemoteEnabled
                                  ? "bg-status-success"
                                  : "bg-text-tertiary"
                          }`}
                        />
                        <div>
                          <div className="text-text-secondary">
                            {displayRemoteDisconnected
                              ? t(
                                  displayRemoteStatus === "error"
                                    ? "remoteStatusError"
                                    : "remoteStatusDisconnected",
                                )
                              : displayRemoteConnecting
                                ? t("remoteStatusConnecting")
                                : displayRemoteEnabled
                                  ? t("remoteStatusConnected", {
                                      host: displayRemoteHost ?? "",
                                    })
                                  : t("remoteStatusLocal")}
                          </div>
                          <div>
                            {activeRemoteRef
                              ? activeSshRuntimeKind === "ssh-command"
                                ? t("remoteRuntimeHintQuick")
                                : t("remoteRuntimeHintStandard")
                              : t("remoteRuntimeHint")}
                          </div>
                        </div>
                      </div>
                      <div className="space-y-1 rounded-md border border-border-secondary/60 bg-surface-hover/25 p-2 text-[10px] leading-4">
                        {displayRemoteEnabled ? (
                          <>
                            <div className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-2 gap-y-1">
                              <span className="text-text-tertiary">{t("remoteModeLabel")}</span>
                              <span className="truncate text-text-secondary">
                                {activeSshRuntimeKind === "ssh-command"
                                  ? t("remoteModeQuick")
                                  : t("remoteModeStandard")}
                              </span>
                              <span className="text-text-tertiary">{t("remoteHostLabel")}</span>
                              <span className="truncate text-text-secondary">
                                {displayRemoteHost ?? t("notLoaded")}
                              </span>
                              <span className="text-text-tertiary">{t("remotePathLabel")}</span>
                              <span className="truncate font-mono text-text-secondary">
                                {displayRemotePath ?? t("notLoaded")}
                              </span>
                              {displayRemoteDisconnected && effectiveRemoteStatus?.error && (
                                <>
                                  <span className="text-text-tertiary">{t("errorLabel")}</span>
                                  <span className="truncate text-status-error">
                                    {effectiveRemoteStatus.error}
                                  </span>
                                </>
                              )}
                            </div>
                          </>
                        ) : (
                          <div className="text-text-tertiary">
                            {t("remoteConfigureFromProject")}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                  {id === "plan" && (
                    <div className="space-y-1">
                      {todos && todos.length > 0 && (
                        <div className="space-y-0.5 pt-0.5">
                          {todos.map((todo) => (
                            <div
                              key={todo.id}
                              className={`flex items-center gap-1.5 py-0.5 px-1 rounded bg-surface-hover/25 hover:bg-surface-hover/60 transition-colors${todo.deleted ? " opacity-40" : ""}`}
                            >
                              {todo.deleted ? (
                                <Trash2 className="w-3 h-3 shrink-0 text-status-error" />
                              ) : todo.done ? (
                                <CheckCircle2 className="w-3 h-3 shrink-0 text-status-success" />
                              ) : (
                                <Circle className="w-3 h-3 shrink-0 text-text-tertiary" />
                              )}
                              {todo.priority && !todo.deleted && (
                                <span
                                  className={`w-3 h-3 shrink-0 rounded-full flex items-center justify-center text-[7px] font-bold text-white ${PRIORITY_STYLES[todo.priority].dot}`}
                                >
                                  {PRIORITY_STYLES[todo.priority].label}
                                </span>
                              )}
                              <span
                                className={`${todo.deleted ? "text-status-error/60 line-through" : todo.done ? "text-text-tertiary line-through" : "text-text-secondary"} truncate`}
                              >
                                {todo.text}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                  {id === "shell" &&
                    (hasProcesses ? (
                      <div className="space-y-1.5 pt-0.5">
                        {backgroundProcesses.map((p) => (
                          <BashProcessCard
                            key={p.toolCallId}
                            process={p}
                            onOpenLog={() =>
                              setLogViewer({ logPath: p.logPath ?? "", toolCallId: p.toolCallId })
                            }
                          />
                        ))}
                      </div>
                    ) : (
                      <span>{t("idle")}</span>
                    ))}
                  {id === "mcp" && <MCPToolsSection />}
                  {id === "issue-monitor" && <IssueMonitorSection />}
                  {id === "lsp" && (
                    <div className="space-y-1">
                      {!lspData || lspData.startupComplete ? (
                        <div>
                          <div className="flex items-center gap-1">
                            <span
                              className={`w-1.5 h-1.5 rounded-full ${lspData?.state === "ready" ? "bg-status-success" : lspData?.state === "error" ? "bg-status-error" : lspData?.state === "starting" ? "bg-status-warning animate-pulse" : "bg-text-secondary"}`}
                            />
                            <span>
                              {!lspData
                                ? t("lspInactive")
                                : lspData.state === "ready"
                                  ? t("lspConnected", {
                                      count: lspData.servers.length,
                                      plural: lspData.servers.length !== 1 ? "s" : "",
                                    })
                                  : lspData.state === "error"
                                    ? t("lspError")
                                    : lspData.state === "starting"
                                      ? t("lspStarting")
                                      : lspData.state}
                            </span>
                          </div>
                          {lspData?.activeLanguages && lspData.activeLanguages.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1">
                              {lspData.activeLanguages.map((lang) => (
                                <span
                                  key={lang}
                                  className="px-1 py-px rounded text-[9px] bg-semantic-tool/15 text-semantic-tool"
                                >
                                  {lang}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-1 text-[10px] text-text-tertiary">
                          <span className="animate-pulse">
                            {t("lspStartingServers", {
                              count: lspData.totalServers ?? lspData.startupLog.length,
                            })}
                          </span>
                        </div>
                      )}
                      {lspData?.startupLog &&
                        lspData.startupLog.length > 0 &&
                        lspData.state === "starting" && (
                          <div className="space-y-0.5 pl-1 pt-0.5">
                            {lspData.startupLog.map((log, i) => (
                              <div key={`${log.name}-${i}`} className="flex items-center gap-1">
                                <span
                                  className={`w-1 h-1 rounded-full ${log.state === "ready" ? "bg-status-success" : log.state === "error" ? "bg-status-error" : "bg-status-warning animate-pulse"}`}
                                />
                                <span
                                  className={`truncate ${log.state === "error" ? "text-status-error/80" : log.state === "ready" ? "text-status-success/80" : "text-text-tertiary"}`}
                                >
                                  {log.name}
                                  {log.fileTypes && log.fileTypes.length > 0 ? (
                                    <span className="text-text-secondary">
                                      {" "}
                                      ({log.fileTypes.join(",")})
                                    </span>
                                  ) : null}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      {lspData && lspData.servers.length > 0 && !lspData.startupLog?.length && (
                        <div className="space-y-0.5 pl-1">
                          {lspData.servers.map((srv, i) => (
                            <div key={`${srv.name}-${i}`} className="flex items-center gap-1">
                              <span
                                className={`w-1 h-1 rounded-full ${srv.state === "ready" ? "bg-status-success" : srv.state === "error" ? "bg-status-error" : srv.state === "starting" ? "bg-status-warning" : "bg-text-secondary"}`}
                              />
                              <span className={`truncate text-text-tertiary`}>
                                {srv.name}
                                {srv.fileTypes && srv.fileTypes.length > 0 ? (
                                  <span className="text-text-secondary">
                                    {" "}
                                    ({srv.fileTypes.join(",")})
                                  </span>
                                ) : null}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex gap-1 pt-0.5">
                        {(["agent_end", "edit_write", "disabled"] as LspDiagnosticsMode[]).map(
                          (m) => (
                            <button
                              key={m}
                              onClick={() => {
                                if (activeSessionId && !activeSubId)
                                  useLspStore.getState().setMode(activeSessionId, m);
                              }}
                              className={`px-1.5 py-0.5 rounded text-[9px] ${lspData?.mode === m ? "bg-status-info/30 text-status-info" : "bg-surface-hover/30 text-text-tertiary hover:bg-surface-hover/60"}`}
                            >
                              {m === "agent_end"
                                ? t("lspOnEnd")
                                : m === "edit_write"
                                  ? t("lspOnWrite")
                                  : t("lspOff")}
                            </button>
                          ),
                        )}
                      </div>
                      {lspData?.lastDiagnostics && (
                        <div className="flex items-center gap-1 text-[9px] pt-0.5">
                          <AlertTriangle
                            className={`w-2.5 h-2.5 ${lspData.lastDiagnostics.count > 0 ? "text-status-warning" : "text-status-success"}`}
                          />
                          <span className="truncate" title={lspData.lastDiagnostics.filePath}>
                            {formatFilePath(lspData.lastDiagnostics.filePath)}:{" "}
                            {t("issues", {
                              count: lspData.lastDiagnostics.count,
                              plural: lspData.lastDiagnostics.count !== 1 ? "s" : "",
                            })}
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  {id === "plugins" && (
                    <div className="space-y-0.5">
                      {plugins.length === 0 ? (
                        <span>{t("noPlugins")}</span>
                      ) : (
                        plugins.map((p) => {
                          const isExpanded = expandedPlugin === p.path;
                          return (
                            <div key={p.path}>
                              <div
                                className="flex items-center gap-1 py-0.5 px-1 rounded bg-surface-hover/25 hover:bg-surface-hover/60 transition-colors cursor-pointer group"
                                onClick={() => togglePluginExpanded(p.path)}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${p.enabled ? "bg-status-success" : "bg-text-tertiary dark:bg-text-secondary"}`}
                                />
                                <span className={`shrink-0 ${isExpanded ? "" : ""}`}>
                                  {isExpanded ? (
                                    <ChevronDown className="w-3 h-3 text-text-tertiary" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-text-tertiary" />
                                  )}
                                </span>
                                <span className="truncate flex-1 text-text-secondary">
                                  {p.name}
                                </span>
                                {p.toolNames.length > 0 && (
                                  <span className="text-text-tertiary">
                                    {t("pluginTools", { count: p.toolNames.length })}
                                  </span>
                                )}
                                {p.commandNames.length > 0 && (
                                  <span className="text-text-tertiary">
                                    {t("pluginCommands", { count: p.commandNames.length })}
                                  </span>
                                )}
                                {p.channelNames.length > 0 && (
                                  <span className="text-text-tertiary">
                                    {t("pluginChannels", { count: p.channelNames.length })}
                                  </span>
                                )}
                                {p.eventNames.length > 0 && (
                                  <span className="text-text-tertiary">
                                    {t("pluginEvents", { count: p.eventNames.length })}
                                  </span>
                                )}
                                {p.permissionProviderNames.length > 0 && (
                                  <span className="text-text-tertiary">
                                    {t("pluginPermissionProviders", { count: p.permissionProviderNames.length })}
                                  </span>
                                )}
                                {p.usageNotice && (
                                  <span
                                    className="text-[9px] px-1 py-px rounded shrink-0 max-w-[72px] truncate bg-status-info/15 text-status-info"
                                    title={p.usageNotice.message}
                                  >
                                    {p.usageNotice.label}
                                  </span>
                                )}
                                <span
                                  className={`text-[9px] px-1 py-px rounded shrink-0 max-w-[36px] truncate ${p.scope === "global" ? "bg-semantic-agent/15 text-semantic-agent" : "bg-status-info/15 text-status-info"}`}
                                >
                                  {p.scope === "global" ? t("global") : t("project")}
                                </span>
                                {activeSessionId &&
                                  (() => {
                                    const projectPath =
                                      Object.values(sessionsByProject)
                                        .flat()
                                        .find((s) => s.sessionId === activeSessionId)
                                        ?.projectPath ?? activeProjectTab?.path;
                                    return projectPath ? (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          togglePluginEnabled(activeSessionId, projectPath, p.path);
                                        }}
                                        className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-surface-hover/60 rounded transition-opacity"
                                        title={p.enabled ? t("disablePlugin") : t("enablePlugin")}
                                      >
                                        {p.enabled ? (
                                          <EyeOff className="w-3 h-3 text-text-tertiary" />
                                        ) : (
                                          <Eye className="w-3 h-3 text-text-tertiary" />
                                        )}
                                      </button>
                                    ) : null;
                                  })()}
                              </div>
                              {isExpanded && (
                                <div className="ml-4 pl-2 border-l border-border-primary/70 space-y-1 pt-1 text-[10px]">
                                  <div className="text-text-tertiary break-all">
                                    <span className="text-text-tertiary">{t("pathLabel")}</span>{" "}
                                    {p.path}
                                  </div>
                                  {p.usageNotice && (
                                    <div className="rounded border border-status-info/25 bg-status-info/10 px-2 py-1 text-status-info">
                                      <div className="font-medium">{p.usageNotice.label}</div>
                                      <div className="text-text-secondary">
                                        {p.usageNotice.message}
                                      </div>
                                    </div>
                                  )}
                                  {p.toolNames.length > 0 && (
                                    <div>
                                      <span className="text-text-tertiary block mb-0.5">
                                        {t("toolsLabel")}
                                      </span>
                                      <div className="space-y-px">
                                        {p.toolNames.map((tn) => (
                                          <div
                                            key={tn}
                                            className="text-text-tertiary pl-2 font-mono truncate"
                                          >
                                            {tn}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {p.commandNames.length > 0 && (
                                    <div>
                                      <span className="text-text-tertiary block mb-0.5">
                                        {t("commandsLabel")}
                                      </span>
                                      <div className="space-y-px">
                                        {p.commandNames.map((cn) => (
                                          <div
                                            key={cn}
                                            className="text-text-tertiary pl-2 font-mono truncate"
                                          >
                                            {cn}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {p.channelNames.length > 0 && (
                                    <div>
                                      <span className="text-text-tertiary block mb-0.5">
                                        {t("channelsLabel")}
                                      </span>
                                      <div className="space-y-px">
                                        {p.channelNames.map((cn) => (
                                          <div
                                            key={cn}
                                            className="text-text-tertiary pl-2 font-mono truncate"
                                          >
                                            {cn}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {p.eventNames.length > 0 && (
                                    <div>
                                      <span className="text-text-tertiary block mb-0.5">
                                        {t("eventsLabel")}
                                      </span>
                                      <div className="space-y-px">
                                        {p.eventNames.map((en) => (
                                          <div
                                            key={en}
                                            className="text-text-tertiary pl-2 font-mono truncate"
                                          >
                                            {en}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {p.permissionProviderNames.length > 0 && (
                                    <div>
                                      <span className="text-text-tertiary block mb-0.5">
                                        {t("permissionProvidersLabel")}
                                      </span>
                                      <div className="space-y-px">
                                        {p.permissionProviderNames.map((pn) => (
                                          <div
                                            key={pn}
                                            className="text-text-tertiary pl-2 font-mono truncate"
                                          >
                                            {pn}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {p.toolNames.length === 0 &&
                                    p.commandNames.length === 0 &&
                                    p.channelNames.length === 0 &&
                                    p.eventNames.length === 0 &&
                                    p.permissionProviderNames.length === 0 && (
                                      <div className="text-text-tertiary">
                                        {t("noToolsOrCommands")}
                                      </div>
                                    )}
                                  <PluginCopyButton plugin={p} />
                                  {!p.enabled && (
                                    <div className="text-status-warning/70">
                                      {t("pluginDisabled")}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                  {id === "skills" && (
                    <div className="space-y-0.5">
                      {skills.length === 0 ? (
                        <span>{t("noSkills")}</span>
                      ) : (
                        skills.map((sk) => {
                          const isExpanded = expandedSkill === sk.name;
                          return (
                            <div key={sk.filePath}>
                              <div
                                className="flex items-center gap-1 py-0.5 px-1 rounded bg-surface-hover/25 hover:bg-surface-hover/60 transition-colors cursor-pointer group"
                                onClick={() => toggleSkillExpanded(sk.name)}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${sk.enabled ? "bg-status-success" : "bg-text-tertiary dark:bg-text-secondary"}`}
                                />
                                <span className="truncate flex-1 text-text-secondary">
                                  {sk.name}
                                </span>
                                <span
                                  className={`text-[9px] px-1 py-px rounded max-w-[36px] truncate ${sk.scope === "global" ? "bg-semantic-agent/15 text-semantic-agent" : "bg-status-info/15 text-status-info"}`}
                                >
                                  {sk.scope === "global" ? t("global") : t("project")}
                                </span>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleSkillEnabled(sk.name);
                                  }}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-surface-hover/60 rounded transition-opacity"
                                  title={sk.enabled ? t("disableSkill") : t("enableSkill")}
                                >
                                  {sk.enabled ? (
                                    <EyeOff className="w-3 h-3 text-text-tertiary" />
                                  ) : (
                                    <Eye className="w-3 h-3 text-text-tertiary" />
                                  )}
                                </button>
                              </div>
                              {isExpanded && (
                                <div className="ml-4 pl-2 border-l border-border-primary/70 space-y-1 pt-1 text-[10px]">
                                  <div className="text-text-tertiary break-all">
                                    {sk.description || t("noDescription")}
                                  </div>
                                  <div className="space-y-0.5 text-text-tertiary">
                                    <div className="truncate" title={sk.filePath}>
                                      <span className="text-text-tertiary">{t("fileLabel")}</span>{" "}
                                      {formatFilePath(sk.filePath)}
                                    </div>
                                    <div>
                                      <span className="text-text-tertiary">{t("pathLabel")}</span>
                                      <span className="break-all">{sk.filePath}</span>
                                    </div>
                                    {sk.disableModelInvocation && (
                                      <div className="text-status-warning/70">
                                        {t("disableModelInvocation")}
                                      </div>
                                    )}
                                    {!sk.enabled && (
                                      <div className="text-status-error/70">
                                        {t("skillDisabled")}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {logViewer && (
        <LogViewer
          logPath={logViewer.logPath}
          toolCallId={logViewer.toolCallId}
          sessionId={activeSessionId}
          onClose={() => setLogViewer(null)}
        />
      )}
    </>
  );
}

const EMPTY_MCP_SERVERS: MCPServerInfo[] = [];

function MCPToolsSection() {
  const { t } = useTranslation("status");
  const activeSessionId = useEffectiveSessionId();
  // useShallow keeps the selector result referentially stable across renders
  // when the slot is undefined (would otherwise return a fresh [] each time
  // and trigger an infinite re-render loop in zustand's snapshot check).
  const mcpServers = useStatusStore(
    useShallow((s) =>
      activeSessionId ? (s.mcpServersBySession[activeSessionId] ?? EMPTY_MCP_SERVERS) : EMPTY_MCP_SERVERS,
    ),
  );
  const expandedMcpServer = useStatusStore((s) => s.expandedMcpServer);
  const toggleMcpExpanded = useStatusStore((s) => s.toggleMcpExpanded);
  const toggleMcpServer = useStatusStore((s) => s.toggleMcpServer);
  const restartMcpServer = useStatusStore((s) => s.restartMcpServer);
  const [restarting, setRestarting] = useState<string | null>(null);

  if (mcpServers.length === 0) {
    return (
      <div className="space-y-0.5">
        <span>{t("notConnected")}</span>
      </div>
    );
  }

  return (
    <div className="space-y-0.5">
      {mcpServers.map((srv) => {
        const isExpanded = expandedMcpServer === srv.name;
        const isDisabled = srv.disabled === true;
        const statusDot = isDisabled
          ? "bg-text-tertiary dark:bg-text-secondary"
          : srv.status === "connected"
            ? "bg-status-success"
            : srv.status === "error"
              ? "bg-status-error"
              : srv.status === "connecting"
                ? "bg-status-warning animate-pulse"
                : "bg-text-tertiary dark:bg-text-secondary";
        return (
          <div key={srv.name} className={isDisabled ? "opacity-50" : ""}>
            <div
              className="flex items-center gap-1 py-0.5 px-1 rounded bg-surface-hover/25 hover:bg-surface-hover/60 transition-colors cursor-pointer group"
              onClick={() => toggleMcpExpanded(srv.name)}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
              <span className="shrink-0">
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-text-tertiary" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-text-tertiary" />
                )}
              </span>
              <span className="truncate flex-1 text-text-secondary">{srv.name}</span>
              {srv.toolCount > 0 && (
                <span className="text-text-tertiary">
                  {t("mcpToolCount", { count: srv.toolCount })}
                </span>
              )}
              <span
                className={`text-[9px] px-1 py-px rounded shrink-0 max-w-[36px] truncate ${srv.scope === "project" ? "bg-semantic-tool/15 text-semantic-tool" : "bg-semantic-agent/15 text-semantic-agent"}`}
              >
                {srv.scope === "project" ? t("project") : t("global")}
              </span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (activeSessionId) {
                    toggleMcpServer(activeSessionId, srv.name, !!isDisabled);
                  }
                }}
                className={`w-6 h-3 rounded-full shrink-0 transition-colors relative ${isDisabled ? "bg-text-secondary" : "bg-status-success"}`}
                title={isDisabled ? t("enableMcpServer") : t("disableMcpServer")}
              >
                <span
                  className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-transform ${isDisabled ? "left-0.5" : "left-3.5"}`}
                />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (activeSessionId && !isDisabled && srv.status === "connected") {
                    setRestarting(srv.name);
                    restartMcpServer(activeSessionId, srv.name);
                    setTimeout(() => setRestarting(null), 2000);
                  }
                }}
                disabled={isDisabled || srv.status !== "connected"}
                className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity shrink-0 ${isDisabled || srv.status !== "connected" ? "text-text-secondary cursor-not-allowed" : "text-text-tertiary hover:text-text-secondary hover:bg-surface-hover/60 cursor-pointer"}`}
                title={t("restartMcpServer")}
              >
                <RotateCw className={`w-3 h-3 ${restarting === srv.name ? "animate-spin" : ""}`} />
              </button>
            </div>
            {isExpanded && (
              <div className="ml-4 pl-2 border-l border-border-primary/70 space-y-1 pt-1 text-[10px]">
                {srv.error && <div className="text-status-error/80 break-all">{srv.error}</div>}
                {srv.tools.length === 0 ? (
                  <div className="text-text-tertiary">{t("noMcpTools")}</div>
                ) : (
                  <>
                    <div>
                      <span className="text-text-tertiary block mb-0.5">{t("toolsLabel")}</span>
                      <div className="space-y-px">
                        {srv.tools.map((tool) => (
                          <div
                            key={tool.name}
                            className="text-text-tertiary pl-2 font-mono truncate"
                            title={tool.description || undefined}
                          >
                            {tool.name}
                            {tool.description && (
                              <span className="text-text-tertiary font-sans ml-1">
                                — {tool.description}
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                    <MCPCopyButton server={srv} />
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function MCPCopyButton({ server }: { server: MCPServerInfo }) {
  const { t } = useTranslation("status");
  const { copied, copy } = useClipboard(1500, { showToast: true });
  const handleCopy = useCallback(() => {
    const lines = [
      `${t("nameLabel")} ${server.name}`,
      `${t("locationLabel")} ${server.scope === "project" ? t("project") : t("global")}`,
      `${t("toolsFieldLabel", { count: server.toolCount })} ${server.tools.map((t) => t.name).join(", ") || t("none")}`,
    ];
    copy(lines.join("\n"));
  }, [server, t, copy]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-text-tertiary hover:text-text-secondary transition-colors mt-0.5"
    >
      {copied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? t("copied") : t("copyInfo")}</span>
    </button>
  );
}

// ── Issue Monitor Section ──────────────────────────────────────────────

function IssueMonitorSection() {
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const status = useIssueMonitorStore(
    (s) => (activeSessionId ? s.statusBySession[activeSessionId] : undefined),
  );
  const config = useIssueMonitorStore(
    (s) => (activeSessionId ? s.configBySession[activeSessionId] : undefined),
  );
  const configLoading = useIssueMonitorStore(
    (s) => (activeSessionId ? s.configLoadingBySession[activeSessionId] : false),
  );
  const loadConfig = useIssueMonitorStore((s) => s.loadConfig);
  const saveConfig = useIssueMonitorStore((s) => s.saveConfig);
  const [newRepo, setNewRepo] = useState("");

  // 挂载时加载配置
  useEffect(() => {
    if (!activeSessionId) return;
    loadConfig(activeSessionId);
  }, [activeSessionId, loadConfig]);

  // ── 状态显示部分 ──
  const scanAgo = status?.lastScanTime
    ? `${Math.round((Date.now() - status.lastScanTime) / 1000)}s ago`
    : "never";

  return (
    <div className="space-y-2 px-2.5 py-1.5">
      {/* 运行状态 */}
      {status ? (
        <>
          <div className="flex items-center gap-1.5">
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                status.isRunning ? "bg-status-success animate-pulse" : "bg-text-secondary"
              }`}
            />
            <span className="text-[11px] text-text-secondary">
              {status.isRunning ? "监控中" : "已停止"}
            </span>
            <span className="text-[11px] text-text-tertiary">· 上次扫描: {scanAgo}</span>
          </div>

          {status.lastScanError && (
            <div className="text-[11px] text-status-error">
              ⚠ {status.lastScanError.slice(0, 80)}
            </div>
          )}

          {status.repos.length > 0 ? (
            <div className="space-y-0.5">
              {status.repos.map((repo) => (
                <div key={repo.repo} className="flex items-center justify-between gap-1">
                  <span className="text-[11px] text-text-primary truncate">{repo.repo}</span>
                  <span className="text-[11px] text-text-tertiary shrink-0">
                    {repo.seenCount} seen / {repo.openCount} open
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-[11px] text-text-tertiary">无监控仓库</div>
          )}

          <div className="text-[11px] text-text-tertiary">
            总计: {status.totalSeen} issues 已处理
          </div>
        </>
      ) : (
        <div className="text-[11px] text-text-tertiary">Issue Monitor 未激活</div>
      )}

      {/* ── 配置部分 ── */}
      <div className="border-t border-border-secondary pt-2 space-y-2">
        <div className="text-[11px] font-medium text-text-secondary">配置</div>

        {configLoading ? (
          <div className="text-[11px] text-text-tertiary">加载配置中...</div>
        ) : !config || !activeSessionId ? (
          <div className="text-[11px] text-text-tertiary">
            无法加载配置（Agent 未运行或 extension 未安装）
          </div>
        ) : (
          <>
            {/* 监控仓库列表 */}
            <div className="space-y-0.5">
              {config.repos.map((repo, i) => (
                <div key={repo} className="flex items-center gap-1">
                  <span className="text-[11px] text-text-primary flex-1 truncate font-mono">
                    {repo}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      saveConfig(activeSessionId, {
                        repos: config.repos.filter((_, j) => j !== i),
                      })
                    }
                    className="text-[11px] text-status-error hover:underline shrink-0"
                  >
                    删除
                  </button>
                </div>
              ))}
            </div>

            {/* 添加仓库 */}
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={newRepo}
                onChange={(e) => setNewRepo(e.target.value)}
                placeholder="owner/repo"
                className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary"
              />
              <button
                type="button"
                onClick={() => {
                  const trimmed = newRepo.trim();
                  if (trimmed && !config.repos.includes(trimmed)) {
                    saveConfig(activeSessionId, { repos: [...config.repos, trimmed] });
                    setNewRepo("");
                  }
                }}
                className="px-2 py-0.5 text-[11px] rounded bg-accent text-white hover:opacity-90 shrink-0"
              >
                添加
              </button>
            </div>

            {/* 扫描间隔 */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-text-secondary shrink-0">扫描间隔</span>
              <input
                type="number"
                value={config.interval}
                onChange={(e) =>
                  saveConfig(activeSessionId, {
                    interval: parseInt(e.target.value) || 300,
                  })
                }
                min={30}
                className="w-16 px-1.5 py-0.5 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary"
              />
              <span className="text-[11px] text-text-tertiary">秒</span>
            </div>

            {/* 自动修复开关 */}
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-text-secondary">自动修复</span>
              <button
                type="button"
                onClick={() =>
                  saveConfig(activeSessionId, { autoFix: !config.autoFix })
                }
                className={`w-6 h-3 rounded-full shrink-0 transition-colors relative ${config.autoFix ? "bg-status-success" : "bg-text-secondary"}`}
                title={config.autoFix ? "关闭自动修复" : "开启自动修复"}
              >
                <span
                  className={`absolute top-0.5 w-2 h-2 rounded-full bg-white transition-transform ${config.autoFix ? "left-3.5" : "left-0.5"}`}
                />
              </button>
            </div>

            {/* 分支前缀 */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] text-text-secondary shrink-0">分支前缀</span>
              <input
                type="text"
                value={config.branchPrefix}
                onChange={(e) =>
                  saveConfig(activeSessionId, { branchPrefix: e.target.value })
                }
                className="flex-1 min-w-0 px-1.5 py-0.5 text-[11px] rounded border border-border-primary bg-bg-primary text-text-primary font-mono"
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
