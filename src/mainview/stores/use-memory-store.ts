import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import { useSessionStore } from "./use-session-store";

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

  addEvent: (sessionId: string, event: MemoryEvent) => void;
  loadFiles: (projectPath: string, sessionId: string) => Promise<void>;
  addInjected: (sessionId: string, injected: InjectedMemory) => void;
  setExpandedFile: (filePath: string | null) => void;
  toggleSection: (section: string) => void;
  clearSession: (sessionId: string) => void;
  setBookmarkCreating: (sessionId: string, creating: boolean) => void;
}

const loadFilesTimers: Record<string, ReturnType<typeof setTimeout>> = {};

export const useMemoryStore = create<MemoryState>()((set) => ({
  eventsBySession: {},
  filesBySession: {},
  entrypointBySession: {},
  injectedBySession: {},
  expandedFileBySession: {},
  collapsedSections: new Set(["operations"]),
  bookmarkCreatingBySession: {},

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
          console.warn("[memory-store] loadFiles failed:", err);
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
    set((s) => {
      const { [sessionId]: _e, ...restEvents } = s.eventsBySession;
      const { [sessionId]: _f, ...restFiles } = s.filesBySession;
      const { [sessionId]: _i, ...restInjected } = s.injectedBySession;
      const { [sessionId]: _p, ...restEntrypoint } = s.entrypointBySession;
      const { [sessionId]: _b, ...restBookmark } = s.bookmarkCreatingBySession;
      return {
        eventsBySession: restEvents,
        filesBySession: restFiles,
        injectedBySession: restInjected,
        entrypointBySession: restEntrypoint,
        bookmarkCreatingBySession: restBookmark,
      };
    });
  },

  setBookmarkCreating: (sessionId, creating) => {
    set((s) => ({
      bookmarkCreatingBySession: { ...s.bookmarkCreatingBySession, [sessionId]: creating },
    }));
  },
}));
