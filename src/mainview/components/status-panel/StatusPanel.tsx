import { useState, useCallback } from "react";
import {
  ChevronDown,
  ChevronRight,
  Zap,
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
  Shield,
  Play,
  Pause,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { useTranslation } from "react-i18next";
import { useStatusStore, type MCPServerInfo } from "../../stores/use-status-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useLspStore } from "../../stores/use-lsp-store";
import { useBashStore } from "../../stores/use-bash-store";
import { useSupervisorStore } from "../../stores/use-supervisor-store";
import { BashProcessCard, LogViewer } from "../bash-panel/BashPanel";
import type { LspDiagnosticsMode } from "../../../shared/modules/lsp";
import type { StatusSection } from "../../stores/use-status-store";
import type { TodoPriority } from "../../stores/use-session-store";
import { copyToClipboard } from "../../utils/clipboard";
import type { PluginInfo } from "../../stores/use-status-store";

const PRIORITY_STYLES: Record<TodoPriority, { dot: string; label: string }> = {
  high: { dot: "bg-status-error", label: "H" },
  medium: { dot: "bg-status-warning", label: "M" },
  low: { dot: "bg-gray-500", label: "L" },
};

function PluginCopyButton({ plugin }: { plugin: PluginInfo }) {
  const { t } = useTranslation("status");
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const scopeLabel = plugin.scope === "global" ? t("global") : t("project");
    const lines = [
      `${t("nameLabel")} ${plugin.name}`,
      `${t("locationLabel")} ${scopeLabel}`,
      `${t("pathFieldLabel")} ${plugin.path}`,
      `${t("toolsFieldLabel", { count: plugin.toolNames.length })} ${plugin.toolNames.join(", ") || t("none")}`,
      `${t("commandsFieldLabel", { count: plugin.commandNames.length })} ${plugin.commandNames.join(", ") || t("none")}`,
    ];
    copyToClipboard(lines.join("\n")).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  }, [plugin, t]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-gray-500 hover:text-gray-300 transition-colors mt-0.5"
    >
      {copied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? t("copied") : t("copyInfo")}</span>
    </button>
  );
}

export function StatusPanel() {
  const { t } = useTranslation("status");
  const yoloEnabled = useStatusStore((s) => s.yoloEnabled);
  const plugins = useStatusStore((s) => s.plugins);
  const skills = useStatusStore((s) => s.skills);
  const expandedSkill = useStatusStore((s) => s.expandedSkill);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
  const todosBySession = useSessionStore((s) => s.todosBySession);
  const allProcesses = useBashStore(useShallow((s) => s.processesBySession[activeSessionId ?? ""]));
  const backgroundedIds = useBashStore((s) => s.backgroundedIds);
  const [logViewer, setLogViewer] = useState<{ logPath: string; toolCallId: string } | null>(null);
  const todos = activeSessionId ? todosBySession[activeSessionId] : undefined;
  const lspStore = useLspStore((s) => s.statusBySession);
  const lspData = activeSessionId ? lspStore[activeSessionId] : undefined;
  const collapsedSections = useStatusStore((s) => s.collapsedSections);
  const toggleSection = useStatusStore((s) => s.toggleSection);
  const toggleYolo = useStatusStore((s) => s.toggleYolo);
  const toggleSkillExpanded = useStatusStore((s) => s.toggleSkillExpanded);
  const toggleSkillEnabled = useStatusStore((s) => s.toggleSkillEnabled);
  const expandedPlugin = useStatusStore((s) => s.expandedPlugin);
  const togglePluginExpanded = useStatusStore((s) => s.togglePluginExpanded);
  const supervisorStatus = useSupervisorStore(
    (s) => (activeSessionId ? s.bySession[activeSessionId] : null) ?? null,
  );
  const supervisorActions = useSupervisorStore((s) => s);

  const backgroundProcesses = allProcesses?.filter((p) => backgroundedIds.has(p.toolCallId)) ?? [];
  const hasProcesses = backgroundProcesses.length > 0;

  const SECTIONS: { id: StatusSection; label: string; icon: React.ElementType }[] = [
    { id: "yolo", label: t("yoloMode"), icon: Zap },
    { id: "plan", label: t("planMode"), icon: ClipboardList },
    { id: "shell", label: t("shell"), icon: Terminal },
    { id: "mcp", label: t("mcpTools"), icon: Plug },
    { id: "lsp", label: t("lsp"), icon: Network },
    { id: "plugins", label: t("plugins"), icon: Puzzle },
    { id: "skills", label: t("skills"), icon: BookOpen },
    { id: "supervisor", label: t("supervisor"), icon: Shield },
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
      <div className="py-1">
        <div className="flex items-center justify-between px-2.5 py-1 border-b border-gray-200 dark:border-gray-800/50">
          <span className="text-[10px] font-medium text-gray-400 dark:text-gray-500 uppercase tracking-wider">
            {t("status")}
          </span>
          <button
            onClick={handleRefresh}
            disabled={refreshing || !activeSessionId}
            className="p-0.5 rounded hover:bg-gray-200/50 dark:hover:bg-gray-800/30 transition-colors disabled:opacity-30"
            title={t("refreshResources")}
          >
            <RotateCw
              className={`w-3 h-3 text-gray-400 dark:text-gray-500 ${refreshing ? "animate-spin" : ""}`}
            />
          </button>
        </div>
        {SECTIONS.map(({ id, label, icon: Icon }) => {
          const collapsed = collapsedSections.has(id);
          return (
            <div
              key={id}
              className="border-b border-gray-200 dark:border-gray-800/50 last:border-b-0"
            >
              <button
                onClick={() => toggleSection(id)}
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-200/50 dark:hover:bg-gray-800/30 transition-colors"
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
                <div className="px-2.5 pb-1.5 text-[10px] text-gray-500">
                  {id === "yolo" && (
                    <button
                      onClick={toggleYolo}
                      className={`px-2 py-0.5 rounded text-[10px] ${yoloEnabled ? "bg-status-warning/30 text-status-warning" : "bg-gray-200 dark:bg-gray-800 text-gray-500"}`}
                    >
                      {yoloEnabled ? t("enabled") : t("disabled")}
                    </button>
                  )}
                  {id === "plan" && (
                    <div className="space-y-1">
                      {todos && todos.length > 0 && (
                        <div className="space-y-0.5 pt-0.5">
                          {todos.map((todo) => (
                            <div
                              key={todo.id}
                              className={`flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-gray-200/50 dark:hover:bg-gray-800/40 transition-colors${todo.deleted ? " opacity-40" : ""}`}
                            >
                              {todo.deleted ? (
                                <Trash2 className="w-3 h-3 shrink-0 text-status-error" />
                              ) : todo.done ? (
                                <CheckCircle2 className="w-3 h-3 shrink-0 text-status-success" />
                              ) : (
                                <Circle className="w-3 h-3 shrink-0 text-gray-500" />
                              )}
                              {todo.priority && !todo.deleted && (
                                <span
                                  className={`w-3 h-3 shrink-0 rounded-full flex items-center justify-center text-[7px] font-bold text-white ${PRIORITY_STYLES[todo.priority].dot}`}
                                >
                                  {PRIORITY_STYLES[todo.priority].label}
                                </span>
                              )}
                              <span
                                className={`${todo.deleted ? "text-status-error/60 line-through" : todo.done ? "text-gray-500 line-through" : "text-gray-700 dark:text-gray-300"} truncate`}
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
                              className={`w-1.5 h-1.5 rounded-full ${lspData?.state === "ready" ? "bg-status-success" : lspData?.state === "error" ? "bg-status-error" : lspData?.state === "starting" ? "bg-status-warning animate-pulse" : "bg-gray-600"}`}
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
                        <div className="flex items-center gap-1 text-[10px] text-gray-400">
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
                                  className={`truncate ${log.state === "error" ? "text-status-error/80" : log.state === "ready" ? "text-status-success/80" : "text-gray-500"}`}
                                >
                                  {log.name}
                                  {log.fileTypes && log.fileTypes.length > 0 ? (
                                    <span className="text-gray-600">
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
                                className={`w-1 h-1 rounded-full ${srv.state === "ready" ? "bg-status-success" : srv.state === "error" ? "bg-status-error" : srv.state === "starting" ? "bg-status-warning" : "bg-gray-600"}`}
                              />
                              <span className={`truncate text-gray-500`}>
                                {srv.name}
                                {srv.fileTypes && srv.fileTypes.length > 0 ? (
                                  <span className="text-gray-600">
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
                              className={`px-1.5 py-0.5 rounded text-[9px] ${lspData?.mode === m ? "bg-status-info/30 text-status-info" : "bg-gray-200 dark:bg-gray-800 text-gray-500 hover:bg-gray-300/50 dark:hover:bg-gray-700/50"}`}
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
                          <span className="truncate">
                            {lspData.lastDiagnostics.filePath}:{" "}
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
                                className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-gray-200/50 dark:hover:bg-gray-800/40 transition-colors cursor-pointer group"
                                onClick={() => togglePluginExpanded(p.path)}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${p.enabled ? "bg-status-success" : "bg-gray-400 dark:bg-gray-600"}`}
                                />
                                <span className={`shrink-0 ${isExpanded ? "" : ""}`}>
                                  {isExpanded ? (
                                    <ChevronDown className="w-3 h-3 text-gray-500" />
                                  ) : (
                                    <ChevronRight className="w-3 h-3 text-gray-500" />
                                  )}
                                </span>
                                <span className="truncate flex-1 text-gray-700 dark:text-gray-300">
                                  {p.name}
                                </span>
                                {p.toolNames.length > 0 && (
                                  <span className="text-gray-400 dark:text-gray-600">
                                    {t("pluginTools", { count: p.toolNames.length })}
                                  </span>
                                )}
                                {p.commandNames.length > 0 && (
                                  <span className="text-gray-400 dark:text-gray-600">
                                    {t("pluginCommands", { count: p.commandNames.length })}
                                  </span>
                                )}
                                <span
                                  className={`text-[9px] px-1 py-px rounded shrink-0 max-w-[36px] truncate ${p.scope === "global" ? "bg-semantic-agent/15 text-semantic-agent" : "bg-status-info/15 text-status-info"}`}
                                >
                                  {p.scope === "global" ? t("global") : t("project")}
                                </span>
                              </div>
                              {isExpanded && (
                                <div className="ml-4 pl-2 border-l border-gray-200 dark:border-gray-800 space-y-1 pt-1 text-[10px]">
                                  <div className="text-gray-500 dark:text-gray-400 break-all">
                                    <span className="text-gray-400 dark:text-gray-600">
                                      {t("pathLabel")}
                                    </span>{" "}
                                    {p.path}
                                  </div>
                                  {p.toolNames.length > 0 && (
                                    <div>
                                      <span className="text-gray-400 dark:text-gray-600 block mb-0.5">
                                        {t("toolsLabel")}
                                      </span>
                                      <div className="space-y-px">
                                        {p.toolNames.map((tn) => (
                                          <div
                                            key={tn}
                                            className="text-gray-500 dark:text-gray-400 pl-2 font-mono truncate"
                                          >
                                            {tn}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {p.commandNames.length > 0 && (
                                    <div>
                                      <span className="text-gray-400 dark:text-gray-600 block mb-0.5">
                                        {t("commandsLabel")}
                                      </span>
                                      <div className="space-y-px">
                                        {p.commandNames.map((cn) => (
                                          <div
                                            key={cn}
                                            className="text-gray-500 dark:text-gray-400 pl-2 font-mono truncate"
                                          >
                                            {cn}
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {p.toolNames.length === 0 && p.commandNames.length === 0 && (
                                    <div className="text-gray-400 dark:text-gray-600">
                                      {t("noToolsOrCommands")}
                                    </div>
                                  )}
                                  <PluginCopyButton plugin={p} />
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
                                className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-gray-200/50 dark:hover:bg-gray-800/40 transition-colors cursor-pointer group"
                                onClick={() => toggleSkillExpanded(sk.name)}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full ${sk.enabled ? "bg-status-success" : "bg-gray-400 dark:bg-gray-600"}`}
                                />
                                <span className="truncate flex-1 text-gray-700 dark:text-gray-300">
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
                                  className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-gray-300/50 dark:hover:bg-gray-700/50 rounded transition-opacity"
                                  title={sk.enabled ? t("disableSkill") : t("enableSkill")}
                                >
                                  {sk.enabled ? (
                                    <EyeOff className="w-3 h-3 text-gray-500" />
                                  ) : (
                                    <Eye className="w-3 h-3 text-gray-400" />
                                  )}
                                </button>
                              </div>
                              {isExpanded && (
                                <div className="ml-4 pl-2 border-l border-gray-200 dark:border-gray-800 space-y-1 pt-1 text-[10px]">
                                  <div className="text-gray-500 dark:text-gray-400 break-all">
                                    {sk.description || t("noDescription")}
                                  </div>
                                  <div className="space-y-0.5 text-gray-500">
                                    <div className="truncate" title={sk.filePath}>
                                      <span className="text-gray-400 dark:text-gray-600">
                                        {t("fileLabel")}
                                      </span>{" "}
                                      {sk.filePath.split("/").pop()}
                                    </div>
                                    <div>
                                      <span className="text-gray-400 dark:text-gray-600">
                                        {t("pathLabel")}
                                      </span>
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
                  {id === "supervisor" && (
                    <SupervisorSectionContent
                      status={supervisorStatus?.status ?? null}
                      taskReports={supervisorStatus?.taskReports ?? []}
                      sessionId={activeSessionId}
                      enable={supervisorActions.enable}
                      disable={supervisorActions.disable}
                      forceContinue={supervisorActions.forceContinue}
                      requestPause={supervisorActions.requestPause}
                      cancelPause={supervisorActions.cancelPause}
                    />
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
          ? "bg-gray-400 dark:bg-gray-600"
          : srv.status === "connected"
            ? "bg-status-success"
            : srv.status === "error"
              ? "bg-status-error"
              : srv.status === "connecting"
                ? "bg-status-warning animate-pulse"
                : "bg-gray-400 dark:bg-gray-600";
        return (
          <div key={srv.name} className={isDisabled ? "opacity-50" : ""}>
            <div
              className="flex items-center gap-1 py-0.5 px-1 rounded hover:bg-gray-200/50 dark:hover:bg-gray-800/40 transition-colors cursor-pointer group"
              onClick={() => toggleMcpExpanded(srv.name)}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${statusDot}`} />
              <span className="shrink-0">
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-gray-500" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-gray-500" />
                )}
              </span>
              <span className="truncate flex-1 text-gray-700 dark:text-gray-300">{srv.name}</span>
              {srv.toolCount > 0 && (
                <span className="text-gray-400 dark:text-gray-600">
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
                className={`w-6 h-3 rounded-full shrink-0 transition-colors relative ${isDisabled ? "bg-gray-600" : "bg-status-success"}`}
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
                className={`opacity-0 group-hover:opacity-100 p-0.5 rounded transition-opacity shrink-0 ${isDisabled || srv.status !== "connected" ? "text-gray-600 cursor-not-allowed" : "text-gray-400 hover:text-gray-300 hover:bg-gray-300/50 dark:hover:bg-gray-700/50 cursor-pointer"}`}
                title={t("restartMcpServer")}
              >
                <RotateCw className={`w-3 h-3 ${restarting === srv.name ? "animate-spin" : ""}`} />
              </button>
            </div>
            {isExpanded && (
              <div className="ml-4 pl-2 border-l border-gray-200 dark:border-gray-800 space-y-1 pt-1 text-[10px]">
                {srv.error && <div className="text-status-error/80 break-all">{srv.error}</div>}
                {srv.tools.length === 0 ? (
                  <div className="text-gray-400 dark:text-gray-600">{t("noMcpTools")}</div>
                ) : (
                  <>
                    <div>
                      <span className="text-gray-400 dark:text-gray-600 block mb-0.5">
                        {t("toolsLabel")}
                      </span>
                      <div className="space-y-px">
                        {srv.tools.map((tool) => (
                          <div
                            key={tool.name}
                            className="text-gray-500 dark:text-gray-400 pl-2 font-mono truncate"
                            title={tool.description || undefined}
                          >
                            {tool.name}
                            {tool.description && (
                              <span className="text-gray-400 dark:text-gray-600 font-sans ml-1">
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
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    const lines = [
      `${t("nameLabel")} ${server.name}`,
      `${t("locationLabel")} ${server.scope === "project" ? t("project") : t("global")}`,
      `${t("toolsFieldLabel", { count: server.toolCount })} ${server.tools.map((t) => t.name).join(", ") || t("none")}`,
    ];
    copyToClipboard(lines.join("\n")).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  }, [server, t]);

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-1 text-gray-500 hover:text-gray-300 transition-colors mt-0.5"
    >
      {copied ? <Check className="w-3 h-3 text-status-success" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? t("copied") : t("copyInfo")}</span>
    </button>
  );
}

interface SupervisorSectionContentProps {
  status: import("../../../shared/modules/supervisor").SupervisorStatus | null;
  taskReports: import("../../../shared/modules/supervisor").TaskReport[];
  sessionId: string | null;
  enable: (sessionId: string) => Promise<void>;
  disable: (sessionId: string) => Promise<void>;
  forceContinue: (sessionId: string, reason?: string) => Promise<void>;
  requestPause: (sessionId: string, delayMs?: number, reason?: string) => Promise<void>;
  cancelPause: (sessionId: string) => Promise<void>;
}

const STATE_STYLES: Record<string, string> = {
  idle: "bg-status-success/20 text-status-success",
  checking: "bg-status-info/20 text-status-info",
  paused: "bg-status-warning/20 text-status-warning",
  continuing: "bg-status-info/20 text-status-info",
  disabled: "bg-gray-500/20 text-gray-400",
};

function SupervisorSectionContent({
  status,
  taskReports,
  sessionId,
  enable,
  disable,
  forceContinue,
  requestPause,
  cancelPause,
}: SupervisorSectionContentProps) {
  const { t } = useTranslation("status");
  const [loading, setLoading] = useState(false);

  const handleEnable = useCallback(
    (sid: string) => {
      setLoading(true);
      enable(sid).finally(() => setLoading(false));
    },
    [enable],
  );

  if (!status) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-gray-400">{t("supervisor.state.disabled")}</span>
        {sessionId && (
          <button
            onClick={() => handleEnable(sessionId)}
            disabled={loading}
            className="px-1.5 py-0.5 rounded text-[9px] bg-status-success/20 text-status-success disabled:opacity-50"
          >
            {loading ? "..." : t("supervisor.enabled")}
          </button>
        )}
      </div>
    );
  }

  const stateLabel = t(`supervisor.state.${status.state}`) ?? status.state;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span
          className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${STATE_STYLES[status.state] ?? "bg-gray-500/20 text-gray-400"}`}
        >
          {stateLabel}
        </span>
        <span className={`text-[9px] ${status.enabled ? "text-status-success" : "text-gray-500"}`}>
          {status.enabled ? t("supervisor.enabled") : t("supervisor.disabled")}
        </span>
      </div>

      <div className="text-gray-500">
        {t("supervisor.continueCount")}: {status.continueCount}/{status.maxContinueCount}
      </div>

      {status.activeGuards.length > 0 && (
        <div>
          <span className="text-gray-400 dark:text-gray-600 block mb-0.5">
            {t("supervisor.activeGuards")}
          </span>
          <div className="flex flex-wrap gap-1">
            {status.activeGuards.map((g) => (
              <span
                key={g}
                className="px-1 py-px rounded text-[9px] bg-semantic-tool/15 text-semantic-tool"
              >
                {g}
              </span>
            ))}
          </div>
        </div>
      )}

      {taskReports.length > 0 && (
        <div>
          <span className="text-gray-400 dark:text-gray-600 block mb-0.5">
            {t("supervisor.taskReport")}
          </span>
          <div className="space-y-0.5">
            {taskReports.map((tr) => (
              <div key={tr.guardName} className="flex items-center gap-1">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    tr.status === "completed"
                      ? "bg-status-success"
                      : tr.status === "error"
                        ? "bg-status-error"
                        : tr.status === "incomplete"
                          ? "bg-status-warning"
                          : "bg-gray-500"
                  }`}
                />
                <span className="truncate text-gray-500">{tr.guardName}</span>
                <span className="text-[9px] text-gray-400 shrink-0">{tr.status}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {sessionId && (
        <div className="flex flex-wrap gap-1 pt-0.5">
          <button
            onClick={() => (status.enabled ? disable(sessionId) : enable(sessionId))}
            className={`px-1.5 py-0.5 rounded text-[9px] ${status.enabled ? "bg-status-error/20 text-status-error" : "bg-status-success/20 text-status-success"}`}
          >
            {status.enabled ? t("supervisor.disabled") : t("supervisor.enabled")}
          </button>
          {status.enabled && (
            <>
              <button
                onClick={() => forceContinue(sessionId)}
                className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-status-info/20 text-status-info"
              >
                <Play className="w-2.5 h-2.5" />
                {t("supervisor.forceContinue")}
              </button>
              {status.pendingPause ? (
                <button
                  onClick={() => cancelPause(sessionId)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-status-warning/20 text-status-warning"
                >
                  {t("supervisor.cancelPause")}
                </button>
              ) : (
                <button
                  onClick={() => requestPause(sessionId, 5000)}
                  className="flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] bg-status-warning/20 text-status-warning"
                >
                  <Pause className="w-2.5 h-2.5" />
                  {t("supervisor.pause")}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {status.pendingPause && (
        <div className="text-[9px] text-status-warning/80">
          {t("supervisor.pause")}:{" "}
          {Math.ceil((status.pendingPause.scheduledAt - Date.now()) / 1000)}s
          {status.pendingPause.reason ? ` — ${status.pendingPause.reason}` : ""}
        </div>
      )}
    </div>
  );
}
