import { create } from "zustand";
import type { BatchAction } from "../types";
import { useSessionStore } from "./use-session-store";

const EMPTY_SET: ReadonlySet<string> = new Set<string>();

interface ChatNavState {
  activeIdBySession: Record<string, string | null>;
  setActive: (id: string | null) => void;

  selectedItemsBySession: Record<string, Set<string>>;
  toggleItemSelect: (itemId: string) => void;
  selectItemRange: (fromId: string, toId: string) => void;
  isItemSelected: (itemId: string) => boolean;

  selectedTurnsBySession: Record<string, Set<string>>;
  toggleTurnSelect: (turnId: string, allItemIds: string[]) => void;
  isTurnSelected: (turnId: string) => boolean;

  clearSelection: () => void;
  getSelectedCount: () => number;
  hasSelection: () => boolean;

  batchModeBySession: Record<string, boolean>;
  setBatchMode: (v: boolean) => void;
  pendingActionBySession: Record<string, BatchAction | null>;
  setPendingAction: (action: BatchAction | null) => void;

  collapsedTurnsBySession: Record<string, Set<string> | "all">;
  toggleTurnCollapse: (turnId: string) => void;
  isTurnCollapsed: (turnId: string) => boolean;
  collapseAll: () => void;
  expandAll: () => void;

  rollbackOverlayOpen: boolean;
  rollbackOverlayType: "code" | "chat" | null;
  rollbackTargetItemId: string | null;
  openRollbackOverlay: (type: "code" | "chat", targetItemId?: string) => void;
  closeRollbackOverlay: () => void;

  clearSessionUI: (sessionId: string) => void;
}

export const useChatNavStore = create<ChatNavState>((set, get) => ({
  activeIdBySession: {},
  setActive: (id) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => ({
      activeIdBySession: { ...s.activeIdBySession, [sessionId]: id },
    }));
  },

  selectedItemsBySession: {},
  toggleItemSelect: (itemId) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const prev = s.selectedItemsBySession[sessionId] ?? EMPTY_SET;
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return {
        selectedItemsBySession: { ...s.selectedItemsBySession, [sessionId]: next },
        batchModeBySession: { ...s.batchModeBySession, [sessionId]: next.size > 0 },
      };
    });
  },
  selectItemRange: (fromId, toId) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const prev = s.selectedItemsBySession[sessionId] ?? EMPTY_SET;
      const next = new Set(prev);
      next.add(fromId);
      next.add(toId);
      return {
        selectedItemsBySession: { ...s.selectedItemsBySession, [sessionId]: next },
        batchModeBySession: { ...s.batchModeBySession, [sessionId]: true },
      };
    });
  },
  isItemSelected: (itemId) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return false;
    return (get().selectedItemsBySession[sessionId] ?? EMPTY_SET).has(itemId);
  },

  selectedTurnsBySession: {},
  toggleTurnSelect: (turnId, allItemIds) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const prevItems = s.selectedItemsBySession[sessionId] ?? EMPTY_SET;
      const prevTurns = s.selectedTurnsBySession[sessionId] ?? EMPTY_SET;
      const nextItems = new Set(prevItems);
      const nextTurns = new Set(prevTurns);

      if (nextTurns.has(turnId)) {
        nextTurns.delete(turnId);
        for (const id of allItemIds) nextItems.delete(id);
      } else {
        nextTurns.add(turnId);
        for (const id of allItemIds) nextItems.add(id);
      }

      return {
        selectedItemsBySession: { ...s.selectedItemsBySession, [sessionId]: nextItems },
        selectedTurnsBySession: { ...s.selectedTurnsBySession, [sessionId]: nextTurns },
        batchModeBySession: { ...s.batchModeBySession, [sessionId]: nextItems.size > 0 },
      };
    });
  },
  isTurnSelected: (turnId) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return false;
    return (get().selectedTurnsBySession[sessionId] ?? EMPTY_SET).has(turnId);
  },

  clearSelection: () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const { [sessionId]: _i, ...restItems } = s.selectedItemsBySession;
      const { [sessionId]: _t, ...restTurns } = s.selectedTurnsBySession;
      return {
        selectedItemsBySession: restItems,
        selectedTurnsBySession: restTurns,
        batchModeBySession: { ...s.batchModeBySession, [sessionId]: false },
        pendingActionBySession: { ...s.pendingActionBySession, [sessionId]: null },
      };
    });
  },
  getSelectedCount: () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return 0;
    return (get().selectedItemsBySession[sessionId] ?? EMPTY_SET).size;
  },
  hasSelection: () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return false;
    return (get().selectedItemsBySession[sessionId] ?? EMPTY_SET).size > 0;
  },

  batchModeBySession: {},
  setBatchMode: (v) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => ({
      batchModeBySession: { ...s.batchModeBySession, [sessionId]: v },
    }));
  },
  pendingActionBySession: {},
  setPendingAction: (action) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => ({
      pendingActionBySession: { ...s.pendingActionBySession, [sessionId]: action },
    }));
  },

  collapsedTurnsBySession: {},
  toggleTurnCollapse: (turnId) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const prev = s.collapsedTurnsBySession[sessionId] ?? EMPTY_SET;
      const next = new Set(prev);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return {
        collapsedTurnsBySession: { ...s.collapsedTurnsBySession, [sessionId]: next },
      };
    });
  },
  isTurnCollapsed: (turnId) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return false;
    const collapsed = get().collapsedTurnsBySession[sessionId];
    if (collapsed === "all") return true;
    return (collapsed ?? EMPTY_SET).has(turnId);
  },
  collapseAll: () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => ({
      collapsedTurnsBySession: { ...s.collapsedTurnsBySession, [sessionId]: "all" as const },
    }));
  },
  expandAll: () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => ({
      collapsedTurnsBySession: { ...s.collapsedTurnsBySession, [sessionId]: new Set() },
    }));
  },

  rollbackOverlayOpen: false,
  rollbackOverlayType: null,
  rollbackTargetItemId: null,
  openRollbackOverlay: (type, targetItemId) =>
    set({
      rollbackOverlayOpen: true,
      rollbackOverlayType: type,
      rollbackTargetItemId: targetItemId ?? null,
    }),
  closeRollbackOverlay: () =>
    set({
      rollbackOverlayOpen: false,
      rollbackOverlayType: null,
      rollbackTargetItemId: null,
    }),

  clearSessionUI: (sessionId) =>
    set((s) => {
      const { [sessionId]: _a, ...restActive } = s.activeIdBySession;
      const { [sessionId]: _i, ...restItems } = s.selectedItemsBySession;
      const { [sessionId]: _t, ...restTurns } = s.selectedTurnsBySession;
      const { [sessionId]: _b, ...restBatch } = s.batchModeBySession;
      const { [sessionId]: _c, ...restCollapsed } = s.collapsedTurnsBySession;
      const { [sessionId]: _p, ...restPending } = s.pendingActionBySession;
      return {
        activeIdBySession: restActive,
        selectedItemsBySession: restItems,
        selectedTurnsBySession: restTurns,
        batchModeBySession: restBatch,
        collapsedTurnsBySession: restCollapsed,
        pendingActionBySession: restPending,
      };
    }),
}));
