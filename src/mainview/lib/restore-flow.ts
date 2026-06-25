/**
 * Restore flow extracted from App.tsx for testability.
 *
 * Key invariant: `setRestoring(false)` must be called AFTER session data is
 * loaded (loadSessionsForProject + setActiveSession), not before. Otherwise
 * the UI flashes an empty state before messages arrive.
 */
import type { ProjectRuntime, RemoteProjectRef, SessionMeta } from "../../shared/modules/project";
import type { StartupTrace } from "./startup-monitor";
import { pickDefaultSessionId } from "../stores/session-selection";

export interface SavedTab {
  id: string;
  name: string;
  path: string;
  runtime?: ProjectRuntime;
  remote?: RemoteProjectRef;
}

export interface RestoreFlowDeps {
  isCancelled: () => boolean;
  setRestoring: (v: boolean) => void;
  addLog: (msg: string) => void;

  /** RPC call abstraction — returns untyped result, callers cast as needed */
  callApi: (method: string, params: Record<string, unknown>) => Promise<unknown>;

  /** Load sessions for a project path */
  loadSessionsForProject: (projectPath: string) => Promise<SessionMeta[]>;

  /** Add a project tab */
  addProjectTab: (tab: SavedTab) => void;

  // Session store actions
  setActiveProject: (tabId: string, opts?: { skipAutoSession?: boolean }) => void;
  setActiveSession: (sessionId: string, skipFetch?: boolean) => void;
  createNewSession: () => Promise<unknown>;

  // Session store getters
  getProjectTabs: () => SavedTab[];
  getLastActiveSessionByProject: () => Record<string, string | undefined>;

  /** Load session messages (chat store) */
  loadSessionMessages: (
    sessionId: string,
    opts: { force: boolean; sessionPath: string },
  ) => void;

  /** Logger */
  log: { info: (msg: string, ctx?: Record<string, unknown>) => void };

  /** Startup trace */
  trace: StartupTrace;
}

interface RecentProjectRecord {
  path: string;
  name: string;
  runtime?: ProjectRuntime;
  remote?: RemoteProjectRef;
}

/**
 * Run the app restore flow.
 *
 * Two restore paths:
 * 1. URL session (`?session=xxx`)
 * 2. Saved tabs from server config
 *
 * In all paths, `setRestoring(false)` is called only after session data is
 * fully loaded to prevent UI flicker.
 */
export async function runRestoreFlow(deps: RestoreFlowDeps): Promise<void> {
  const {
    isCancelled,
    setRestoring,
    addLog,
    callApi,
    loadSessionsForProject,
    addProjectTab,
    setActiveProject,
    setActiveSession,
    createNewSession,
    getProjectTabs,
    getLastActiveSessionByProject,
    loadSessionMessages,
    log,
    trace,
  } = deps;

  try {
    const urlParams = new URLSearchParams(window.location.search);
    const urlSessionId = urlParams.get("session");

    // ── Path 1: URL session ──
    if (urlSessionId) {
      if (isCancelled()) return;
      addLog(`Loading session from URL: ${urlSessionId}`);
      trace.mark("url-session.lookup.begin", { sessionId: urlSessionId });
      try {
        const lookup = (await callApi("project.findSessionById", {
          sessionId: urlSessionId,
        })) as {
          session: {
            sessionPath: string;
            projectPath: string;
            name: string;
          } | null;
        };
        trace.mark("url-session.lookup.done", { sessionId: urlSessionId });
        const sessionInfo = lookup.session;

        if (!sessionInfo) {
          addLog(`Session not found: ${urlSessionId}`);
          setRestoring(false);
          return;
        }

        const { projectPath, sessionPath, name: sessionName } = sessionInfo;
        const projectName = projectPath.split("/").filter(Boolean).pop() ?? projectPath;
        const tabId = `proj-${projectPath.replace(/\//g, "-")}`;

        addProjectTab({ id: tabId, name: projectName, path: projectPath });
        setActiveProject(tabId, { skipAutoSession: true });

        trace.mark("url-session.scan.begin", { projectPath });
        await loadSessionsForProject(projectPath);
        trace.mark("url-session.scan.done", { projectPath });

        if (isCancelled()) return;
        trace.mark("url-session.agent.start.begin", { sessionId: urlSessionId });
        const result = (await callApi("agent.start", {
          sessionId: urlSessionId,
          projectPath,
          sessionPath,
        })) as { status: string };
        trace.mark("url-session.agent.start.done", {
          sessionId: urlSessionId,
          status: result.status,
        });
        log.info("agent.start for URL session", {
          status: result.status,
          sessionId: urlSessionId,
        });

        setActiveSession(urlSessionId, true);
        loadSessionMessages(urlSessionId, { force: true, sessionPath });

        addLog(`URL session loaded: ${sessionName} (${projectName})`);
        trace.done("url-session.ready", { sessionId: urlSessionId });
      } catch (err) {
        trace.error("url-session.failed", err);
        addLog(
          `Failed to load URL session: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!isCancelled()) setRestoring(false);
      return;
    }

    // ── Path 2: Saved tabs ──
    if (isCancelled()) return;
    trace.mark("restore-tabs.begin");
    const tabResult = (await callApi("project.restoreTabs", {})) as {
      tabs: SavedTab[];
      activeTabId: string | null;
    };
    const savedTabs = tabResult.tabs;
    const savedActiveId = tabResult.activeTabId;
    trace.mark("restore-tabs.done", {
      tabCount: savedTabs?.length ?? 0,
      savedActiveId,
    });

    if (savedTabs && savedTabs.length > 0) {
      const existingTabIds = new Set(getProjectTabs().map((tab) => tab.id));
      for (const t of savedTabs) {
        if (existingTabIds.has(t.id)) continue;
        existingTabIds.add(t.id);
        addProjectTab({
          id: t.id,
          name: t.name,
          path: t.path,
          runtime: t.runtime,
          remote: t.remote,
        });
      }

      const targetId =
        savedActiveId && savedTabs.some((t) => t.id === savedActiveId)
          ? savedActiveId
          : savedTabs[0].id;
      setActiveProject(targetId, { skipAutoSession: true });

      const tab = savedTabs.find((t) => t.id === targetId);
      if (tab) {
        trace.mark("active-project.sessions.begin", { projectPath: tab.path });
        const sessions = await Promise.race([
          loadSessionsForProject(tab.path),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("loadSessionsForProject timed out (10s)")),
              10_000,
            ),
          ),
        ]).catch((err) => {
          trace.error("active-project.sessions.failed", err, { projectPath: tab.path });
          addLog(`Session load failed: ${err instanceof Error ? err.message : String(err)}`);
          return [] as SessionMeta[];
        });
        trace.mark("active-project.sessions.done", {
          projectPath: tab.path,
          sessionCount: sessions.length,
        });
        addLog(
          `Restored ${savedTabs.length} tabs from server config (${sessions.length} sessions)`,
        );
        if (sessions.length > 0) {
          const targetSession = pickDefaultSessionId(
            sessions,
            getLastActiveSessionByProject()[tab.path],
          );
          if (!targetSession) {
            trace.mark("active-project.create-session.begin", { projectPath: tab.path });
            await createNewSession();
            trace.done("active-project.create-session.done", { projectPath: tab.path });
            return;
          }
          setActiveSession(targetSession);
          trace.done("active-session.selected", { sessionId: targetSession });
        } else {
          trace.mark("empty-project.create-session.begin", { projectPath: tab.path });
          await createNewSession();
          trace.done("empty-project.create-session.done", { projectPath: tab.path });
        }
      }

      // Release restoring AFTER sessions are loaded so UI doesn't flash empty state
      if (!isCancelled()) setRestoring(false);
      return;
    }

    const recentResult = (await callApi("project.listRecent", {})) as {
      projects: RecentProjectRecord[];
    };
    const recentProjects = recentResult.projects ?? [];
    if (recentProjects.length > 0) {
      const recentProject = recentProjects[0];
      const tabId = recentProject.remote
        ? `remote-${recentProject.remote.host}-${recentProject.path}`
        : `proj-${recentProject.path.replace(/\//g, "-")}`;
      const exists = getProjectTabs().some((tab) => tab.id === tabId);
      if (!exists) {
        addProjectTab({
          id: tabId,
          name: recentProject.name,
          path: recentProject.path,
          runtime: recentProject.runtime,
          remote: recentProject.remote,
        });
      }

      setActiveProject(tabId, { skipAutoSession: true });

      trace.mark("recent-project.sessions.begin", { projectPath: recentProject.path });
      const sessions = await Promise.race([
        loadSessionsForProject(recentProject.path),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("loadSessionsForProject timed out (10s)")), 10_000),
        ),
      ]).catch((err) => {
        trace.error("recent-project.sessions.failed", err, { projectPath: recentProject.path });
        addLog(`Session load failed: ${err instanceof Error ? err.message : String(err)}`);
        return [] as SessionMeta[];
      });
      trace.mark("recent-project.sessions.done", {
        projectPath: recentProject.path,
        sessionCount: sessions.length,
      });

      if (sessions.length > 0) {
        const targetSession = pickDefaultSessionId(
          sessions,
          getLastActiveSessionByProject()[recentProject.path],
        );
        if (!targetSession) {
          trace.mark("recent-project.create-session.begin", { projectPath: recentProject.path });
          await createNewSession();
          trace.done("recent-project.create-session.done", { projectPath: recentProject.path });
        } else {
          setActiveSession(targetSession);
          trace.done("recent-project.active-session.selected", { sessionId: targetSession });
        }
      } else {
        trace.mark("recent-project.create-session.begin", { projectPath: recentProject.path });
        await createNewSession();
        trace.done("recent-project.create-session.done", { projectPath: recentProject.path });
      }

      if (!isCancelled()) setRestoring(false);
      return;
    }

    trace.done("no-open-tabs");
    if (!isCancelled()) setRestoring(false);
  } catch (err) {
    trace.error("restore.failed", err);
    addLog(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    if (!isCancelled()) setRestoring(false);
  }
}
