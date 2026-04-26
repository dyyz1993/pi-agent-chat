import { ChevronDown, ChevronRight, Zap, ClipboardList, Terminal, Plug, Network, Puzzle, CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import { useStatusStore } from "../../stores/use-status-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useSubagentStore } from "../../stores/use-subagent-store";
import { useLspStore } from "../../stores/use-lsp-store";
import type { LspDiagnosticsMode } from "../../../shared/modules/lsp";
import type { StatusSection } from "../../stores/use-status-store";

const SECTIONS: { id: StatusSection; label: string; icon: React.ElementType }[] = [
  { id: "yolo", label: "YOLO 模式", icon: Zap },
  { id: "plan", label: "计划模式", icon: ClipboardList },
  { id: "shell", label: "SHELL", icon: Terminal },
  { id: "mcp", label: "MCP 工具", icon: Plug },
  { id: "lsp", label: "LSP", icon: Network },
  { id: "plugins", label: "插件", icon: Puzzle },
];

export function StatusPanel() {
  const yoloEnabled = useStatusStore((s) => s.yoloEnabled);
  const shellActive = useStatusStore((s) => s.shellActive);
  const mcpTools = useStatusStore((s) => s.mcpTools);
  const plugins = useStatusStore((s) => s.plugins);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const activeSubId = useSubagentStore((s) => s.activeSubsessionId);
  const todosBySession = useSessionStore((s) => s.todosBySession);
  const todos = activeSessionId ? todosBySession[activeSessionId] : undefined;
  const lspStore = useLspStore((s) => s.statusBySession);
  const lspData = activeSessionId ? lspStore[activeSessionId] : undefined;
  const collapsedSections = useStatusStore((s) => s.collapsedSections);
  const toggleSection = useStatusStore((s) => s.toggleSection);
  const toggleYolo = useStatusStore((s) => s.toggleYolo);

  return (
    <div className="py-1">
      {SECTIONS.map(({ id, label, icon: Icon }) => {
        const collapsed = collapsedSections.has(id);
        return (
          <div key={id} className="border-b border-gray-800/50 last:border-b-0">
            <button
              onClick={() => toggleSection(id)}
              className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-medium text-gray-300 hover:bg-gray-800/30 transition-colors"
            >
              {collapsed ? <ChevronRight className="w-3 h-3 shrink-0" /> : <ChevronDown className="w-3 h-3 shrink-0" />}
              <Icon className="w-3 h-3 shrink-0" />
              <span>{label}</span>
            </button>
            {!collapsed && (
              <div className="px-2.5 pb-1.5 text-[10px] text-gray-500">
                {id === "yolo" && (
                  <button onClick={toggleYolo} className={`px-2 py-0.5 rounded text-[10px] ${yoloEnabled ? "bg-yellow-600/30 text-yellow-400" : "bg-gray-800 text-gray-500"}`}>
                    {yoloEnabled ? "已开启" : "已关闭"}
                  </button>
                )}
                {id === "plan" && (
                  <div className="space-y-1">
                    {todos && todos.length > 0 && (
                      <div className="space-y-0.5 pt-0.5">
                        {todos.map((t) => (
                          <div key={t.id} className="flex items-center gap-1.5 py-0.5 px-1 rounded hover:bg-gray-800/40 transition-colors">
                            {t.done
                              ? <CheckCircle2 className="w-3 h-3 shrink-0 text-emerald-400" />
                              : <Circle className="w-3 h-3 shrink-0 text-gray-500" />
                            }
                            <span className={`${t.done ? "text-gray-500 line-through" : "text-gray-300"} truncate`}>
                              {t.text}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                {id === "shell" && (
                  <span>{shellActive ? "运行中" : "空闲"}</span>
                )}
                {id === "mcp" && (
                  <div className="space-y-0.5">
                    {mcpTools.length === 0 ? <span>未连接</span> : mcpTools.map((t) => (
                      <div key={t.name} className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${t.status === "ready" ? "bg-green-400" : t.status === "error" ? "bg-red-400" : "bg-yellow-400 animate-pulse"}`} />
                        <span>{t.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {id === "lsp" && (
                  <div className="space-y-1">
                    {!lspData || lspData.startupComplete ? (
                      <div className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${lspData?.state === "ready" ? "bg-green-400" : lspData?.state === "error" ? "bg-red-400" : lspData?.state === "starting" ? "bg-yellow-400 animate-pulse" : "bg-gray-600"}`} />
                        <span>
                          {!lspData
                            ? "Inactive"
                            : lspData.state === "ready"
                              ? `Connected (${lspData.servers.length} server${lspData.servers.length !== 1 ? "s" : ""})`
                              : lspData.state === "error"
                                ? "Error"
                                : lspData.state === "starting"
                                  ? "Starting..."
                                  : lspData.state}
                        </span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1 text-[10px] text-gray-400">
                        <span className="animate-pulse">Starting {lspData.totalServers ?? lspData.startupLog.length} servers...</span>
                      </div>
                    )}
                    {lspData?.startupLog && lspData.startupLog.length > 0 && (
                      <div className="space-y-0.5 pl-1 pt-0.5">
                        {lspData.startupLog.map((log) => (
                          <div key={log.name} className="flex items-center gap-1">
                            <span className={`w-1 h-1 rounded-full ${log.state === "ready" ? "bg-green-400" : log.state === "error" ? "bg-red-400" : "bg-yellow-400 animate-pulse"}`} />
                            <span className={`truncate ${log.state === "error" ? "text-red-400/80" : log.state === "ready" ? "text-green-400/80" : "text-gray-500"}`}>
                              {log.name}
                              {log.fileTypes && log.fileTypes.length > 0 ? <span className="text-gray-600"> ({log.fileTypes.join(",")})</span> : null}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                    {lspData?.state === "ready" && lspData.servers.length > 0 && !lspData?.startupLog && (
                      <div className="space-y-0.5 pl-1">
                        {lspData.servers.map((srv) => (
                          <div key={srv.name} className="flex items-center gap-1">
                            <span className={`w-1 h-1 rounded-full ${srv.state === "ready" ? "bg-green-400" : srv.state === "error" ? "bg-red-400" : "bg-yellow-400"}`} />
                            <span className="truncate">{srv.name}{srv.fileTypes && srv.fileTypes.length > 0 ? ` (${srv.fileTypes.join(",")})` : ""}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-1 pt-0.5">
                      {(["agent_end", "edit_write", "disabled"] as LspDiagnosticsMode[]).map((m) => (
                        <button
                          key={m}
                          onClick={() => { if (activeSessionId && !activeSubId) useLspStore.getState().setMode(activeSessionId, m); }}
                          className={`px-1.5 py-0.5 rounded text-[9px] ${lspData?.mode === m ? "bg-blue-600/30 text-blue-400" : "bg-gray-800 text-gray-500 hover:bg-gray-700/50"}`}
                        >
                          {m === "agent_end" ? "On End" : m === "edit_write" ? "On Write" : "Off"}
                        </button>
                      ))}
                    </div>
                    {lspData?.lastDiagnostics && (
                      <div className="flex items-center gap-1 text-[9px] pt-0.5">
                        <AlertTriangle className={`w-2.5 h-2.5 ${lspData.lastDiagnostics.count > 0 ? "text-yellow-400" : "text-green-400"}`} />
                        <span className="truncate">{lspData.lastDiagnostics.filePath}: {lspData.lastDiagnostics.count} issue{lspData.lastDiagnostics.count !== 1 ? "s" : ""}</span>
                      </div>
                    )}
                  </div>
                )}
                {id === "plugins" && (
                  <div className="space-y-0.5">
                    {plugins.length === 0 ? <span>无插件</span> : plugins.map((p) => (
                      <div key={p.name} className="flex items-center gap-1">
                        <span className={`w-1.5 h-1.5 rounded-full ${p.enabled ? "bg-green-400" : "bg-gray-600"}`} />
                        <span>{p.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
