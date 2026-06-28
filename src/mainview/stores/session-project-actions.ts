import type { StoreApi } from "zustand";
import { apiClient } from "../lib/api-client";
import type { ProjectTab, SessionMeta, SessionStatus } from "../types";
import { useAppStore } from "./use-app-store";
import { useTierStore } from "./use-tier-store";

interface ProjectSessionState {
  activeProjectId: string | null;
  activeSessionId: string | null;
  loading: boolean;
  projectTabs: ProjectTab[];
  sessionsByProject: Record<string, SessionMeta[]>;
  sessionStatusMap: Record<string, SessionStatus>;
  currentModel: { provider: string; id: string; name?: string } | null;
  newSessionCreatedAt: number;
  setActiveSession: (
    id: string | null,
    force?: boolean,
    options?: { skipCleanup?: boolean; forceNewProcess?: boolean },
  ) => void;
}

type SetState = StoreApi<ProjectSessionState>["setState"];
type GetState = StoreApi<ProjectSessionState>["getState"];

interface ProjectActionLogger {
  info: (message: string, data?: Record<string, unknown>) => void;
  warn: (message: string, data?: Record<string, unknown>) => void;
  error: (message: string, data?: Record<string, unknown>) => void;
}

export function createLoadSessionsForProjectAction({
  get,
  set,
  log,
}: {
  get: GetState;
  set: SetState;
  log: ProjectActionLogger;
}): (projectPath: string) => Promise<SessionMeta[]> {
  return async (projectPath) => {
    set({ loading: true });
    try {
      const result = await apiClient.call("project.scanSessions", { projectPath });
      let sessions = result.sessions as SessionMeta[];

      const seen = new Set<string>();
      const seenPaths = new Set<string>();
      sessions = sessions.filter((s) => {
        if (seen.has(s.sessionId)) return false;
        if (seenPaths.has(s.sessionPath)) return false;
        seen.add(s.sessionId);
        seenPaths.add(s.sessionPath);
        return true;
      });

      const existing = get().sessionsByProject[projectPath] || [];
      const existingPaths = new Set(existing.map((s) => s.sessionPath));
      const existingIds = new Set(existing.map((s) => s.sessionId));
      const newFromDisk = sessions.filter((s) => !existingPaths.has(s.sessionPath));

      // Merge: keep in-memory sessions + add new from disk, deduplicate
      const allBlankSessions = [...existing, ...newFromDisk].filter(
        (s) => s.messageCount === 0 && !s.firstMessage,
      );
      let blankToRemove: Set<string> | null = null;
      if (allBlankSessions.length > 1) {
        const toRemove = allBlankSessions.slice(0, -1);
        blankToRemove = new Set(toRemove.map((s) => s.sessionId));

        for (const s of toRemove) {
          apiClient
            .call("session.delete", { sessionId: s.sessionId, sessionPath: s.sessionPath })
            .catch(() => {});
        }
      }

      // Merge disk sessions into existing: only add new unique sessionPaths
      const merged = [...existing];
      for (const s of newFromDisk) {
        if (!existingIds.has(s.sessionId)) {
          merged.push(s);
        }
      }

      // Remove excess blank sessions from merged result
      const finalSessions = blankToRemove
        ? merged.filter((s) => !blankToRemove.has(s.sessionId))
        : merged.filter((s) => {
            if (s.delegateParentSessionId) return true;
            return sessions.some((disk) => disk.sessionPath === s.sessionPath);
          });

      set((s) => ({
        sessionsByProject: { ...s.sessionsByProject, [projectPath]: finalSessions },
        loading: false,
      }));

      // 同一 RPC 顺带带回 statuses，写入 sessionStatusMap，
      // 跨项目指示器在 TabBar 加载完列表后立刻就有正确状态。
      // 服务端在 RPC 边界已经把进程池的 "stopped" 映射成 "idle"，
      // RPC schema 与 SessionStatus 共享同一个类型，所以这里可以直接写，
      // 不需要再做白名单校验。
      if (Array.isArray(result.statuses) && result.statuses.length > 0) {
        const statusUpdates: Record<string, SessionStatus> = {};
        for (const item of result.statuses) {
          if (!item || typeof item.sessionId !== "string") continue;
          statusUpdates[item.sessionId] = item.status;
        }
        set((s) => ({
          sessionStatusMap: { ...s.sessionStatusMap, ...statusUpdates },
        }));
      }

      return finalSessions;
    } catch (e) {
      log.warn("Failed to fetch sessions", { error: String(e) });
      set({ loading: false });
      return [];
    }
  };
}

export function createCreateNewSessionAction({
  get,
  set,
  log,
  insertAfterPinned,
}: {
  get: GetState;
  set: SetState;
  log: ProjectActionLogger;
  insertAfterPinned: (sessions: SessionMeta[], newSession: SessionMeta) => SessionMeta[];
}): (projectPath?: string) => Promise<void> {
  return async (_projectPath?: string) => {
    const { projectTabs, activeProjectId } = get();
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) {
      log.error("createNewSession: no active tab");
      return;
    }

    const targetPath = tab.path;

    const existing = get().sessionsByProject[tab.path];
    const blankSession = existing?.find(
      (s) =>
        s.messageCount === 0 &&
        !s.firstMessage &&
        !s.parentSessionPath &&
        !s.delegateParentSessionId,
    );
    if (blankSession) {
      log.info("Reusing existing blank session", { sessionId: blankSession.sessionId });
      get().setActiveSession(blankSession.sessionId);
      set({ newSessionCreatedAt: Date.now() });
      return;
    }

    log.info("Creating session", { targetPath });

    try {
      const result = await apiClient.call("session.create", { projectPath: targetPath });

      const now = Date.now();
      const newSession: SessionMeta = {
        sessionId: result.sessionId,
        name: "",
        sessionPath: result.sessionPath,
        projectPath: targetPath,
        parentSessionPath: null,
        delegateParentSessionId: null,
        delegateType: null,
        messageCount: 0,
        firstMessage: "",
        createdAt: now,
        updatedAt: now,
        status: "idle",
      };

      set((s) => {
        const existing = s.sessionsByProject[tab.path] || [];
        if (existing.some((sess) => sess.sessionId === result.sessionId)) return {};
        return {
          sessionsByProject: {
            ...s.sessionsByProject,
            [tab.path]: insertAfterPinned(existing, newSession),
          },
        };
      });

      get().setActiveSession(result.sessionId);
      set({ newSessionCreatedAt: Date.now() });

      // 从项目级 tier 配置读取，同一项目下所有 session 共享
      const projectTier = useTierStore.getState().getCurrentTier(targetPath);
      const prevModel = get().currentModel;

      if (projectTier) {
        await useTierStore.getState().switchToTier(projectTier, result.sessionId);
      } else if (prevModel) {
        await apiClient.call("agent.setModel", {
          sessionId: result.sessionId,
          provider: prevModel.provider,
          modelId: prevModel.id,
        });
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      log.error("Failed to create session", { error: errMsg });
      useAppStore.getState().addLog(`Failed to create session: ${errMsg}`);
    }
  };
}
