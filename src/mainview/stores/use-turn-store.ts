import { create } from "zustand";
import { useSessionStore } from "./use-session-store";

/**
 * 注意：本 store 与 use-chat-nav-store 管理 UI 概念有重叠，但粒度不同：
 * - 本 store：按 **message 粒度**（折叠、多选、导航高亮）
 * - use-chat-nav-store：按 **timeline turn/item 粒度**
 *
 * 无法合并删除的原因（use-chat-nav-store 缺少以下对应）：
 * - selectedNavIdBySession + navAnchorBySession + setNavId（导航高亮 + 锚点）
 * - collapsedMessageIdsBySession + toggleCollapse（message 级别折叠）
 * - selectedMessageIdsBySession + toggleMessageSelection / selectMessageRange / selectAll（message 级别多选）
 * - isMultiSelectModeBySession + toggleMultiSelectMode（message 级别多选模式）
 *
 * 导航相关字段被 ChatPanel、SideNav 使用；message 级别字段被 MessageCard、MessageSelectionBar 使用。
 */
export const EMPTY_SET: ReadonlySet<string> = new Set<string>();

interface MessageState {
  selectedMessageIdsBySession: Record<string, Set<string>>;
  collapsedMessageIdsBySession: Record<string, Set<string>>;
  isMultiSelectModeBySession: Record<string, boolean>;
  selectedNavIdBySession: Record<string, string | null>;
  navAnchorBySession: Record<string, "top" | "bottom">;

  toggleMessageSelection: (messageId: string) => void;
  selectMessageRange: (fromIndex: number, toIndex: number, messageIds: string[]) => void;
  clearSelection: () => void;
  selectAll: (messageIds: string[]) => void;
  toggleMultiSelectMode: () => void;
  toggleCollapse: (messageId: string) => void;
  setNavId: (navId: string | null, anchor?: "top" | "bottom") => void;
  clearSessionUI: (sessionId: string) => void;
}

export const useTurnStore = create<MessageState>((set) => ({
  selectedMessageIdsBySession: {},
  collapsedMessageIdsBySession: {},
  isMultiSelectModeBySession: {},
  selectedNavIdBySession: {},
  navAnchorBySession: {},

  toggleMessageSelection: (messageId) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const prev = s.selectedMessageIdsBySession[sessionId] ?? EMPTY_SET;
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return {
        selectedMessageIdsBySession: { ...s.selectedMessageIdsBySession, [sessionId]: next },
      };
    });
  },

  selectMessageRange: (fromIndex, toIndex, messageIds) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    const start = Math.max(0, Math.min(fromIndex, toIndex));
    const end = Math.max(fromIndex, toIndex);
    const rangeIds = new Set<string>();
    for (let i = start; i <= end && i < messageIds.length; i++) {
      rangeIds.add(messageIds[i]);
    }
    set((s) => {
      const prev = s.selectedMessageIdsBySession[sessionId] ?? EMPTY_SET;
      const merged = new Set(prev);
      rangeIds.forEach((id) => merged.add(id));
      return {
        selectedMessageIdsBySession: { ...s.selectedMessageIdsBySession, [sessionId]: merged },
      };
    });
  },

  clearSelection: () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const { [sessionId]: _, ...rest } = s.selectedMessageIdsBySession;
      return {
        selectedMessageIdsBySession: rest,
        isMultiSelectModeBySession: { ...s.isMultiSelectModeBySession, [sessionId]: false },
      };
    });
  },

  selectAll: (messageIds) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => ({
      selectedMessageIdsBySession: {
        ...s.selectedMessageIdsBySession,
        [sessionId]: new Set(messageIds),
      },
    }));
  },

  toggleMultiSelectMode: () => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const prev = s.isMultiSelectModeBySession[sessionId] ?? false;
      return {
        isMultiSelectModeBySession: { ...s.isMultiSelectModeBySession, [sessionId]: !prev },
        selectedMessageIdsBySession: prev
          ? (() => {
              const { [sessionId]: _, ...rest } = s.selectedMessageIdsBySession;
              return rest;
            })()
          : s.selectedMessageIdsBySession,
      };
    });
  },

  toggleCollapse: (messageId) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => {
      const prev = s.collapsedMessageIdsBySession[sessionId] ?? EMPTY_SET;
      const next = new Set(prev);
      if (next.has(messageId)) next.delete(messageId);
      else next.add(messageId);
      return {
        collapsedMessageIdsBySession: { ...s.collapsedMessageIdsBySession, [sessionId]: next },
      };
    });
  },

  setNavId: (navId, anchor) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => ({
      selectedNavIdBySession: { ...s.selectedNavIdBySession, [sessionId]: navId },
      ...(anchor != null
        ? { navAnchorBySession: { ...s.navAnchorBySession, [sessionId]: anchor } }
        : {}),
    }));
  },

  clearSessionUI: (sessionId) =>
    set((s) => {
      const { [sessionId]: _s, ...restSel } = s.selectedMessageIdsBySession;
      const { [sessionId]: _c, ...restCol } = s.collapsedMessageIdsBySession;
      const { [sessionId]: _m, ...restMulti } = s.isMultiSelectModeBySession;
      const { [sessionId]: _n, ...restNav } = s.selectedNavIdBySession;
      const { [sessionId]: _a, ...restAnchor } = s.navAnchorBySession;
      return {
        selectedMessageIdsBySession: restSel,
        collapsedMessageIdsBySession: restCol,
        isMultiSelectModeBySession: restMulti,
        selectedNavIdBySession: restNav,
        navAnchorBySession: restAnchor,
      };
    }),
}));
