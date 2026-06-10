import type { StoreApi } from "zustand";
import { apiClient } from "../lib/api-client";
import type { ProjectTab, SessionMeta } from "../types";
import { useRetryStore } from "./use-retry-store";

interface SimpleSessionState {
  activeProjectId: string | null;
  activeSessionId: string | null;
  projectTabs: ProjectTab[];
  sessionsByProject: Record<string, SessionMeta[]>;
  agentSubscriptions: Record<string, string>;
  subagentSubscriptions: Record<string, string>;
  projectStartFailed: Record<string, boolean>;
  projectStartError: Record<string, string>;
  setActiveSession: (
    id: string | null,
    force?: boolean,
    options?: { skipCleanup?: boolean; forceNewProcess?: boolean },
  ) => void;
}

type SetState = StoreApi<SimpleSessionState>["setState"];
type GetState = StoreApi<SimpleSessionState>["getState"];

interface SimpleActionLogger {
  warn: (message: string, data?: Record<string, unknown>) => void;
}

export function createRetryActiveProjectAction({
  get,
  set,
}: {
  get: GetState;
  set: SetState;
}): () => void {
  return () => {
    const {
      activeProjectId,
      activeSessionId,
      projectTabs,
      agentSubscriptions,
      subagentSubscriptions,
    } = get();
    if (!activeProjectId) return;
    const tab = projectTabs.find((t) => t.id === activeProjectId);
    if (!tab) return;

    const newAgentSubs = { ...agentSubscriptions };
    const newSubagentSubs = { ...subagentSubscriptions };
    if (activeSessionId) {
      delete newAgentSubs[activeSessionId];
      delete newSubagentSubs[activeSessionId];
    }

    // 清理重试状态，避免手动重试时通知卡住
    if (activeSessionId) {
      useRetryStore.getState().endRetry(activeSessionId);
    }

    set((s) => ({
      projectStartFailed: { ...s.projectStartFailed, [activeProjectId]: false },
      projectStartError: { ...s.projectStartError, [activeProjectId]: "" },
      agentSubscriptions: newAgentSubs,
      subagentSubscriptions: newSubagentSubs,
    }));

    if (activeSessionId) {
      get().setActiveSession(activeSessionId, true);
    } else {
      const sessions = get().sessionsByProject[tab.path];
      if (sessions && sessions.length > 0) {
        get().setActiveSession(sessions[0].sessionId, true);
      }
    }
  };
}

export function createUpdateSessionProjectPathAction({
  set,
  log,
}: {
  set: SetState;
  log: SimpleActionLogger;
}): (sessionId: string, projectPath: string) => void {
  return (sessionId, projectPath) => {
    let sessionPath = "";
    set((s) => {
      const updated: Record<string, SessionMeta[]> = {};
      for (const [path, sessions] of Object.entries(s.sessionsByProject)) {
        updated[path] = sessions.map((sess) => {
          if (sess.sessionId === sessionId) {
            sessionPath = sess.sessionPath;
            return { ...sess, projectPath };
          }
          return sess;
        });
      }
      return { sessionsByProject: updated };
    });
    if (sessionPath) {
      apiClient.call("session.updateCwd", { sessionPath, newCwd: projectPath }).catch((err) => {
        log.warn("session.updateCwd failed", {
          err: err instanceof Error ? err.message : String(err),
        });
      });
    }
    apiClient.call("agent.setCwd", { sessionId, cwd: projectPath }).catch((err) => {
      log.warn("agent.setCwd failed", {
        err: err instanceof Error ? err.message : String(err),
      });
    });
  };
}

export function createRenameSessionAction({
  set,
  log,
}: {
  set: SetState;
  log: SimpleActionLogger;
}): (sessionId: string, newName: string) => void {
  return (sessionId, newName) => {
    const trimmed = newName.trim();
    if (!trimmed) return;

    let sessionPath = "";
    set((s) => {
      const updated: Record<string, SessionMeta[]> = {};
      for (const [path, sessions] of Object.entries(s.sessionsByProject)) {
        updated[path] = sessions.map((sess) => {
          if (sess.sessionId === sessionId) {
            sessionPath = sess.sessionPath;
            return { ...sess, name: trimmed };
          }
          return sess;
        });
      }
      return { sessionsByProject: updated };
    });
    if (sessionPath) {
      apiClient
        .call("session.rename", { sessionId, sessionPath, newName: trimmed })
        .catch((err) => {
          log.warn("session.rename failed", {
            err: err instanceof Error ? err.message : String(err),
          });
        });
    }
  };
}
