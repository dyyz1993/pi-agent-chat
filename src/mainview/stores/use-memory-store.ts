import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";
import { createLogger } from "../../shared/lib/logger";
import type { MemoryStatusResult } from "../../shared/modules/memory";

const log = createLogger("memory");

interface MemoryEvent {
  id: string;
  customType: string;
  data: unknown;
  timestamp: number;
}

interface MemoryFile {
  filename: string;
  filePath: string;
  description: string | null;
  type: string | null;
  mtimeMs: number;
  size?: number;
}

interface InjectedMemory {
  summary: string;
  snippet: string;
}

interface MemoryState {
  eventsBySession: Record<string, MemoryEvent[]>;
  filesBySession: Record<string, MemoryFile[]>;
  entrypointBySession: Record<string, string | null>;
  injectedBySession: Record<string, InjectedMemory[]>;
  expandedFileBySession: Record<string, string | null>;
  collapsedSections: Set<string>;
  bookmarkCreatingBySession: Record<string, boolean>;
  irrelevantMarkedBySession: Record<string, Set<string>>;
  statusBySession: Record<string, MemoryStatusResult | null>;

  addEvent: (sessionId: string, event: MemoryEvent) => void;
  loadFiles: (projectPath: string, sessionId: string) => Promise<void>;
  addInjected: (sessionId: string, injected: InjectedMemory) => void;
  setExpandedFile: (filePath: string | null) => void;
  toggleSection: (section: string) => void;
  clearSession: (sessionId: string) => void;
  setBookmarkCreating: (sessionId: string, creating: boolean) => void;
  markIrrelevant: (
    sessionId: string,
    blockId: string,
    query: string,
    selectedFiles: string[],
  ) => Promise<void>;
  isIrrelevantMarked: (sessionId: string, blockId: string) => boolean;
  addIrrelevantMark: (sessionId: string, blockId: string) => void;
  loadStatus: (sessionId: string) => Promise<void>;
  removeRule: (
    sessionId: string,
    params: { rule?: { pattern: string; mode: string }; excludeKeyword?: string },
  ) => Promise<void>;
  addRule: (
    sessionId: string,
    params: { pattern: string; mode: string; action: string },
  ) => Promise<void>;
}

const loadFilesTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useMemoryStore = create<MemoryState>()((set, get) => ({
  eventsBySession: {},
  filesBySession: {},
  entrypointBySession: {},
  injectedBySession: {},
  expandedFileBySession: {},
  collapsedSections: new Set(["operations"]),
  bookmarkCreatingBySession: {},
  irrelevantMarkedBySession: {},
  statusBySession: {},

  addEvent: (sessionId, event) => {
    set((s) => {
      const existing = s.eventsBySession[sessionId] || [];
      const isDuplicate = existing.some((e) => e.id === event.id);
      if (isDuplicate) return s;
      return {
        eventsBySession: {
          ...s.eventsBySession,
          [sessionId]: [...existing, event],
        },
      };
    });
  },

  loadFiles: async (projectPath, sessionId) => {
    const key = `${sessionId}::${projectPath}`;
    if (loadFilesTimers[key]) {
      clearTimeout(loadFilesTimers[key]);
    }
    return new Promise<void>((resolve) => {
      loadFilesTimers[key] = setTimeout(async () => {
        delete loadFilesTimers[key];
        try {
          const result = (await apiClient.call("memory.listFiles", { projectPath })) as {
            files: MemoryFile[];
            entrypointContent: string | null;
          };
          set((s) => ({
            filesBySession: {
              ...s.filesBySession,
              [sessionId]: result.files,
            },
            entrypointBySession: {
              ...s.entrypointBySession,
              [sessionId]: result.entrypointContent,
            },
          }));
        } catch (err) {
          log.warn("loadFiles failed", { error: String(err) });
        }
        resolve();
      }, 100);
    });
  },

  addInjected: (sessionId, injected) => {
    set((s) => {
      const existing = s.injectedBySession[sessionId] || [];
      const isDuplicate = existing.some(
        (e) => e.summary === injected.summary && e.snippet === injected.snippet,
      );
      if (isDuplicate) return s;
      return {
        injectedBySession: {
          ...s.injectedBySession,
          [sessionId]: [...existing, injected],
        },
      };
    });
  },

  setExpandedFile: (filePath) => {
    const sessionId = useSessionStore.getState().activeSessionId;
    if (!sessionId) return;
    set((s) => ({
      expandedFileBySession: { ...s.expandedFileBySession, [sessionId]: filePath },
    }));
  },

  toggleSection: (section) => {
    set((s) => {
      const next = new Set(s.collapsedSections);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return { collapsedSections: next };
    });
  },

  clearSession: (sessionId) => {
    // Clear any pending loadFiles timers for this session
    for (const key of Object.keys(loadFilesTimers)) {
      if (key.startsWith(`${sessionId}::`)) {
        clearTimeout(loadFilesTimers[key]);
        delete loadFilesTimers[key];
      }
    }

    set((s) => {
      const { [sessionId]: _e, ...restEvents } = s.eventsBySession;
      const { [sessionId]: _f, ...restFiles } = s.filesBySession;
      const { [sessionId]: _i, ...restInjected } = s.injectedBySession;
      const { [sessionId]: _p, ...restEntrypoint } = s.entrypointBySession;
      const { [sessionId]: _b, ...restBookmark } = s.bookmarkCreatingBySession;
      const { [sessionId]: _m, ...restIrrelevant } = s.irrelevantMarkedBySession;
      const { [sessionId]: _s, ...restStatus } = s.statusBySession;
      const { [sessionId]: _x, ...restExpanded } = s.expandedFileBySession;
      return {
        eventsBySession: restEvents,
        filesBySession: restFiles,
        injectedBySession: restInjected,
        entrypointBySession: restEntrypoint,
        bookmarkCreatingBySession: restBookmark,
        irrelevantMarkedBySession: restIrrelevant,
        statusBySession: restStatus,
        expandedFileBySession: restExpanded,
      };
    });
  },

  setBookmarkCreating: (sessionId, creating) => {
    set((s) => ({
      bookmarkCreatingBySession: { ...s.bookmarkCreatingBySession, [sessionId]: creating },
    }));
  },

  addIrrelevantMark: (sessionId, blockId) => {
    set((s) => {
      const existing = s.irrelevantMarkedBySession[sessionId] || new Set<string>();
      if (existing.has(blockId)) return s;
      const next = new Set(existing);
      next.add(blockId);
      return {
        irrelevantMarkedBySession: {
          ...s.irrelevantMarkedBySession,
          [sessionId]: next,
        },
      };
    });
  },

  isIrrelevantMarked: (sessionId, blockId) => {
    const marked = get().irrelevantMarkedBySession[sessionId];
    return marked?.has(blockId) ?? false;
  },

  markIrrelevant: async (sessionId, blockId, query, selectedFiles) => {
    try {
      await apiClient.call("memory.markIrrelevant", {
        sessionId,
        query,
        selectedFiles,
      });
      get().addIrrelevantMark(sessionId, blockId);
    } catch (err) {
      log.warn("markIrrelevant failed", { error: String(err) });
    }
  },

  loadStatus: async (sessionId) => {
    try {
      const result = (await apiClient.call("memory.getStatus", {
        sessionId,
      })) as MemoryStatusResult;
      set((s) => ({
        statusBySession: { ...s.statusBySession, [sessionId]: result },
      }));
    } catch {
      // silently fail
    }
  },

  removeRule: async (sessionId, params) => {
    await apiClient.call("memory.removeRule", { ...params, sessionId });
    const store = get();
    await store.loadStatus(sessionId);
  },

  addRule: async (sessionId, params) => {
    await apiClient.call("memory.addRule", { ...params, sessionId });
    const store = get();
    await store.loadStatus(sessionId);
  },
}));
