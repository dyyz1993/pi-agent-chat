import { create } from "zustand";
import { apiClient } from "../lib/api-client";
import type {
  LearningCandidate,
  LearningConfig,
  LearningCuratorMode,
  LearningRun,
  LearningSnapshot,
} from "../../shared/modules/learning";
import { createLogger } from "../../shared/lib/logger";

const log = createLogger("learning");

interface LearningState {
  snapshotsBySession: Record<string, LearningSnapshot | null>;
  loadingBySession: Record<string, boolean>;
  errorBySession: Record<string, string | null>;
  activeTabBySession: Record<string, "memory" | "skills" | "candidates" | "curator" | "settings">;
  collapsedSections: Set<string>;

  loadSnapshot: (projectPath: string, sessionId: string) => Promise<void>;
  applySnapshot: (sessionId: string, snapshot: LearningSnapshot) => void;
  applyRun: (sessionId: string, run: LearningRun) => void;
  applyCandidate: (sessionId: string, candidate: LearningCandidate) => void;
  setConfig: (
    projectPath: string,
    sessionId: string,
    config: Partial<LearningConfig>,
  ) => Promise<void>;
  approveCandidate: (
    projectPath: string,
    sessionId: string,
    candidateId: string,
    mergeTargetSkillName?: string,
  ) => Promise<void>;
  rejectCandidate: (projectPath: string, sessionId: string, candidateId: string) => Promise<void>;
  runCurator: (
    projectPath: string,
    sessionId: string,
    domain: "memory" | "skill",
    mode?: LearningCuratorMode,
  ) => Promise<void>;
  setActiveTab: (
    sessionId: string,
    tab: "memory" | "skills" | "candidates" | "curator" | "settings",
  ) => void;
  toggleSection: (section: string) => void;
  clearSession: (sessionId: string) => void;
}

export const useLearningStore = create<LearningState>()((set, get) => ({
  snapshotsBySession: {},
  loadingBySession: {},
  errorBySession: {},
  activeTabBySession: {},
  collapsedSections: new Set(["diagnostics", "memory-runtime"]),

  loadSnapshot: async (projectPath, sessionId) => {
    set((s) => ({
      loadingBySession: { ...s.loadingBySession, [sessionId]: true },
      errorBySession: { ...s.errorBySession, [sessionId]: null },
    }));
    try {
      const snapshot = (await apiClient.call("learning.getSnapshot", {
        projectPath,
        sessionId,
      })) as LearningSnapshot;
      get().applySnapshot(sessionId, snapshot);
    } catch (err) {
      log.warn("loadSnapshot failed", { error: String(err) });
      set((s) => ({
        errorBySession: { ...s.errorBySession, [sessionId]: String(err) },
      }));
    } finally {
      set((s) => ({
        loadingBySession: { ...s.loadingBySession, [sessionId]: false },
      }));
    }
  },

  applySnapshot: (sessionId, snapshot) => {
    set((s) => ({
      snapshotsBySession: { ...s.snapshotsBySession, [sessionId]: snapshot },
      errorBySession: { ...s.errorBySession, [sessionId]: null },
    }));
  },

  applyRun: (sessionId, run) => {
    set((s) => {
      const snapshot = s.snapshotsBySession[sessionId];
      if (!snapshot) return s;
      const runs = [run, ...snapshot.runs.filter((item) => item.id !== run.id)].slice(0, 30);
      return {
        snapshotsBySession: {
          ...s.snapshotsBySession,
          [sessionId]: {
            ...snapshot,
            runs,
            overview: {
              ...snapshot.overview,
              lastRunAt: run.completedAt ?? run.startedAt,
              warnings:
                run.status === "failed"
                  ? snapshot.overview.warnings + 1
                  : snapshot.overview.warnings,
            },
          },
        },
      };
    });
  },

  applyCandidate: (sessionId, candidate) => {
    set((s) => {
      const snapshot = s.snapshotsBySession[sessionId];
      if (!snapshot) return s;
      const candidates =
        candidate.status === "pending"
          ? [candidate, ...snapshot.candidates.filter((item) => item.id !== candidate.id)]
          : snapshot.candidates.filter((item) => item.id !== candidate.id);
      return {
        snapshotsBySession: {
          ...s.snapshotsBySession,
          [sessionId]: {
            ...snapshot,
            candidates,
            overview: { ...snapshot.overview, pendingCandidates: candidates.length },
          },
        },
      };
    });
  },

  setConfig: async (projectPath, sessionId, config) => {
    const snapshot = (await apiClient.call("learning.setConfig", {
      projectPath,
      sessionId,
      config,
    })) as LearningSnapshot;
    get().applySnapshot(sessionId, snapshot);
  },

  approveCandidate: async (projectPath, sessionId, candidateId, mergeTargetSkillName) => {
    const snapshot = (await apiClient.call("learning.approveCandidate", {
      projectPath,
      sessionId,
      candidateId,
      mergeTargetSkillName,
    })) as LearningSnapshot;
    get().applySnapshot(sessionId, snapshot);
  },

  rejectCandidate: async (projectPath, sessionId, candidateId) => {
    const snapshot = (await apiClient.call("learning.rejectCandidate", {
      projectPath,
      sessionId,
      candidateId,
    })) as LearningSnapshot;
    get().applySnapshot(sessionId, snapshot);
  },

  runCurator: async (projectPath, sessionId, domain, mode) => {
    await apiClient.call("learning.runCurator", { projectPath, sessionId, domain, mode });
    await get().loadSnapshot(projectPath, sessionId);
  },

  setActiveTab: (sessionId, tab) => {
    set((s) => ({
      activeTabBySession: { ...s.activeTabBySession, [sessionId]: tab },
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
      const { [sessionId]: _snapshot, ...snapshotsBySession } = s.snapshotsBySession;
      const { [sessionId]: _loading, ...loadingBySession } = s.loadingBySession;
      const { [sessionId]: _error, ...errorBySession } = s.errorBySession;
      const { [sessionId]: _active, ...activeTabBySession } = s.activeTabBySession;
      return { snapshotsBySession, loadingBySession, errorBySession, activeTabBySession };
    });
  },
}));
