import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Zap,
  ShieldCheck,
  ClipboardList,
  Terminal,
  Plug,
  Network,
  Puzzle,
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
import { formatFilePath } from "../../lib/format-path";

const PRIORITY_STYLES: Record<TodoPriority, { dot: string; label: string }> = {
  high: { dot: "bg-status-error", label: "H" },
  medium: { dot: "bg-status-warning", label: "M" },
  low: { dot: "bg-text-tertiary", label: "L" },
};

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
  const plugins = useStatusStore((s) => s.plugins);
  const skills = useStatusStore((s) => s.skills);
  const expandedSkill = useStatusStore((s) => s.expandedSkill);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const projectTabs = useSessionStore((s) => s.projectTabs);
  const activeProjectId = useSessionStore((s) => s.activeProjectId);
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
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
  const toggleSkillExpanded = useStatusStore((s) => s.toggleSkillExpanded);
  const toggleSkillEnabled = useStatusStore((s) => s.toggleSkillEnabled);
  const expandedPlugin = useStatusStore((s) => s.expandedPlugin);
  const togglePluginExpanded = useStatusStore((s) => s.togglePluginExpanded);
  const togglePluginEnabled = useStatusStore((s) => s.togglePluginEnabled);
  const sessionsByProject = useSessionStore((s) => s.sessionsByProject);
  const safeProjectTabs = projectTabs ?? [];
  const safeSessionsByProject = sessionsByProject ?? {};
  const activeProjectTab = safeProjectTabs.find((tab) => tab.id === activeProjectId) ?? null;
  const activeSessionMeta =
    activeProjectTab && activeSessionId
      ? safeSessionsByProject[activeProjectTab.path]?.find((s) => s.sessionId === activeSessionId)
      : null;
  const backgroundProcesses = allProcesses?.filter((p) => backgroundedIds.has(p.toolCallId)) ?? [];
  const hasProcesses = backgroundProcesses.length > 0;
  const [showPermissionAdvanced, setShowPermissionAdvanced] = useState(false);

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

  const SECTIONS: { id: StatusSection; label: string; icon: React.ElementType }[] = [
    { id: "permission", label: t("permissionMode"), icon: ShieldCheck },
    { id: "plan", label: t("planMode"), icon: ClipboardList },
    { id: "shell", label: t("shell"), icon: Terminal },
    { id: "mcp", label: t("mcpTools"), icon: Plug },
    { id: "lsp", label: t("lsp"), icon: Network },
    { id: "plugins", label: t("plugins"), icon: Puzzle },
    { id: "skills", label: t("skills"), icon: BookOpen },
  ];

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
                              onClick={() => setPermissionProfile(preset.id)}
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
                          </div>
                          <div className="pt-1 text-[10px] leading-4 text-text-tertiary">
                            {projectTrusted
                              ? t("permissionTrustHintProject")
                              : t("permissionTrustHintSession")}
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
                                    const projectPath = Object.values(sessionsByProject)
                                      .flat()
                                      .find((s) => s.sessionId === activeSessionId)?.projectPath;
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
                                  {p.toolNames.length === 0 && p.commandNames.length === 0 && (
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
          onClose={() => setLogViewer(null)}
        />
      )}
    </>
  );
}

function MCPToolsSection() {
  const { t } = useTranslation("status");
  const mcpServers = useStatusStore((s) => s.mcpServers);
  const expandedMcpServer = useStatusStore((s) => s.expandedMcpServer);
  const toggleMcpExpanded = useStatusStore((s) => s.toggleMcpExpanded);
  const toggleMcpServer = useStatusStore((s) => s.toggleMcpServer);
  const restartMcpServer = useStatusStore((s) => s.restartMcpServer);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
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
