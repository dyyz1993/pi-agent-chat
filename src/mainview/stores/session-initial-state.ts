import type { StoreApi } from "zustand";
import { apiClient } from "../lib/api-client";
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
import type { ContextUsage, SessionMeta, SessionStatus } from "../types";

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

interface AgentStateResult {
  model?: { provider?: string; id: string; name: string; contextWindow?: number };
  thinkingLevel?: string;
  isStreaming?: boolean;
  isCompacting?: boolean;
  streamingMessage?: unknown;
  activeToolExecutions?: Array<{
    toolCallId: string;
    toolName: string;
    args?: unknown;
    startedAt?: number;
  }>;
}

interface InitialStateSessionState {
  currentModel: { provider: string; id: string; name?: string } | null;
  currentThinkingLevel: string;
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
  sessionStatusMap: Record<string, SessionStatus>;
  sessionsByProject: Record<string, SessionMeta[]>;
  queueBySession: Record<string, { steering: string[]; followUp: string[] }>;
  updateSessionContext: (sessionId: string, usage: Partial<ContextUsage>) => void;
  updateSessionStatus: (sessionId: string, status: SessionStatus) => void;
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
}): (sessionId: string) => Promise<void> {
  return (sessionId) => {
    const existing = fetchInitPromiseMap.get(sessionId);
    if (existing) return existing;

    const lastFetch = fetchInitTimestampMap.get(sessionId);
    if (lastFetch && Date.now() - lastFetch < FETCH_INIT_TTL_MS) {
      perfLog.info("[fetchInit] TTL cache hit, skipping", {
        sessionId,
        ageMs: Date.now() - lastFetch,
      });
      return Promise.resolve();
    }

    const promise = (async () => {
      try {
        const t0 = performance.now();
        perfLog.info("[fetchInit] begin (batched, maxConcurrency=3)", { sessionId });

        // --- Priority 1: sequential, must complete first ---
        const statePromise = apiClient.call("agent.getState", { sessionId });

        statePromise
          .then(async (rawResult) => {
            perfLog.info("[fetchInit] getState done", {
              sessionId,
              ms: Math.round(performance.now() - t0),
            });
            const result = rawResult as AgentStateResult;
            if (!result) return;

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
            if (result.isStreaming) {
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
            } else if (result.isCompacting) {
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
              set({
                currentModel: {
                  provider: result.model.provider ?? "",
                  id: result.model.id,
                  name: result.model.name,
                },
                modelManuallySet: false,
              });
              if (manuallySet) {
                log.info("skipped model overwrite (user manually switched)", {
                  sessionId,
                  manualModel: `${result.model.provider}/${result.model.id}`,
                });
              }
            }

            if (result.thinkingLevel) {
              set({ currentThinkingLevel: result.thinkingLevel });
            }
          })
          .catch((err) => {
            log.warn("agent.getState failed", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
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

        // --- Priority 2 (parallel, max 3) ---
        const modelsPromise = apiClient.call("agent.getAvailableModels", { sessionId });
        const contextPromise = apiClient.call("agent.getContextUsage", { sessionId });
        const settingsPromise = apiClient.call("agent.getSettings", { sessionId });

        modelsPromise
          .then((modelsResult) => {
            if (Array.isArray(modelsResult)) {
              set({ availableModels: modelsResult });
            }
          })
          .catch((err) => {
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
          // Only retry once — avoid infinite retry loops when CLI is dead
          apiClient
            .call("agent.getContextUsage", { sessionId })
            .then((r) => {
              if (r && (r.contextWindow > 0 || r.tokens != null)) {
                const update: Partial<ContextUsage> = {};
                if (r.contextWindow > 0) update.contextWindow = r.contextWindow;
                if (r.tokens != null) update.tokens = r.tokens;
                get().updateSessionContext(sessionId, update);
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
            const update: Partial<ContextUsage> = {};
            if (r.contextWindow > 0) update.contextWindow = r.contextWindow;
            if (r.tokens != null) {
              update.tokens = r.tokens;
            } else {
              setTimeout(() => handleContextRetry(1), 1500);
              return;
            }
            if (update.contextWindow || update.tokens != null) {
              get().updateSessionContext(sessionId, update);
            }
          })
          .catch((err) => {
            log.warn("agent.getContextUsage failed in fetchInitialState", {
              sessionId,
              attempt: 0,
              err: err instanceof Error ? err.message : String(err),
            });
            setTimeout(() => handleContextRetry(1), 1500);
          });

        await Promise.allSettled([modelsPromise, contextPromise, settingsPromise]);

        // --- Priority 3 (parallel, max 3) ---
        const extensionsPromise = apiClient.call("agent.getExtensions", { sessionId });
        const skillsPromise = apiClient.call("agent.getSkills", { sessionId });
        const disabledSkillsPromise = apiClient.call("agent.getDisabledSkills", {});

        extensionsPromise
          .then((res) => {
            perfLog.info("[fetchInit] getExtensions done", {
              sessionId,
              ms: Math.round(performance.now() - t0),
            });
            const rawExts = Array.isArray(res)
              ? res
              : ((res as { extensions?: ExtensionEntry[] })?.extensions ?? []);
            const exts = rawExts as ExtensionEntry[];
            if (exts.length === 0) return;
            const plugins = exts.map((e: ExtensionEntry) => {
              const parts = e.path.split("/");
              const fileName = parts.pop()?.replace(/\.(ts|js|tsx|jsx)$/, "") ?? "unknown";
              const dirName = parts.pop() ?? fileName;
              const name = fileName === "index" ? dirName : fileName;
              return {
                name,
                path: e.path,
                enabled: true,
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

        await Promise.allSettled([extensionsPromise, skillsPromise, disabledSkillsPromise]);

        // --- Priority 4 (parallel, max 3) ---
        const mcpPromise = apiClient.call("agent.getMcpServers", { sessionId });
        const queuePromise = apiClient.call("agent.getQueue", { sessionId });
        const agentChangePromise = apiClient.call("agent.getLatestAgentChange", { sessionId });
        const supervisorStore = useSupervisorStore.getState();
        const supervisorPromise =
          typeof supervisorStore.fetchStatus === "function"
            ? supervisorStore.fetchStatus(sessionId)
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
              set((s) => ({
                queueBySession: {
                  ...s.queueBySession,
                  [sessionId]: { steering, followUp },
                },
              }));
            }
          })
          .catch((err) => {
            log.warn("agent.getQueue failed", {
              sessionId,
              err: err instanceof Error ? err.message : String(err),
            });
          });

        await Promise.allSettled([mcpPromise, queuePromise, agentChangePromise, supervisorPromise]);

        // --- Priority 5 (parallel) ---
        const agentsPromise = apiClient.call("agent.getAgents", { sessionId });
        const currentAgentPromise = apiClient.call("agent.getCurrentAgent", { sessionId });
        const tierPromise = apiClient.call("agent.getTierModels", { sessionId });
        const favoritesPromise = apiClient.call("project.getModelFavorites", {});
        const currentSessionMeta = (() => {
          for (const sessions of Object.values(get().sessionsByProject)) {
            const found = sessions.find((s) => s.sessionId === sessionId);
            if (found) return found;
          }
          return null;
        })();
        const persistedTierPromise = currentSessionMeta
          ? apiClient
              .call("session.loadTierConfig", { sessionPath: currentSessionMeta.sessionPath })
              .catch(() => ({ config: null }))
          : Promise.resolve({ config: null as unknown });

        Promise.all([statePromise, tierPromise, persistedTierPromise])
          .then(([rawState, rawTier, rawPersisted]) => {
            const tierResult = rawTier as { models: Record<string, string> };
            if (tierResult?.models) {
              useTierStore.getState().setGlobalDefaults(tierResult.models);
            }
            const persisted = rawPersisted as {
              config: { tierModels: Record<string, string>; currentTier: string | null } | null;
            };
            if (persisted.config) {
              useTierStore.getState().setSessionTierModels(sessionId, persisted.config.tierModels);
              useTierStore
                .getState()
                .setSessionCurrentTier(
                  sessionId,
                  persisted.config.currentTier as "fast" | "pro" | "max" | null,
                );
            }
            const stateResult = rawState as AgentStateResult;
            if (stateResult?.model) {
              useTierStore
                .getState()
                .syncTierFromModel(
                  sessionId,
                  stateResult.model.provider ?? "",
                  stateResult.model.id ?? "",
                );
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

        Promise.all([agentsPromise, currentAgentPromise, agentChangePromise])
          .then(([agentsResult, currentResult, agentChangeResult]: [unknown, unknown, unknown]) => {
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
            }));
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
      }
    })();

    fetchInitPromiseMap.set(sessionId, promise);
    return promise;
  };
}
