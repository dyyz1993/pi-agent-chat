import type { AgentEvent, ChannelDataEvent } from "../modules/agent";
import type { SanitizedEvent } from "./hold-events";
import type { CachedLspState } from "./agent-channel-state";
import { handleAgentEventOperation } from "./agent-event-routing";
import {
  handleBashChannelDataOperation,
  handleLearningChannelDataOperation,
  handleLspChannelDataOperation,
  handleMemoryChannelDataOperation,
  handleRulesChannelDataOperation,
  handleSubagentChannelDataOperation,
  handleTodoChannelDataOperation,
  handleIssueMonitorChannelDataOperation,
} from "./agent-channel-handlers";
import type { DelegateChildMap, SyncDelegateResolver } from "./coordinator-session-state";

interface ChannelManagedClient {
  client?: {
    getTreeWithLeaf(): Promise<{ entries: unknown[]; leafId: string | null }>;
  };
  info: {
    status: string;
    projectPath: string;
    sessionPath: string;
  };
  lastActiveAt: number;
  activeBackgroundTools: Set<string>;
}

export interface AgentChannelHandlerAdapter {
  handleEvent: (sessionId: string, event: AgentEvent) => void;
  handleSubagentChannelData: (
    parentSessionId: string,
    channelMsg: ChannelDataEvent,
  ) => Promise<void>;
  handleTodoChannelData: (sessionId: string, channelMsg: ChannelDataEvent) => Promise<void>;
  handleBashChannelData: (sessionId: string, channelMsg: ChannelDataEvent) => Promise<void>;
  handleLspChannelData: (sessionId: string, channelMsg: ChannelDataEvent) => Promise<void>;
  handleRulesChannelData: (sessionId: string, channelMsg: ChannelDataEvent) => Promise<void>;
  handleMemoryChannelData: (sessionId: string, channelMsg: ChannelDataEvent) => Promise<void>;
  handleLearningChannelData: (sessionId: string, channelMsg: ChannelDataEvent) => Promise<void>;
  handleIssueMonitorChannelData: (sessionId: string, channelMsg: ChannelDataEvent) => Promise<void>;
}

export function createAgentChannelHandlerAdapter<TManaged extends ChannelManagedClient>(deps: {
  clients: Map<string, TManaged>;
  parentChildMap: DelegateChildMap;
  leafIds: Map<string, string | null>;
  syncDelegateResolvers: Map<string, SyncDelegateResolver>;
  subagentSyncChildren: Set<string>;
  syncDelegateLastText: Map<string, string>;
  sandboxEnabled: boolean;
  getActiveManaged: (sessionId: string) => TManaged | null;
  getCachedLspState: (sessionId: string) => CachedLspState | undefined;
  setCachedLspState: (sessionId: string, state: CachedLspState) => void;
  broadcastEvent: (eventName: string, payload: unknown, metadata?: unknown) => Promise<void>;
  broadcastSessionStatus: (sessionId: string, status: string) => void;
  emitAgentEvent: (sessionId: string, event: SanitizedEvent) => Promise<void>;
}): AgentChannelHandlerAdapter {
  const adapter: AgentChannelHandlerAdapter = {
    handleEvent(sessionId, event) {
      handleAgentEventOperation({
        sessionId,
        event,
        getActiveManaged: deps.getActiveManaged,
        clients: deps.clients,
        parentChildMap: deps.parentChildMap,
        leafIds: deps.leafIds,
        syncDelegateResolvers: deps.syncDelegateResolvers,
        subagentSyncChildren: deps.subagentSyncChildren,
        syncDelegateLastText: deps.syncDelegateLastText,
        sandboxEnabled: deps.sandboxEnabled,
        broadcastEvent: deps.broadcastEvent,
        broadcastSessionStatus: deps.broadcastSessionStatus,
        emitAgentEvent: deps.emitAgentEvent,
        handleSubagentChannelData: adapter.handleSubagentChannelData,
        handleTodoChannelData: adapter.handleTodoChannelData,
        handleBashChannelData: adapter.handleBashChannelData,
        handleLspChannelData: adapter.handleLspChannelData,
        handleRulesChannelData: adapter.handleRulesChannelData,
        handleMemoryChannelData: adapter.handleMemoryChannelData,
        handleLearningChannelData: adapter.handleLearningChannelData,
        handleIssueMonitorChannelData: adapter.handleIssueMonitorChannelData,
      });
    },
    async handleSubagentChannelData(parentSessionId, channelMsg) {
      await handleSubagentChannelDataOperation({
        parentSessionId,
        channelMsg,
        getManagedState: (id) => {
          const managed = deps.clients.get(id);
          if (!managed) return null;
          return {
            sessionPath: managed.info.sessionPath,
            activeBackgroundTools: managed.activeBackgroundTools,
          };
        },
        broadcastEvent: deps.broadcastEvent,
      });
    },
    async handleTodoChannelData(sessionId, channelMsg) {
      await handleTodoChannelDataOperation({
        sessionId,
        channelMsg,
        broadcastEvent: deps.broadcastEvent,
      });
    },
    async handleBashChannelData(sessionId, channelMsg) {
      await handleBashChannelDataOperation({
        sessionId,
        channelMsg,
        getManagedState: (id) => {
          const managed = deps.clients.get(id);
          if (!managed) return null;
          return {
            sessionPath: managed.info.sessionPath,
            activeBackgroundTools: managed.activeBackgroundTools,
          };
        },
        broadcastEvent: deps.broadcastEvent,
      });
    },
    async handleLspChannelData(sessionId, channelMsg) {
      await handleLspChannelDataOperation({
        sessionId,
        channelMsg,
        getCachedState: deps.getCachedLspState,
        setCachedState: deps.setCachedLspState,
      });
    },
    async handleRulesChannelData(sessionId, channelMsg) {
      await handleRulesChannelDataOperation({
        sessionId,
        channelMsg,
        broadcastEvent: deps.broadcastEvent,
      });
    },
    async handleMemoryChannelData(sessionId, channelMsg) {
      await handleMemoryChannelDataOperation({
        sessionId,
        channelMsg,
        broadcastEvent: deps.broadcastEvent,
      });
    },
    async handleLearningChannelData(sessionId, channelMsg) {
      await handleLearningChannelDataOperation({
        sessionId,
        channelMsg,
        broadcastEvent: deps.broadcastEvent,
      });
    },
    async handleIssueMonitorChannelData(sessionId, channelMsg) {
      await handleIssueMonitorChannelDataOperation({
        sessionId,
        channelMsg,
        broadcastEvent: deps.broadcastEvent,
      });
    },
  };

  return adapter;
}
