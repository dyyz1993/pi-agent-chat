import { create } from "zustand";
import { useSessionStore } from "./use-session-store";
import { useChatStore } from "./use-chat-store";
import { useTurnStore } from "./use-turn-store";
import { useChatNavStore } from "./use-chat-nav-store";
import { useMemoryStore } from "./use-memory-store";
import { useRulesStore } from "./use-rules-store";
import { useRpcDebugStore } from "./use-rpc-debug-store";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("system");

export interface SubscriptionSnapshot {
  category: string;
  total: number;
  bySession: Array<{ sessionId: string; subIds: string[] }>;
}

export interface DataSizeSnapshot {
  store: string;
  sessionsWithData: number;
  totalItems: number;
  estimatedBytes: number;
  details: Array<{
    sessionId: string;
    items: number;
    bytes: number;
  }>;
}

export interface DiagnosticSnapshot {
  timestamp: number;
  activeSessionId: string | null;
  activeProjectId: string | null;
  projectTabs: number;
  totalSessions: number;
  subscriptions: SubscriptionSnapshot[];
  dataSizes: DataSizeSnapshot[];
  rpcDebugEntries: number;
  toolCallNameMapSize: number;
  jsHeapUsed?: number;
  jsHeapTotal?: number;
  history: DiagnosticSnapshot[];
}

const MAX_HISTORY = 60;

function getSubscriptions(): SubscriptionSnapshot[] {
  const s = useSessionStore.getState();
  const categories: Array<{
    category: string;
    map: Record<string, string | string[]>;
  }> = [
    { category: "agent", map: s.agentSubscriptions },
    { category: "subagent", map: s.subagentSubscriptions },
    { category: "todo", map: s.todoSubscriptions },
    { category: "bash", map: s.bashSubscriptions },
    { category: "lsp", map: s.lspSubscriptions },
    { category: "rules", map: s.rulesSubscriptions },
    { category: "notify", map: s.notifySubscriptions },
    { category: "memory", map: s.memorySubscriptions },
  ];

  return categories.map(({ category, map }) => {
    const bySession: Array<{ sessionId: string; subIds: string[] }> = [];
    let total = 0;
    for (const [sessionId, val] of Object.entries(map)) {
      const subIds = Array.isArray(val) ? val : val ? [val as string] : [];
      if (subIds.length > 0) {
        bySession.push({ sessionId: sessionId.slice(0, 8), subIds });
        total += subIds.length;
      }
    }
    return { category, total, bySession };
  });
}

function estimateBytes(obj: unknown): number {
  try {
    return JSON.stringify(obj).length * 2;
  } catch (e) {
    log.warn("Failed to estimate object bytes", { error: String(e) });
    return 0;
  }
}

function getDataSizes(): DataSizeSnapshot[] {
  const results: DataSizeSnapshot[] = [];

  const chatState = useChatStore.getState();
  {
    const details: DataSizeSnapshot["details"] = [];
    let totalItems = 0;
    let estimatedBytes = 0;
    for (const [sid, msgs] of Object.entries(chatState.messagesBySession)) {
      const items = msgs.length;
      const bytes = estimateBytes(msgs);
      totalItems += items;
      estimatedBytes += bytes;
      details.push({ sessionId: sid.slice(0, 8), items, bytes });
    }
    results.push({
      store: "chat.messagesBySession",
      sessionsWithData: Object.keys(chatState.messagesBySession).length,
      totalItems,
      estimatedBytes,
      details,
    });
  }

  const sessionState = useSessionStore.getState();
  {
    const todos = sessionState.todosBySession;
    const details: DataSizeSnapshot["details"] = [];
    let totalItems = 0;
    let estimatedBytes = 0;
    for (const [sid, list] of Object.entries(todos)) {
      const items = list.length;
      const bytes = estimateBytes(list);
      totalItems += items;
      estimatedBytes += bytes;
      details.push({ sessionId: sid.slice(0, 8), items, bytes });
    }
    results.push({
      store: "session.todosBySession",
      sessionsWithData: Object.keys(todos).length,
      totalItems,
      estimatedBytes,
      details,
    });
  }

  {
    const ctx = sessionState.sessionContextMap;
    results.push({
      store: "session.sessionContextMap",
      sessionsWithData: Object.keys(ctx).length,
      totalItems: Object.keys(ctx).length,
      estimatedBytes: estimateBytes(ctx),
      details: Object.entries(ctx).map(([sid]) => ({
        sessionId: sid.slice(0, 8),
        items: 1,
        bytes: 100,
      })),
    });
  }

  {
    const status = sessionState.sessionStatusMap;
    results.push({
      store: "session.sessionStatusMap",
      sessionsWithData: Object.keys(status).length,
      totalItems: Object.keys(status).length,
      estimatedBytes: estimateBytes(status),
      details: Object.entries(status).map(([sid]) => ({
        sessionId: sid.slice(0, 8),
        items: 1,
        bytes: 20,
      })),
    });
  }

  const memState = useMemoryStore.getState();
  {
    const details: DataSizeSnapshot["details"] = [];
    let totalItems = 0;
    let estimatedBytes = 0;
    for (const sid of Object.keys(memState.eventsBySession || {})) {
      const events = memState.eventsBySession?.[sid] || [];
      const items = events.length;
      const bytes = estimateBytes(events);
      totalItems += items;
      estimatedBytes += bytes;
      details.push({ sessionId: sid.slice(0, 8), items, bytes });
    }
    results.push({
      store: "memory.eventsBySession",
      sessionsWithData: Object.keys(memState.eventsBySession || {}).length,
      totalItems,
      estimatedBytes,
      details,
    });
  }

  const rulesState = useRulesStore.getState();
  {
    const details: DataSizeSnapshot["details"] = [];
    let totalItems = 0;
    let estimatedBytes = 0;
    for (const sid of Object.keys(rulesState.bySession || {})) {
      const data = rulesState.bySession?.[sid];
      const items = data?.totalRules ?? 0;
      const bytes = estimateBytes(data);
      totalItems += items;
      estimatedBytes += bytes;
      details.push({ sessionId: sid.slice(0, 8), items, bytes });
    }
    results.push({
      store: "rules.bySession",
      sessionsWithData: Object.keys(rulesState.bySession || {}).length,
      totalItems,
      estimatedBytes,
      details,
    });
  }

  const turnState = useTurnStore.getState();
  {
    results.push({
      store: "turn.selectedMessageIds",
      sessionsWithData: Object.keys(turnState.selectedMessageIdsBySession).length,
      totalItems: Object.values(turnState.selectedMessageIdsBySession).reduce(
        (sum, set) => sum + set.size,
        0,
      ),
      estimatedBytes: 0,
      details: Object.entries(turnState.selectedMessageIdsBySession).map(([sid, set]) => ({
        sessionId: sid.slice(0, 8),
        items: set.size,
        bytes: set.size * 80,
      })),
    });
  }

  const navState = useChatNavStore.getState();
  {
    results.push({
      store: "chatNav (all sub-maps)",
      sessionsWithData: Object.keys(navState.activeIdBySession).length,
      totalItems:
        Object.keys(navState.activeIdBySession).length +
        Object.keys(navState.selectedItemsBySession).length +
        Object.keys(navState.collapsedTurnsBySession).length,
      estimatedBytes: 0,
      details: [],
    });
  }

  return results;
}

interface DiagnosticState {
  open: boolean;
  snapshot: DiagnosticSnapshot | null;
  autoRefresh: boolean;
  refreshIntervalMs: number;
  history: DiagnosticSnapshot[];
  toggle: () => void;
  setOpen: (v: boolean) => void;
  takeSnapshot: () => void;
  setAutoRefresh: (v: boolean) => void;
  setRefreshInterval: (ms: number) => void;
  clearHistory: () => void;
}

export const useDiagnosticStore = create<DiagnosticState>((set, get) => ({
  open: false,
  snapshot: null,
  autoRefresh: true,
  refreshIntervalMs: 2000,
  history: [],

  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (v) => set({ open: v }),

  takeSnapshot: () => {
    const sessionState = useSessionStore.getState();
    const prevHistory = get().history || [];

    const snap: DiagnosticSnapshot = {
      timestamp: Date.now(),
      activeSessionId: sessionState.activeSessionId?.slice(0, 8) ?? null,
      activeProjectId: sessionState.activeProjectId?.slice(0, 8) ?? null,
      projectTabs: sessionState.projectTabs.length,
      totalSessions: Object.values(sessionState.sessionsByProject).reduce(
        (sum, arr) => sum + arr.length,
        0,
      ),
      subscriptions: getSubscriptions(),
      dataSizes: getDataSizes(),
      rpcDebugEntries: useRpcDebugStore.getState().entries.length,
      toolCallNameMapSize: Object.keys(
        (window as unknown as Record<string, unknown>).__toolCallNameMap ?? {},
      ).length,
      jsHeapUsed: (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize,
      jsHeapTotal: (performance as unknown as { memory?: { totalJSHeapSize: number } }).memory
        ?.totalJSHeapSize,
      history: [],
    };

    set({
      snapshot: snap,
      history: [...prevHistory, { ...snap, history: [] }].slice(-MAX_HISTORY),
    });
  },

  setAutoRefresh: (v) => set({ autoRefresh: v }),
  setRefreshInterval: (ms) => set({ refreshIntervalMs: ms }),
  clearHistory: () => set({ history: [] }),
}));
