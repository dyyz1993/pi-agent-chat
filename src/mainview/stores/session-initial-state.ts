import type { StoreApi } from "zustand";
import { apiClient } from "../lib/api-client";
import { createStartupTrace } from "../lib/startup-monitor";
import { useAppStore } from "./use-app-store";
import { useChatStore } from "./use-chat-store";
import {
  useStatusStore,
  derivePluginScope,
  deriveSkillScope,
  derivePluginUsageNotice,
  type MCPServerInfo,
} from "./use-status-store";
import { useTierStore } from "./use-tier-store";
import { useRetryConfigStore, RETRY_DEFAULTS } from "./use-settings-store";
import { useAgentStore } from "./use-agent-store";
import { useSupervisorStore } from "./use-supervisor-store";
import { useSessionQueueStore } from "./use-session-queue-store";
import { useUIDialogStore } from "./use-ui-dialog-store";
import { useCompactionStore } from "./use-compaction-store";
import type { ContextUsage, SessionMeta, SessionStatus, SessionUsageStats } from "../types";
import type { ExtensionUIRequestEvent } from "../../shared/modules/agent";

interface ExtensionEntry {
  path: string;
  toolNames: string[];
  commandNames: string[];
}

interface SkillEntry {
  name: string;
  description: string;
  filePath: string;
  baseDir: string;
  disableModelInvocation: boolean;
  sourceInfo?: { scope?: string };
}

interface SkillsResponse {
  skills?: SkillEntry[];
  [index: number]: SkillEntry;
}

interface DisabledSkillsResponse {
  disabledSkills?: string[];
}

interface DisabledPluginsResponse {
  disabledPlugins?: string[];
}

interface AgentStateResult {
  model?: {
    provider?: string;
    id: string;
    name: string;
    reasoning?: boolean;
    contextWindow?: number;
  };
  thinkingLevel?: string;
  permissionMode?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  streamingMessage?: unknown;
  activeToolExecutions?: Array<{
    toolCallId: string;
    toolName: string;
    args?: unknown;
    startedAt?: number;
  }>;
  pendingUIRequests?: ExtensionUIRequestEvent[];
}

interface InitialStateSessionState {
  activeProjectId: string | null;
  activeSessionId: string | null;
  currentModel: { provider: string; id: string; name?: string; reasoning?: boolean } | null;
  modelBySession: Record<
    string,
    { provider: string; id: string; name?: string; reasoning?: boolean }
  >;
  modelStateLoading: boolean;
  currentThinkingLevel: string;
  thinkingLevelBySession: Record<string, string>;
  availableModels: Array<{
    provider: string;
    id: string;
    name: string;
    contextWindow: number;
    reasoning: boolean;
    input: ("text" | "image")[];
  }>;
  modelFavorites: Set<string>;
  modelManuallySet: boolean;
  sessionReady: Record<string, boolean>;
  agentReady: Record<string, boolean>;
  projectStartFailed: Record<string, boolean>;
  projectStartError: Record<string, string>;
  sessionStatusMap: Record<string, SessionStatus>;
  sessionsByProject: Record<string, SessionMeta[]>;
  updateSessionContext: (sessionId: string, usage: Partial<ContextUsage>) => void;
  updateSessionStats: (sessionId: string, stats: SessionUsageStats) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
  fetchModelState: (
    sessionId: string,
    options?: { force?: boolean; includeFavorites?: boolean },
  ) => Promise<void>;
}

type SetState = StoreApi<InitialStateSessionState>["setState"];
type GetState = StoreApi<InitialStateSessionState>["getState"];

interface InitialStateLogger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
}

const fetchInitPromiseMap = new Map<string, Promise<void>>();
const fetchInitTimestampMap = new Map<string, number>();
const FETCH_INIT_TTL_MS = 30_000;

type InteractiveUIMethod = "askUserQuestion" | "confirm" | "input" | "select" | "editor";

function isInteractiveUIRequest(
  request: ExtensionUIRequestEvent,
): request is ExtensionUIRequestEvent & { method: InteractiveUIMethod } {
  return (
    request.method === "confirm" ||
    request.method === "askUserQuestion" ||
    request.method === "input" ||
    request.method === "select" ||
    request.method === "editor"
  );
}

export function clearSessionFetchInitCache(sessionId: string): void {
  fetchInitTimestampMap.delete(sessionId);
}

export function createFetchInitialStateAction({
  get,
  set,
  log,
  perfLog,
}: {
  get: GetState;
  set: SetState;
  log: InitialStateLogger;
  perfLog: InitialStateLogger;
}): (sessionId: string, options?: { force?: boolean }) => Promise<void> {
  return (sessionId, options) => {
    const existing = fetchInitPromiseMap.get(sessionId);
    if (existing) return existing;

    const lastFetch = fetchInitTimestampMap.get(sessionId);
    if (!options?.force && lastFetch && Date.now() - lastFetch < FETCH_INIT_TTL_MS) {
      perfLog.info("[fetchInit] TTL cache hit, skipping", {
        sessionId,
        ageMs: Date.now() - lastFetch,
      });
      return Promise.resolve();
    }

    const promise = (async () => {
      const trace = createStartupTrace("fetch-init", { sessionId });
      const t0 = performance.now();
      try {
        perfLog.info("[fetchInit] begin (batched, maxConcurrency=3)", { sessionId });

        trace.mark("begin");

        set({ modelStateLoading: true });

        // --- Priority 1: sequential, must complete first ---
        const statePromise = apiClient.call("agent.getState", { sessionId });

        statePromise
          .then(async (rawResult) => {
            perfLog.info("[fetchInit] getState done", {
              sessionId,
              ms: Math.round(performance.now() - t0),
            });
            trace.mark("p1-getstate-done", { ms: Math.round(performance.now() - t0) });
            const result = rawResult as AgentStateResult;
            if (!result) return;

            set((s) => {
              const projectState =
                s.activeSessionId === sessionId && s.activeProjectId
                  ? {
                      projectStartFailed: { ...s.projectStartFailed, [s.activeProjectId]: false },
                      projectStartError: { ...s.projectStartError, [s.activeProjectId]: "" },
                    }
                  : {};
              return {
                sessionReady: { ...s.sessionReady, [sessionId]: true },
                agentReady: { ...s.agentReady, [sessionId]: true },
                ...projectState,
              };
            });

            useStatusStore
              .getState()
              .applyPermissionProfileSnapshot(result.permissionMode, sessionId);

            const chat = useChatStore.getState();
            if (typeof chat.setActiveToolCallIds === "function") {
              chat.setActiveToolCallIds(
                sessionId,
                Array.isArray(result.activeToolExecutions)
                  ? result.activeToolExecutions.map((tool) => tool.toolCallId)
                  : undefined,
              );
            }

            const cw = result.model?.contextWindow ?? 0;
            if (cw > 0) {
              get().updateSessionContext(sessionId, { contextWindow: cw });
            }
            const pendingUIRequests = Array.isArray(result.pendingUIRequests)
              ? result.pendingUIRequests.filter(isInteractiveUIRequest)
              : [];
            if (pendingUIRequests.length > 0) {
              const uiDialog = useUIDialogStore.getState();
              for (const request of pendingUIRequests) {
                uiDialog.registerUIRequest({
                  requestId: request.id,
                  sessionId,
                  method: request.method,
                  title: request.title,
                  message: request.message,
                  options: request.options,
                  questions: request.questions,
                  multiple: request.multiple,
                  placeholder: request.placeholder,
                  prefill: request.prefill,
                  timeout: request.timeout,
                  toolCallId: request.toolCallId,
                  confirmText: request.confirmText,
                  cancelText: request.cancelText,
                  hookMeta: request.hookMeta,
                  permissionMeta: request.permissionMeta,
                });
              }
              get().updateSessionStatus(sessionId, "permission");
            } else if (result.isStreaming) {
              const currentStatus = get().sessionStatusMap[sessionId];
              if (currentStatus === "permission") {
                // Do not overwrite a restored permission request.
              } else {
                get().updateSessionStatus(sessionId, "streaming");
                if (
                  result.streamingMessage &&
                  typeof result.streamingMessage === "object" &&
                  "role" in (result.streamingMessage as object)
                ) {
                  const raw = result.streamingMessage as {
                    role: string;
                    content?: unknown;
                    timestamp?: number;
                  };
                  if (raw.role === "assistant") {
                    try {
                      const { messageToChatMessage } = await import("../lib/message-mapper");
                      const msg = messageToChatMessage(
                        raw as Parameters<typeof messageToChatMessage>[0],
                      );
                      if (msg) {
                        const chat = useChatStore.getState();
                        const existing = chat.messagesBySession[sessionId] || [];
                        const alreadyStreaming = existing.some(
                          (m) => m.role === "assistant" && m.isStreaming,
                        );
                        const lastMsg = existing[existing.length - 1];
                        const lastIsAssistant = lastMsg && lastMsg.role === "assistant";
                        const lastHasContent =
                          lastIsAssistant &&
                          Array.isArray(lastMsg.content) &&
                          lastMsg.content.length > 0;
                        if (!alreadyStreaming && !lastHasContent) {
                          chat.setMessagesForSession(sessionId, [
                            ...existing,
                            { ...msg, isStreaming: true },
                          ]);
                        } else if (lastIsAssistant && !alreadyStreaming) {
                          chat.setMessagesForSession(sessionId, [
                            ...existing.slice(0, -1),
                            { ...lastMsg, isStreaming: true },
                          ]);
                        }
                      }
                    } catch {
                      /* ignore */
                    }
                  }
                }
              }
            } else if (result.isCompacting) {
              useCompactionStore.getState().markRunning(sessionId, "recovered");
              get().updateSessionStatus(sessionId, "compacting");
            } else {
              const currentStatus = get().sessionStatusMap[sessionId];
              if (
                currentStatus !== "streaming" &&
                currentStatus !== "compacting" &&
                currentStatus !== "retrying"
              ) {
                get().updateSessionStatus(sessionId, "idle");
              }
            }

            if (result.model) {
              const manuallySet = get().modelManuallySet;
              const resolvedModel = {
                provider: result.model.provider ?? "",
                id: result.model.id,
                name: result.model.name,
                reasoning: result.model.reasoning,
              };
              set((s) => ({
                currentModel: s.activeSessionId === sessionId ? resolvedModel : s.currentModel,
                modelManuallySet: false,
                modelBySession: { ...s.modelBySession, [sessionId]: resolvedModel },
              }));
              if (manuallySet) {
                log.info("skipped model overwrite (user manually switched)", {
                  sessionId,
                  manualModel: `${result.model.provider}/${result.model.id}`,
                });
              }
            }

            const thinkingLevel = result.thinkingLevel;
            if (thinkingLevel) {
              set((s) => ({
                currentThinkingLevel:
                  s.activeSessionId === sessionId ? thinkingLevel : s.currentThinkingLevel,
                thinkingLevelBySession: {
                  ...s.thinkingLevelBySession,
                  [sessionId]: thinkingLevel,
                },
              }));
            }
            set({ modelStateLoading: false });
          })
          .catch((err) => {
            log.warn("agent.getState failed", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
            set({ modelStateLoading: false });
          });

        // P1 gate: if getState fails (CLI dead), abort the entire fetch chain
        let p1Ok = false;
        try {
          await statePromise;
          p1Ok = true;
        } catch {
          log.warn("[fetchInit] P1 getState failed — aborting fetch chain", { sessionId });
          set((s) => ({
            sessionReady: { ...s.sessionReady, [sessionId]: false },
          }));
        }
        if (!p1Ok) return;

        const currentSessionMeta = (() => {
          for (const sessions of Object.values(get().sessionsByProject)) {
            const found = sessions.find((s) => s.sessionId === sessionId);
            if (found) return found;
          }
          return null;
        })();
        const projectTrustPromise = currentSessionMeta?.projectPath
          ? apiClient.call("agent.getProjectTrust", { projectPath: currentSessionMeta.projectPath })
          : Promise.resolve(null);
        projectTrustPromise
          .then((trust) => {
            if (trust) {
              useStatusStore.getState().setProjectTrustState(trust);
            } else {
              useStatusStore.getState().setProjectTrustState(null);
            }
          })
          .catch((err) => {
            log.warn("agent.getProjectTrust failed", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
          });

        // --- Priority 2 (parallel, lightweight session snapshots) ---
        const modelsPromise = get().fetchModelState(sessionId, { includeFavorites: false });
        const contextPromise = apiClient.call("agent.getContextUsage", { sessionId });
        const sessionStatsPromise = apiClient.call("agent.getSessionStats", { sessionId });
        const settingsPromise = apiClient.call("agent.getSettings", { sessionId });

        modelsPromise.catch((err) => {
          log.warn("agent.getAvailableModels failed", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });

        settingsPromise
          .then((raw) => {
            const settings = raw as Record<string, unknown> | null;
            if (!settings) return;
            const retry = settings.retry as
              | {
                  enabled?: boolean;
                  maxRetries?: number;
                  baseDelayMs?: number;
                  maxDelayMs?: number;
                }
              | undefined;
            if (retry) {
              useRetryConfigStore.getState().setRetryConfig({
                enabled: retry.enabled ?? RETRY_DEFAULTS.enabled,
                maxRetries: retry.maxRetries ?? RETRY_DEFAULTS.maxRetries,
                baseDelayMs: retry.baseDelayMs ?? RETRY_DEFAULTS.baseDelayMs,
                maxDelayMs: retry.maxDelayMs ?? RETRY_DEFAULTS.maxDelayMs,
              });
            }
          })
          .catch(() => {});

        const handleContextRetry = (_attempt: number): void => {
          apiClient
            .call("agent.getContextUsage", { sessionId })
            .then((r) => {
              if (r && (r.contextWindow > 0 || r.tokens != null)) {
                get().updateSessionContext(sessionId, r);
              }
            })
            .catch(() => {
              log.warn("agent.getContextUsage retry failed, giving up", {
                sessionId,
                attempt: _attempt,
              });
            });
        };

        contextPromise
          .then((r) => {
            perfLog.info("[fetchInit] getContextUsage", {
              sessionId,
              attempt: 0,
              ms: Math.round(performance.now() - t0),
            });
            if (!r) {
              setTimeout(() => handleContextRetry(1), 1500);
              return;
            }
            if (r.tokens == null) {
              setTimeout(() => handleContextRetry(1), 1500);
              return;
            }
            get().updateSessionContext(sessionId, r);
          })
          .catch((err) => {
            log.warn("agent.getContextUsage failed in fetchInitialState", {
              sessionId,
              attempt: 0,
              err: err instanceof Error ? err.message : String(err),
            });
            setTimeout(() => handleContextRetry(1), 1500);
          });

        sessionStatsPromise
          .then((stats) => {
            if (!stats) return;
            get().updateSessionStats(sessionId, stats);
            if (stats.contextUsage) {
              get().updateSessionContext(sessionId, stats.contextUsage);
            }
          })
          .catch((err) => {
            log.warn("agent.getSessionStats failed in fetchInitialState", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
          });

        await Promise.allSettled([
          modelsPromise,
          contextPromise,
          sessionStatsPromise,
          settingsPromise,
          projectTrustPromise,
        ]);
        trace.mark("p2-models-context-settings-done", { ms: Math.round(performance.now() - t0) });

        // --- Priority 3 (parallel, max 3) ---
        const extensionsPromise = apiClient.call("agent.getExtensions", { sessionId });
        const skillsPromise = apiClient.call("agent.getSkills", { sessionId });
        const disabledSkillsPromise = apiClient.call("agent.getDisabledSkills", {});

        const disabledPluginsPromise = currentSessionMeta?.projectPath
          ? apiClient.call("agent.getDisabledPlugins", {
              projectPath: currentSessionMeta.projectPath,
            })
          : Promise.resolve({ disabledPlugins: [] } as DisabledPluginsResponse);

        Promise.all([extensionsPromise, disabledPluginsPromise])
          .then(([extRes, disabledPluginsRes]) => {
            perfLog.info("[fetchInit] getExtensions+getDisabledPlugins done", {
              sessionId,
              ms: Math.round(performance.now() - t0),
            });
            const rawExts = Array.isArray(extRes)
              ? extRes
              : ((extRes as { extensions?: ExtensionEntry[] })?.extensions ?? []);
            const exts = rawExts as ExtensionEntry[];
            if (
              exts.length === 0 &&
              !(disabledPluginsRes as DisabledPluginsResponse)?.disabledPlugins?.length
            )
              return;
            const dp = disabledPluginsRes as DisabledPluginsResponse;
            const disabledPluginSet = new Set(dp?.disabledPlugins ?? []);
            const plugins = exts.map((e: ExtensionEntry) => {
              const parts = e.path.split("/");
              const fileName = parts.pop()?.replace(/\.(ts|js|tsx|jsx)$/, "") ?? "unknown";
              const dirName = parts.pop() ?? fileName;
              const name = fileName === "index" ? dirName : fileName;
              return {
                name,
                path: e.path,
                enabled: !disabledPluginSet.has(e.path),
                toolNames: e.toolNames,
                commandNames: e.commandNames,
                scope: derivePluginScope(e.path),
                usageNotice: derivePluginUsageNotice(name),
              };
            });
            useStatusStore.getState().setPlugins(plugins);
          })
          .catch((err) => {
            log.warn("agent.getExtensions failed", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
          });

        Promise.all([skillsPromise, disabledSkillsPromise])
          .then(([skillsRes, disabledRes]) => {
            perfLog.info("[fetchInit] getSkills+getDisabledSkills done", {
              sessionId,
              ms: Math.round(performance.now() - t0),
            });
            const skillsArr = (
              Array.isArray(skillsRes) ? skillsRes : ((skillsRes as SkillsResponse)?.skills ?? [])
            ) as SkillEntry[];
            if (skillsArr.length === 0) {
              useAppStore
                .getState()
                .addLog(`[skills] non-array response, type=${typeof skillsRes}`);
              return;
            }
            const disabled = disabledRes as DisabledSkillsResponse;
            const disabledSet = new Set(disabled?.disabledSkills ?? []);
            useAppStore
              .getState()
              .addLog(`[skills] loaded ${skillsArr.length} items, ${disabledSet.size} disabled`);
            useStatusStore.getState().setSkills(
              skillsArr.map((s: SkillEntry) => {
                const fp: string = s.filePath;
                const scope: "global" | "project" =
                  s.sourceInfo?.scope === "user" ? "global" : deriveSkillScope(fp);
                return {
                  name: s.name,
                  description: s.description,
                  filePath: fp,
                  baseDir: s.baseDir,
                  disableModelInvocation: s.disableModelInvocation,
                  enabled: !disabledSet.has(s.name),
                  scope,
                };
              }),
            );
          })
          .catch((err) => {
            useAppStore
              .getState()
              .addLog(`[skills] call failed: ${err instanceof Error ? err.message : String(err)}`);
          });

        await Promise.allSettled([
          extensionsPromise,
          skillsPromise,
          disabledSkillsPromise,
          disabledPluginsPromise,
        ]);
        trace.mark("p3-ext-skills-plugins-done", { ms: Math.round(performance.now() - t0) });

        // --- Priority 4 (parallel, max 3) ---
        const mcpPromise = apiClient.call("agent.getMcpServers", { sessionId });
        const queuePromise = apiClient.call("agent.getQueue", { sessionId });
        const agentChangePromise = apiClient.call("agent.getLatestAgentChange", { sessionId });
        const supervisorStore = useSupervisorStore.getState();
        const supervisorPromise =
          typeof supervisorStore.fetchStatus === "function"
            ? Promise.allSettled([
                supervisorStore.fetchStatus(sessionId),
                supervisorStore.fetchTaskReport(sessionId),
                supervisorStore.fetchTriggerHistory(sessionId, 50),
              ])
            : Promise.resolve();

        mcpPromise
          .then((res) => {
            perfLog.info("[fetchInit] getMcpServers done", {
              sessionId,
              ms: Math.round(performance.now() - t0),
            });
            const rawServers = res.servers ?? [];
            const servers: MCPServerInfo[] = rawServers.map((s) => ({
              name: s.name,
              status: s.status,
              error: s.error,
              toolCount: s.tools.length,
              tools: s.tools.map((t) => ({
                name: t.originalName,
                description: t.description,
              })),
              scope: (s.scope as "global" | "project") ?? "global",
              disabled: s.disabled,
            }));
            log.info("[MCP] getMcpServers", {
              sessionId,
              count: servers.length,
              names: servers.map((s) => s.name),
            });
            useStatusStore.getState().setMcpServers(servers);
          })
          .catch((err) => {
            log.warn("agent.getMcpServers failed", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
          });

        queuePromise
          .then((result) => {
            perfLog.info("[fetchInit] getQueue done", {
              sessionId,
              ms: Math.round(performance.now() - t0),
            });
            perfLog.info("[fetchInit] ALL sub-calls dispatched", {
              sessionId,
              totalMs: Math.round(performance.now() - t0),
            });
            if (!result) return;
            const { steering, followUp } = result;
            if (steering.length > 0 || followUp.length > 0) {
              useSessionQueueStore.getState().setSessionQueue(sessionId, { steering, followUp });
            }
          })
          .catch((err) => {
            log.warn("agent.getQueue failed", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
          });

        await Promise.allSettled([mcpPromise, queuePromise, agentChangePromise, supervisorPromise]);
        trace.mark("p4-mcp-queue-supervisor-done", { ms: Math.round(performance.now() - t0) });

        // --- Priority 5 (parallel) ---
        const agentsPromise = apiClient.call("agent.getAgents", { sessionId });
        const currentAgentPromise = apiClient.call("agent.getCurrentAgent", { sessionId });
        const tierPromise = useTierStore.getState().fetchTierConfig(sessionId);
        const favoritesPromise = apiClient.call("project.getModelFavorites", {});
        const agentFavoritesPromise = apiClient.call("project.getAgentFavorites", {});

        Promise.all([statePromise, tierPromise])
          .then(([rawState]) => {
            const stateResult = rawState as AgentStateResult;
            const projectPath = currentSessionMeta?.projectPath;
            if (stateResult?.model) {
              if (projectPath) {
                useTierStore
                  .getState()
                  .syncTierFromModelForSession(
                    sessionId,
                    projectPath,
                    stateResult.model.provider ?? "",
                    stateResult.model.id ?? "",
                    { preserveOnMismatch: true },
                  );
              }
            }

            // Deferred tier switch for blank sessions: if syncTierFromModel
            // didn't match any tier (current model is not in the tier map),
            // auto-select the "fast" tier so the CLI has a valid tier mapping.
            if (!projectPath) return;
            const isBlankSession =
              currentSessionMeta &&
              (currentSessionMeta.messageCount ?? 0) === 0 &&
              !currentSessionMeta.firstMessage;
            if (!isBlankSession) return;
            const existingTier = useTierStore.getState().getCurrentTier(projectPath);
            if (existingTier) return;
            const tierModels = useTierStore.getState().getTierModels(projectPath);
            if (Object.keys(tierModels).length > 0 && tierModels.fast) {
              void useTierStore
                .getState()
                .switchToTier("fast", sessionId)
                .catch((err) => {
                  log.warn("delayed tier switch failed after initial state", {
                    sessionId,
                    tier: "fast",
                    err: err instanceof Error ? err.message : String(err),
                  });
                });
            }
          })
          .catch(() => {});

        favoritesPromise
          .then((res) => {
            if (res) {
              set({ modelFavorites: new Set((res as { favorites: string[] }).favorites) });
            }
          })
          .catch(() => {});

        Promise.all([agentsPromise, currentAgentPromise, agentChangePromise, agentFavoritesPromise])
          .then(([agentsResult, currentResult, agentChangeResult, agentFavoritesResult]) => {
            perfLog.info("[fetchInit] getAgents done", {
              sessionId,
              ms: Math.round(performance.now() - t0),
            });
            const raw = agentsResult as {
              agents?: Array<{
                name: string;
                description?: string;
                tier?: string;
                tools?: string[];
                permissionMode?: string;
                source?: string;
                filePath?: string;
                color?: string;
                avatar?: { type: "emoji"; value: string } | { type: "image"; src: string };
              }>;
            };
            const agentList = (raw.agents ?? []).map((a) => ({
              name: a.name,
              description: a.description,
              tier: a.tier,
              tools: a.tools,
              permissionMode: a.permissionMode,
              source: (a.source ?? "builtin") as "builtin" | "user" | "project",
              filePath: a.filePath ?? "",
              color: a.color,
              avatar: a.avatar,
            }));
            useAgentStore
              .getState()
              .setAgentFavorites(
                (agentFavoritesResult as { favorites?: string[] } | null)?.favorites ?? [],
              );
            useAgentStore.getState().setAgents(agentList);

            perfLog.info("[fetchInit] getCurrentAgent done", {
              sessionId,
              ms: Math.round(performance.now() - t0),
            });
            const agentResult = currentResult as { agentName: string | null };
            const agentName = agentResult.agentName ?? "build";
            useAgentStore.getState().setCurrentAgent(sessionId, agentName);

            perfLog.info("[fetchInit] getLatestAgentChange done", {
              sessionId,
              ms: Math.round(performance.now() - t0),
            });
            const result = agentChangeResult;
            if (
              result &&
              typeof result === "object" &&
              "agentName" in result &&
              typeof result.agentName === "string"
            ) {
              const restoredName = result.agentName;
              if (restoredName === agentName) {
                log.info("[fetchInit] latest agent already active; skipping restore", {
                  sessionId,
                  agentName: restoredName,
                });
                useAgentStore.getState().fetchAgentDetail(sessionId);
                useAgentStore.getState().fetchAllTools(sessionId);
                return;
              }
              log.info("[fetchInit] restoring agent from latest change", {
                sessionId,
                agentName: restoredName,
                timestamp:
                  "timestamp" in result && typeof result.timestamp === "string"
                    ? result.timestamp
                    : undefined,
              });
              const { switchAgent } = useAgentStore.getState();
              void switchAgent(restoredName, sessionId).catch((err: unknown) => {
                log.warn("[fetchInit] failed to restore agent", {
                  sessionId,
                  agentName: restoredName,
                  err: err instanceof Error ? err.message : String(err),
                });
              });
            } else {
              useAgentStore.getState().fetchAgentDetail(sessionId);
              useAgentStore.getState().fetchAllTools(sessionId);
            }
          })
          .catch((err: unknown) => {
            log.warn("[fetchInit] agent restoration failed", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
          });
      } finally {
        fetchInitPromiseMap.delete(sessionId);
        fetchInitTimestampMap.set(sessionId, Date.now());
        set({ modelStateLoading: false });
        trace.done("all-done", { totalMs: Math.round(performance.now() - t0) });
      }
    })();

    fetchInitPromiseMap.set(sessionId, promise);
    return promise;
  };
}
