import type { SessionMeta, ProjectTab } from "../types";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";
import { useChatStore } from "./use-chat-store";
import { useSubagentStore, handleSubagentEvent } from "./use-subagent-store";
import { useBashStore, handleBashEvent } from "./use-bash-store";
import { useLspStore } from "./use-lsp-store";
import { useRulesStore } from "./use-rules-store";
import { useMemoryStore } from "./use-memory-store";
import { useTurnStore } from "./use-turn-store";
import { useChatNavStore } from "./use-chat-nav-store";
import { handleAgentEvent, toolCallNameMap } from "./agent-event-handler";
import { notificationGateway } from "../lib/notification-gateway";
import { useAppStore } from "./use-app-store";

export interface SubscriptionMaps {
  agentSubscriptions: Record<string, string>;
  subagentSubscriptions: Record<string, string>;
  todoSubscriptions: Record<string, string>;
  bashSubscriptions: Record<string, string>;
  lspSubscriptions: Record<string, string>;
  rulesSubscriptions: Record<string, string>;
  notifySubscriptions: Record<string, string>;
  memorySubscriptions: Record<string, string[]>;
}

export type TodoPriority = "high" | "medium" | "low";

export interface TodoItem {
  id: number;
  text: string;
  done: boolean;
  priority?: TodoPriority;
  deleted?: boolean;
}

export function setupSubscriptions(
  state: SubscriptionMaps & { projectTabs: ProjectTab[]; activeProjectId: string | null },
  set: (fn: (s: SubscriptionMaps) => Partial<SubscriptionMaps>) => void,
  id: string,
  session: SessionMeta,
): void {
  const { agentSubscriptions, subagentSubscriptions, todoSubscriptions, bashSubscriptions, lspSubscriptions, rulesSubscriptions, notifySubscriptions, memorySubscriptions } = state;
  const storeGet = () => useSessionStore.getState();

  if (!agentSubscriptions[id]) {
    apiClient.subscribe("agent.event", (payload) => {
      if (payload.sessionId !== id) return;
      handleAgentEvent(id, payload.event);
    }).then((subId) => {
      set((s) => ({
        agentSubscriptions: { ...s.agentSubscriptions, [id]: subId },
      }));
      apiClient.call("rules.requestSnapshot", { sessionId: id }).then((result) => {
        const current = useRulesStore.getState().bySession[id];
        if (result.totalRules === 0 && current && current.totalRules > 0) return;
        useRulesStore.getState().handleRulesEvent(id, { type: "snapshot", rules: result.rules, totalRules: result.totalRules, unconditionalCount: result.unconditionalCount, conditionalCount: result.conditionalCount, injectedRuleNames: [], matchHistory: [], lifecycleLog: [], loadedAt: Date.now(), cacheTTL: 0 });
      }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
    }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
  }

  if (!subagentSubscriptions[id]) {
      apiClient.subscribe(
        "subagent.event",
        (payload) => {
          if (payload.parentSessionId !== id) return;

          const subStore = useSubagentStore.getState();
          const sid = payload.subSessionId;
          const path = payload.parentSessionPath || session.sessionPath;
          const eventType = payload.event.type;

          if (eventType === "subagent_start") {
            const evt = payload.event as { type: "subagent_start"; description: string; instruction: string; toolCallId?: string };
            subStore.upsertLiveSubagent(path, sid, {
              sessionId: sid,
              toolCallId: evt.toolCallId,
              description: evt.description,
              instruction: evt.instruction,
              startedAt: Date.now(),
            });
            return;
          }

        const existing = subStore.subsessionsByParent[path] || [];
        if (!existing.find((s) => s.sessionId === sid)) {
          subStore.upsertLiveSubagent(path, sid, {
            sessionId: sid,
            startedAt: Date.now(),
          });
        }

        handleSubagentEvent(sid, payload.event as Parameters<typeof handleSubagentEvent>[1], id);

        if (eventType === "agent_end") {
          subStore.upsertLiveSubagent(path, sid, {
            completedAt: Date.now(),
            exitCode: 0,
          });
        }
      },
      { parentSessionId: id },
    ).then((subId) => {
      set((s) => ({
        subagentSubscriptions: { ...s.subagentSubscriptions, [id]: subId },
      }));
    }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
  }

  if (!todoSubscriptions[id]) {
    apiClient.subscribe(
      "todo.event",
      (payload: { sessionId: string; action: string; todos: TodoItem[]; timestamp: number }) => {
        if (payload.sessionId !== id) return;
        storeGet().setSessionTodos(id, payload.todos);
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        todoSubscriptions: { ...s.todoSubscriptions, [id]: subId },
      }));
      apiClient.call("todo.list", { sessionPath: session.sessionPath }).then((result) => {
        if (result.todos.length > 0) {
          storeGet().setSessionTodos(id, result.todos);
        }
      }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
    }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
  }

  if (!bashSubscriptions[id]) {
    apiClient.subscribe(
      "bash.event",
      (payload: { sessionId: string; event: import("../../shared/modules/bash").BashChannelEvent }) => {
        if (payload.sessionId !== id) return;
        handleBashEvent(id, payload.event);
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        bashSubscriptions: { ...s.bashSubscriptions, [id]: subId },
      }));
      useBashStore.getState().loadHistory(id).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
    }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
  }

  if (!lspSubscriptions[id]) {
    apiClient.subscribe(
      "lsp.event",
      (payload: { sessionId: string; event: import("../../shared/modules/lsp").LspChannelEvent }) => {
        if (payload.sessionId !== id) return;
        useLspStore.getState().handleLspEvent(id, payload.event);
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        lspSubscriptions: { ...s.lspSubscriptions, [id]: subId },
      }));
      useLspStore.getState().loadHistory(session.sessionPath, id).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
    }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
  }

  if (!rulesSubscriptions[id]) {
    apiClient.subscribe(
      "rules.event",
      (payload: { sessionId: string; event: import("../../shared/modules/rules").RulesChannelEvent }) => {
        if (payload.sessionId !== id) return;
        useRulesStore.getState().handleRulesEvent(id, payload.event);
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        rulesSubscriptions: { ...s.rulesSubscriptions, [id]: subId },
      }));
      const store = useRulesStore.getState();
      const sessionState = store.bySession[id];
      if (!sessionState || sessionState.totalRules === 0) {
        apiClient.call("rules.requestSnapshot", { sessionId: id }).then((result) => {
          useRulesStore.getState().handleRulesEvent(id, { type: "snapshot", rules: result.rules, totalRules: result.totalRules, unconditionalCount: result.unconditionalCount, conditionalCount: result.conditionalCount, injectedRuleNames: [], matchHistory: [], lifecycleLog: [], loadedAt: Date.now(), cacheTTL: 0 });
        }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
      }
    }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
  }

  if (!notifySubscriptions[id]) {
    apiClient.subscribe(
      "agent.notify",
      (payload: { sessionId: string; message: string; notifyType: "info" | "warning" | "error" }) => {
        if (payload.sessionId !== id) return;

        notificationGateway.emit({
          type: "agent_notify",
          sessionId: payload.sessionId,
          title: payload.message,
          body: "",
          level: payload.notifyType,
        });
      },
      { sessionId: id },
    ).then((subId) => {
      set((s) => ({
        notifySubscriptions: { ...s.notifySubscriptions, [id]: subId },
      }));
    }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
  }

  if (!memorySubscriptions[id] || memorySubscriptions[id].length === 0) {
    const projectTab = useSessionStore.getState().projectTabs.find((t) => t.id === useSessionStore.getState().activeProjectId);
    const memorySubIds: string[] = [];

    function trackSub(promise: Promise<string>) {
      promise.then((subId) => {
        memorySubIds.push(subId);
        set((s) => ({
          memorySubscriptions: { ...s.memorySubscriptions, [id]: [...memorySubIds] },
        }));
      }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
    }

    trackSub(apiClient.subscribe(
      "memory.bookmark_creating",
      (payload: { sessionId: string; timestamp: number }) => {
        if (payload.sessionId !== id) return;
        const memStore = useMemoryStore.getState();
        memStore.addEvent(id, {
          id: `mem-creating-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          customType: "bookmark_creating",
          data: payload,
          timestamp: payload.timestamp || Date.now(),
        });
        memStore.setBookmarkCreating(id, true);

      },
      { sessionId: id },
    ));

    trackSub(apiClient.subscribe(
      "memory.updated",
      (payload: { sessionId: string; files: Array<{ filename: string; filePath: string; description: string | null; type: string | null; mtimeMs: number }>; timestamp: number }) => {
        if (payload.sessionId !== id) return;
        const memStore = useMemoryStore.getState();
        memStore.addEvent(id, {
          id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          customType: "memory_updated",
          data: payload,
          timestamp: payload.timestamp,
        });
        memStore.setBookmarkCreating(id, false);
        if (projectTab) {
          memStore.loadFiles(projectTab.path, id);
        }

      },
      { sessionId: id },
    ));

    trackSub(apiClient.subscribe(
      "memory.update_failed",
      (payload: { sessionId: string; reason: string; timestamp: number }) => {
        if (payload.sessionId !== id) return;
        const memStore = useMemoryStore.getState();
        memStore.addEvent(id, {
          id: `mem-fail-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          customType: "memory_update_failed",
          data: payload,
          timestamp: payload.timestamp,
        });
        memStore.setBookmarkCreating(id, false);

      },
      { sessionId: id },
    ));

    const MEMORY_OPERATION_EVENTS = [
      "memory.memory_prefetch",
      "memory.memory_prefetch_result",
      "memory.memory_extract",
      "memory.memory_extract_result",
      "memory.memory_dream",
      "memory.memory_dream_result",
    ] as const;

    for (const eventName of MEMORY_OPERATION_EVENTS) {
      trackSub(apiClient.subscribe(
        eventName,
        (payload) => {
          if (payload.sessionId !== id) return;
          const customType = eventName.replace("memory.", "");
          const timestamp = payload.timestamp || Date.now();
          const eventData = (({ sessionId: _s, timestamp: _t, ...rest }) => rest)(payload);

          const memStore = useMemoryStore.getState();
          memStore.addEvent(id, {
            id: `mem-${customType}-${timestamp}-${Math.random().toString(36).slice(2, 8)}`,
            customType,
            data: eventData,
            timestamp,
          });

          if (customType === "memory_prefetch_result") {
            const data = eventData as { summary?: string; snippet?: string };
            if (data) {
              memStore.addInjected(id, {
                summary: data.summary || "",
                snippet: data.snippet || "",
              });
            }
          }

        },
        { sessionId: id },
      ));
    }
  }
}

export function cleanupSession(state: SubscriptionMaps, sessionId: string): void {
  const singleSubMaps: Array<Record<string, string>> = [
    state.agentSubscriptions,
    state.subagentSubscriptions,
    state.todoSubscriptions,
    state.bashSubscriptions,
    state.lspSubscriptions,
    state.rulesSubscriptions,
    state.notifySubscriptions,
  ];

  for (const map of singleSubMaps) {
    const subId = map[sessionId];
    if (subId) apiClient.unsubscribe(subId);
  }

  const memSubIds = state.memorySubscriptions[sessionId];
  if (Array.isArray(memSubIds)) {
    for (const subId of memSubIds) {
      if (subId) apiClient.unsubscribe(subId);
    }
  }

  const msgs = useChatStore.getState().messagesBySession[sessionId] || [];
  for (const msg of msgs) {
    if (msg.role === "assistant") {
      for (const block of msg.content) {
        if (block.type === "toolExecution") {
          delete toolCallNameMap[block.toolCallId];
        }
      }
    }
  }
}

export function cleanupSessionData(sessionId: string): void {
  useChatStore.getState().clearSessionMessages(sessionId);
  useTurnStore.getState().clearSessionUI(sessionId);
  useChatNavStore.getState().clearSessionUI(sessionId);
  useMemoryStore.getState().clearSession(sessionId);
  useRulesStore.getState().clearSession(sessionId);
  useBashStore.getState().clearSession(sessionId);
  useLspStore.getState().clearSession(sessionId);
  useSubagentStore.getState().setActiveSubsession(sessionId, null);
}

export function clearSubscriptionState(state: SubscriptionMaps & { sessionReady: Record<string, boolean> }, sessionId: string): Partial<SubscriptionMaps & { sessionReady: Record<string, boolean> }> {
  const { [sessionId]: _a, ...restAgent } = state.agentSubscriptions;
  const { [sessionId]: _b, ...restSubagent } = state.subagentSubscriptions;
  const { [sessionId]: _c, ...restTodo } = state.todoSubscriptions;
  const { [sessionId]: _d, ...restBash } = state.bashSubscriptions;
  const { [sessionId]: _e, ...restLsp } = state.lspSubscriptions;
  const { [sessionId]: _f, ...restRules } = state.rulesSubscriptions;
  const { [sessionId]: _g, ...restNotify } = state.notifySubscriptions;
  const { [sessionId]: _h, ...restMemory } = state.memorySubscriptions;
  const { [sessionId]: _i, ...restReady } = state.sessionReady;
  return {
    agentSubscriptions: restAgent,
    subagentSubscriptions: restSubagent,
    todoSubscriptions: restTodo,
    bashSubscriptions: restBash,
    lspSubscriptions: restLsp,
    rulesSubscriptions: restRules,
    notifySubscriptions: restNotify,
    memorySubscriptions: restMemory,
    sessionReady: restReady,
  };
}

export function syncTabsToBackend(tabs: ProjectTab[], activeTabId: string | null) {
  const persistTabs = tabs.map((t) => ({ id: t.id, name: t.name, path: t.path }));
  apiClient.call("project.syncTabs", { tabs: persistTabs, activeTabId }).catch((err) => { useAppStore.getState().addLog(`[sub] ${String(err)}`); });
}
