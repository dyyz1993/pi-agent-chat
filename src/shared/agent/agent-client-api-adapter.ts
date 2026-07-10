import type { AgentMessageForUI } from "../modules/agent";
import type { RpcClientAPI } from "@dyyz1993/pi-coding-agent";
import { createLogger } from "../lib/logger";
import type { TierKey } from "./agent-runtime-config";
import type { SessionCacheData, SessionCacheHit } from "./session-message-cache";
import { getSandboxManager } from "./agent-runtime-client";
import { getCommandsOperation, getSessionStatsOperation } from "./agent-client-state-operations";
import {
  cycleModelOperation,
  cycleThinkingLevelOperation,
  getAvailableModelsOperation,
  setModelOperation,
  setThinkingLevelOperation,
  switchTierOperation,
} from "./agent-client-model-operations";
import {
  getMessagesOperation,
  getFullMessagesOperation,
  getFullMessagesAroundOperation,
  getMessageNavPageOperation,
} from "./agent-client-message-operations";
import {
  abortRetryOperation,
  clearQueueOperation,
  compactOperation,
  getActiveToolsOperation,
  getContextUsageOperation,
  getExtensionsOperation,
  getMcpServersOperation,
  getQueueOperation,
  getSkillsOperation,
  getToolsOperation,
  promoteQueuedFollowUpOperation,
  reloadOperation,
  restartMcpServerOperation,
  setActiveToolsOperation,
  setAutoCompactionOperation,
  setAutoRetryOperation,
  setFollowUpModeOperation,
  setPermissionModeOperation,
  setSteeringModeOperation,
  toggleMcpServerOperation,
  type FollowUpQueueItemRef,
  type QueueItemRef,
} from "./agent-client-session-operations";
import {
  getAgentsOperation,
  getCurrentAgentOperation,
  getLatestAgentChangeOperation,
  getTierModelsOperation,
  setTierModelsOperation,
  switchAgentOperation,
} from "./agent-client-command-operations";
import { getLastAssistantTextOperation } from "./agent-client-history-operations";
import { readJsonlTreeEntriesOperation } from "./agent-tree-navigation-operations";

const log = createLogger("agent");

type McpServerInfo = Awaited<ReturnType<RpcClientAPI["getMcpServers"]>>[number];

export interface AgentApiManagedClient {
  client: RpcClientAPI;
  info: {
    projectPath: string;
    sessionPath: string;
    status: string;
    activeToolExecutions?: Array<{
      toolCallId: string;
      toolName: string;
      args?: unknown;
      startedAt?: number;
    }>;
  };
}

export interface AgentClientApiAdapter {
  getCommands: (
    sessionId: string,
  ) => Promise<
    Array<{ name: string; description: string; source: "extension" | "prompt" | "skill" }>
  >;
  getSessionStats: (sessionId: string) => Promise<{
    tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
    cost: number;
    toolCalls: number;
    totalMessages: number;
    userMessages?: number;
    assistantMessages?: number;
    toolResults?: number;
    contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
  } | null>;
  getMessages: (
    sessionId: string,
    sessionPath?: string,
  ) => Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
  }>;
  getFullMessages: (
    sessionId: string,
    sessionPath?: string,
    options?: { limit?: number; afterEntryId?: string; fromStart?: boolean },
  ) => Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
    hasMore: boolean;
    totalCount: number;
    nextCursor: string | null;
  }>;
  getMessageNavPage: (
    sessionId: string,
    sessionPath?: string,
    options?: { limit?: number; afterEntryId?: string; fromStart?: boolean },
  ) => Promise<{
    messages: AgentMessageForUI[];
    hasMore: boolean;
    totalCount: number;
    nextCursor: string | null;
  }>;
  getFullMessagesAround: (
    sessionId: string,
    sessionPath: string | undefined,
    options: { targetEntryId: string; before?: number; after?: number },
  ) => Promise<{
    messages: AgentMessageForUI[];
    customEntries: Array<{ id: string; customType: string; data: unknown; timestamp: number }>;
    hasMoreBefore: boolean;
    hasMoreAfter: boolean;
    beforeCursor: string | null;
    afterCursor: string | null;
    targetFound: boolean;
    totalCount: number;
  }>;
  getAvailableModels: (
    sessionId: string,
  ) => Promise<Array<{ provider: string; id: string; contextWindow: number; reasoning: boolean }>>;
  setModel: (
    sessionId: string,
    provider: string,
    modelId: string,
  ) => Promise<{ provider: string; id: string }>;
  switchTier: (
    sessionId: string,
    tier: TierKey,
  ) => Promise<{ provider: string; id: string; tier: TierKey }>;
  cycleModel: (sessionId: string) => Promise<{
    model: { provider: string; id: string };
    thinkingLevel: string;
    isScoped: boolean;
  } | null>;
  setThinkingLevel: (sessionId: string, level: string) => Promise<void>;
  cycleThinkingLevel: (sessionId: string) => Promise<{ level: string } | null>;
  compact: (
    sessionId: string,
    customInstructions?: string,
  ) => Promise<{ summary: string; tokensBefore: number }>;
  setAutoCompaction: (sessionId: string, enabled: boolean) => Promise<void>;
  setAutoRetry: (sessionId: string, enabled: boolean) => Promise<void>;
  abortRetry: (sessionId: string) => Promise<void>;
  setSteeringMode: (sessionId: string, mode: string) => Promise<void>;
  setFollowUpMode: (sessionId: string, mode: string) => Promise<void>;
  setPermissionMode: (sessionId: string, mode: string) => Promise<{ mode: string }>;
  getActiveTools: (sessionId: string) => Promise<{ toolNames: string[] }>;
  setActiveTools: (sessionId: string, toolNames: string[]) => Promise<void>;
  getQueue: (sessionId: string) => Promise<{ steering: string[]; followUp: string[] }>;
  clearQueue: (
    sessionId: string,
    item?: QueueItemRef,
  ) => Promise<{ steering: string[]; followUp: string[] }>;
  promoteQueuedFollowUp: (
    sessionId: string,
    item: FollowUpQueueItemRef,
  ) => Promise<{ steering: string[]; followUp: string[] }>;
  getExtensions: (sessionId: string) => Promise<{
    extensions: Array<{
      path: string;
      resolvedPath: string;
      toolNames: string[];
      commandNames: string[];
    }>;
  }>;
  getSkills: (sessionId: string) => Promise<{
    skills: Array<{
      name: string;
      description: string;
      filePath: string;
      baseDir: string;
      disableModelInvocation: boolean;
    }>;
  }>;
  reload: (sessionId: string) => Promise<void>;
  getTools: (
    sessionId: string,
  ) => Promise<{ tools: Array<{ name: string; label: string; description: string }> }>;
  getMcpServers: (sessionId: string) => Promise<{ servers: McpServerInfo[] }>;
  toggleMcpServer: (
    sessionId: string,
    name: string,
    enabled: boolean,
  ) => Promise<{ success: boolean; error?: string }>;
  restartMcpServer: (
    sessionId: string,
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  getContextUsage: (
    sessionId: string,
  ) => Promise<{ tokens: number | null; contextWindow: number; percent: number | null }>;
  getTierModels: (sessionId: string) => Promise<{ models: Record<string, string> }>;
  setTierModels: (sessionId: string, models: Record<string, string>) => Promise<{ ok: boolean }>;
  getAgents: (sessionId: string) => Promise<{
    agents: Array<{
      name: string;
      description?: string;
      tier?: string;
      tools?: string[];
      permissionMode?: string;
      source: string;
      filePath: string;
      color?: string;
      avatar?: { type: "emoji"; value: string } | { type: "image"; src: string };
    }>;
  }>;
  switchAgent: (
    sessionId: string,
    agentName: string,
  ) => Promise<{
    agentName: string;
    tools: string[];
    tier?: string;
    thinkingLevel?: string;
  }>;
  getCurrentAgent: (sessionId: string) => Promise<{ agentName: string | null }>;
  getAgentDetail: (sessionId: string, agentName: string) => Promise<unknown>;
  getAllTools: (sessionId: string) => Promise<unknown>;
  getSystemPrompt: (sessionId: string) => Promise<unknown>;
  getLatestAgentChange: (sessionId: string) => Promise<unknown>;
  getSettings: (sessionId: string, scope?: string) => Promise<Record<string, unknown>>;
  setSettings: (
    sessionId: string,
    settings: Record<string, unknown>,
    scope?: string,
  ) => Promise<void>;
  setSessionName: (sessionId: string, name: string) => Promise<void>;
  getLastAssistantText: (sessionId: string) => Promise<{ text: string | null }>;
}

export function createAgentClientApiAdapter<TManaged extends AgentApiManagedClient>(deps: {
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
  isClientAlive: (sessionId: string, managed: TManaged) => Promise<boolean>;
  cleanupDeadClient: (sessionId: string, reason: string) => void;
  resolveSessionPath: (sessionId: string) => string;
  buildMessagesFromJsonl: (
    entries: Array<{ id: string; parentId: string | null; type: string }>,
    leafId: string | null,
  ) => unknown[];
  leafIds: Map<string, string | null>;
  getSandboxUserId: (sessionId: string) => string | null;
  broadcastEvent: (eventName: string, payload: unknown, metadata?: unknown) => Promise<void>;
  getSessionCache?: (sessionId: string, sessionPath: string) => SessionCacheHit | null;
  setSessionCache?: (sessionId: string, sessionPath: string, data: SessionCacheData) => void;
}): AgentClientApiAdapter {
  const api: AgentClientApiAdapter = {
    getCommands(sessionId) {
      return getCommandsOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
    getSessionStats(sessionId) {
      return getSessionStatsOperation({
        sessionId,
        getActiveManaged: deps.getActiveManaged,
        isClientAlive: deps.isClientAlive,
        cleanupDeadClient: deps.cleanupDeadClient,
      });
    },
    getMessages(sessionId, sessionPath) {
      const sandboxManager = getSandboxManager();
      return getMessagesOperation({
        sessionId,
        sessionPath,
        getActiveManaged: deps.getActiveManaged,
        resolveSessionPath: deps.resolveSessionPath,
        readJsonlEntries: readJsonlTreeEntriesOperation,
        buildMessagesFromJsonl: deps.buildMessagesFromJsonl,
        leafIds: deps.leafIds,
        readSandboxFile: sandboxManager
          ? async (pathToRead) => {
              const userId = deps.getSandboxUserId(sessionId);
              return userId ? sandboxManager.execInSandbox(userId, `cat ${pathToRead}`) : "";
            }
          : undefined,
      });
    },
    getFullMessages(sessionId, sessionPath, options) {
      const sandboxManager = getSandboxManager();
      return getFullMessagesOperation({
        sessionId,
        sessionPath,
        pagination: options,
        getActiveManaged: deps.getActiveManaged,
        resolveSessionPath: deps.resolveSessionPath,
        leafIds: deps.leafIds,
        getSessionCache: deps.getSessionCache,
        setSessionCache: deps.setSessionCache,
        readSandboxFile: sandboxManager
          ? async (pathToRead) => {
              const userId = deps.getSandboxUserId(sessionId);
              return userId ? sandboxManager.execInSandbox(userId, `cat ${pathToRead}`) : "";
            }
          : undefined,
      });
    },
    getMessageNavPage(sessionId, sessionPath, options) {
      const sandboxManager = getSandboxManager();
      return getMessageNavPageOperation({
        sessionId,
        sessionPath,
        pagination: options,
        getActiveManaged: deps.getActiveManaged,
        resolveSessionPath: deps.resolveSessionPath,
        leafIds: deps.leafIds,
        getSessionCache: deps.getSessionCache,
        setSessionCache: deps.setSessionCache,
        readSandboxFile: sandboxManager
          ? async (pathToRead) => {
              const userId = deps.getSandboxUserId(sessionId);
              return userId ? sandboxManager.execInSandbox(userId, `cat ${pathToRead}`) : "";
            }
          : undefined,
      });
    },
    getFullMessagesAround(sessionId, sessionPath, options) {
      const sandboxManager = getSandboxManager();
      return getFullMessagesAroundOperation({
        sessionId,
        sessionPath,
        targetEntryId: options.targetEntryId,
        before: options.before,
        after: options.after,
        getActiveManaged: deps.getActiveManaged,
        resolveSessionPath: deps.resolveSessionPath,
        leafIds: deps.leafIds,
        getSessionCache: deps.getSessionCache,
        setSessionCache: deps.setSessionCache,
        readSandboxFile: sandboxManager
          ? async (pathToRead) => {
              const userId = deps.getSandboxUserId(sessionId);
              return userId ? sandboxManager.execInSandbox(userId, `cat ${pathToRead}`) : "";
            }
          : undefined,
      });
    },
    getAvailableModels(sessionId) {
      return getAvailableModelsOperation({
        sessionId,
        getActiveManaged: deps.getActiveManaged,
        ensureManagedClient: deps.ensureManagedClient,
        isClientAlive: deps.isClientAlive,
        cleanupDeadClient: deps.cleanupDeadClient,
      });
    },
    setModel(sessionId, provider, modelId) {
      return setModelOperation({
        sessionId,
        provider,
        modelId,
        getActiveManaged: deps.getActiveManaged,
        ensureManagedClient: deps.ensureManagedClient,
      });
    },
    switchTier(sessionId, tier) {
      return switchTierOperation({
        tier,
        getTierModels: () => api.getTierModels(sessionId),
        setModel: (provider, modelId) => api.setModel(sessionId, provider, modelId),
      });
    },
    cycleModel(sessionId) {
      return cycleModelOperation({
        sessionId,
        getActiveManaged: deps.getActiveManaged,
        ensureManagedClient: deps.ensureManagedClient,
      });
    },
    async setThinkingLevel(sessionId, level) {
      await setThinkingLevelOperation({
        sessionId,
        level,
        getActiveManaged: deps.getActiveManaged,
      });
    },
    cycleThinkingLevel(sessionId) {
      return cycleThinkingLevelOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
    compact(sessionId, customInstructions) {
      return compactOperation({
        sessionId,
        customInstructions,
        getActiveManaged: deps.getActiveManaged,
      });
    },
    async setAutoCompaction(sessionId, enabled) {
      await setAutoCompactionOperation({
        sessionId,
        enabled,
        getActiveManaged: deps.getActiveManaged,
      });
    },
    async setAutoRetry(sessionId, enabled) {
      await setAutoRetryOperation({ sessionId, enabled, getActiveManaged: deps.getActiveManaged });
    },
    async abortRetry(sessionId) {
      await abortRetryOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
    async setSteeringMode(sessionId, mode) {
      await setSteeringModeOperation({ sessionId, mode, getActiveManaged: deps.getActiveManaged });
    },
    async setFollowUpMode(sessionId, mode) {
      await setFollowUpModeOperation({ sessionId, mode, getActiveManaged: deps.getActiveManaged });
    },
    setPermissionMode(sessionId, mode) {
      return setPermissionModeOperation({
        sessionId,
        mode,
        getActiveManaged: deps.getActiveManaged,
        ensureManagedClient: deps.ensureManagedClient,
      });
    },
    getActiveTools(sessionId) {
      return getActiveToolsOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
    async setActiveTools(sessionId, toolNames) {
      await setActiveToolsOperation({
        sessionId,
        toolNames,
        getActiveManaged: deps.getActiveManaged,
      });
    },
    getQueue(sessionId) {
      return getQueueOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
    clearQueue(sessionId, item) {
      return clearQueueOperation({ sessionId, item, getActiveManaged: deps.getActiveManaged });
    },
    promoteQueuedFollowUp(sessionId, item) {
      return promoteQueuedFollowUpOperation({
        sessionId,
        item,
        getActiveManaged: deps.getActiveManaged,
      });
    },
    getExtensions(sessionId) {
      return getExtensionsOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
    getSkills(sessionId) {
      return getSkillsOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
    async reload(sessionId) {
      await reloadOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
    getTools(sessionId) {
      return getToolsOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
    getMcpServers(sessionId) {
      return getMcpServersOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
    toggleMcpServer(sessionId, name, enabled) {
      return toggleMcpServerOperation({
        sessionId,
        name,
        enabled,
        getActiveManaged: deps.getActiveManaged,
      });
    },
    restartMcpServer(sessionId, name) {
      return restartMcpServerOperation({
        sessionId,
        name,
        getActiveManaged: deps.getActiveManaged,
      });
    },
    getContextUsage(sessionId) {
      return getContextUsageOperation({
        sessionId,
        getActiveManaged: deps.getActiveManaged,
        ensureManagedClient: deps.ensureManagedClient,
        isClientAlive: deps.isClientAlive,
        cleanupDeadClient: deps.cleanupDeadClient,
      });
    },
    getTierModels(sessionId) {
      return getTierModelsOperation({
        sessionId,
        getActiveManaged: deps.getActiveManaged,
        ensureManagedClient: deps.ensureManagedClient,
      });
    },
    setTierModels(sessionId, models) {
      return setTierModelsOperation({ sessionId, models, getActiveManaged: deps.getActiveManaged });
    },
    getAgents(sessionId) {
      return getAgentsOperation({
        sessionId,
        getActiveManaged: deps.getActiveManaged,
        ensureManagedClient: deps.ensureManagedClient,
      });
    },
    switchAgent(sessionId, agentName) {
      return switchAgentOperation({
        sessionId,
        agentName,
        getActiveManaged: deps.getActiveManaged,
        ensureManagedClient: deps.ensureManagedClient,
      });
    },
    getCurrentAgent(sessionId) {
      return getCurrentAgentOperation({
        sessionId,
        getActiveManaged: deps.getActiveManaged,
        ensureManagedClient: deps.ensureManagedClient,
      });
    },
    async getAgentDetail(sessionId, agentName) {
      const managed = deps.getActiveManaged(sessionId);
      if (!managed) throw new Error("Client not found");
      return (
        managed.client as unknown as { getAgentDetail: (name: string) => Promise<unknown> }
      ).getAgentDetail(agentName);
    },
    async getAllTools(sessionId) {
      const managed = deps.getActiveManaged(sessionId);
      if (!managed) throw new Error("Client not found");
      return (managed.client as unknown as { getAllTools: () => Promise<unknown> }).getAllTools();
    },
    async getSystemPrompt(sessionId) {
      const managed = deps.getActiveManaged(sessionId);
      if (!managed) throw new Error(`No client for session ${sessionId}`);
      return (
        managed.client as unknown as { getSystemPrompt: () => Promise<unknown> }
      ).getSystemPrompt();
    },
    getLatestAgentChange(sessionId) {
      return getLatestAgentChangeOperation({
        sessionId,
        getActiveManaged: deps.getActiveManaged,
        ensureManagedClient: deps.ensureManagedClient,
      });
    },
    async getSettings(sessionId, scope) {
      const managed = deps.getActiveManaged(sessionId);
      if (!managed) return {};
      return managed.client
        .getSettings(scope as "global" | "project" | undefined)
        .then((settings) => settings as unknown as Record<string, unknown>)
        .catch((err: unknown) => {
          log.warn("getSettings error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
          return {};
        });
    },
    async setSettings(sessionId, settings, scope) {
      const managed = deps.getActiveManaged(sessionId);
      if (!managed) return;
      await managed.client
        .setSettings(settings, scope as "global" | "project" | undefined)
        .catch((err: unknown) => {
          log.warn("setSettings error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
    },
    async setSessionName(sessionId, name) {
      const managed = deps.getActiveManaged(sessionId);
      if (!managed) return;
      const projectPath = managed.info.projectPath;
      await managed.client.setSessionName(name).catch((err: unknown) => {
        log.warn("setSessionName error", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
      });
      deps
        .broadcastEvent("agent.session_renamed", { sessionId, projectPath, newName: name }, {})
        .catch((err: unknown) => {
          log.warn("broadcastEvent(session_renamed) error", {
            sessionId,
            err: err instanceof Error ? err.message : String(err),
          });
        });
    },
    getLastAssistantText(sessionId) {
      return getLastAssistantTextOperation({ sessionId, getActiveManaged: deps.getActiveManaged });
    },
  };

  return api;
}
