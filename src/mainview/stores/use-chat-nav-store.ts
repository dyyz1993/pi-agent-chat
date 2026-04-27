import { create } from "zustand";
import type { BatchAction } from "../types";

interface ChatNavState {
  // Navigation
  activeId: string | null;
  setActive: (id: string | null) => void;

  // Item-level selection (per-item checkboxes)
  selectedItems: Set<string>;
  toggleItemSelect: (itemId: string) => void;
  selectItemRange: (fromId: string, toId: string) => void;
  isItemSelected: (itemId: string) => boolean;

  // Turn-level selection (selects all items in a turn)
  selectedTurns: Set<string>;
  toggleTurnSelect: (turnId: string, allItemIds: string[]) => void;
  isTurnSelected: (turnId: string) => boolean;

  // Selection management
  clearSelection: () => void;
  getSelectedCount: () => number;
  hasSelection: () => boolean;

  // Batch operations
  batchMode: boolean;
  setBatchMode: (v: boolean) => void;
  pendingAction: BatchAction | null;
  setPendingAction: (action: BatchAction | null) => void;

  // Turn collapse
  collapsedTurns: Set<string>;
  toggleTurnCollapse: (turnId: string) => void;
  isTurnCollapsed: (turnId: string) => boolean;
  collapseAll: () => void;
  expandAll: () => void;

  // Rollback overlay
  rollbackOverlayOpen: boolean;
  rollbackOverlayType: "code" | "chat" | null;
  rollbackTargetItemId: string | null;
  openRollbackOverlay: (type: "code" | "chat", targetItemId?: string) => void;
  closeRollbackOverlay: () => void;
}

export const useChatNavStore = create<ChatNavState>((set, get) => ({
  // Navigation
  activeId: null,
  setActive: (id) => set({ activeId: id }),

  // Item-level selection
  selectedItems: new Set(),
  toggleItemSelect: (itemId) =>
    set((s) => {
      const next = new Set(s.selectedItems);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return { selectedItems: next, batchMode: next.size > 0 };
    }),
  selectItemRange: (fromId, toId) =>
    set((s) => {
      const next = new Set(s.selectedItems);
      next.add(fromId);
      next.add(toId);
      return { selectedItems: next, batchMode: true };
    }),
  isItemSelected: (itemId) => get().selectedItems.has(itemId),

  // Turn-level selection
  selectedTurns: new Set(),
  toggleTurnSelect: (turnId, allItemIds) =>
    set((s) => {
      const nextItems = new Set(s.selectedItems);
      const nextTurns = new Set(s.selectedTurns);

      if (nextTurns.has(turnId)) {
        // Deselect all items in this turn
        nextTurns.delete(turnId);
        for (const id of allItemIds) nextItems.delete(id);
      } else {
        // Select all items in this turn
        nextTurns.add(turnId);
        for (const id of allItemIds) nextItems.add(id);
      }

      return {
        selectedItems: nextItems,
        selectedTurns: nextTurns,
        batchMode: nextItems.size > 0,
      };
    }),
  isTurnSelected: (turnId) => get().selectedTurns.has(turnId),

  // Selection management
  clearSelection: () =>
    set({
      selectedItems: new Set(),
      selectedTurns: new Set(),
      batchMode: false,
      pendingAction: null,
    }),
  getSelectedCount: () => get().selectedItems.size,
  hasSelection: () => get().selectedItems.size > 0,

  // Batch operations
  batchMode: false,
  setBatchMode: (v) => set({ batchMode: v }),
  pendingAction: null,
  setPendingAction: (action) => set({ pendingAction: action }),

  // Turn collapse
  collapsedTurns: new Set(),
  toggleTurnCollapse: (turnId) =>
    set((s) => {
      const next = new Set(s.collapsedTurns);
      if (next.has(turnId)) next.delete(turnId);
      else next.add(turnId);
      return { collapsedTurns: next };
    }),
  isTurnCollapsed: (turnId) => get().collapsedTurns.has(turnId),
  collapseAll: () => set({ collapsedTurns: "all" as unknown as Set<string> }),
  expandAll: () => set({ collapsedTurns: new Set() }),

  // Rollback overlay
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
}));
