import { useEffect, useState, useCallback } from "react";
import { apiClient } from "./lib/api-client";
import { useAppStore } from "./stores/use-app-store";
import { useExplorerStore } from "./stores/use-explorer-store";
import { useSessionStore } from "./stores/use-session-store";
import { useChatStore } from "./stores/use-chat-store";
import { createLogger } from "../shared/lib/logger";
import { MainLayout } from "./layouts/MainLayout";
import { ProjectPickerDialog } from "./components/project-picker/ProjectPickerDialog";
import { DiagnosticPanel } from "./components/debug/DiagnosticPanel";
import { useDiagnosticStore } from "./stores/use-diagnostic-store";
import { ErrorBoundary } from "./components/ErrorBoundary";

function App() {
  const log = createLogger("chat");
  const ready = useAppStore((s) => s.ready);
  const initializeConnection = useAppStore((s) => s.initializeConnection);
  const addLog = useAppStore((s) => s.addLog);
  const listRootDir = useExplorerStore((s) => s.listRootDir);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const restoredFlag = useAppStore((s) => s.restored);
  const [restoring, setRestoring] = useState(!useAppStore.getState().restored);
  const addProjectTab = useSessionStore((s) => s.addProjectTab);
  const loadSessionsForProject = useSessionStore((s) => s.loadSessionsForProject);
  const restoreFromPersisted = useSessionStore((s) => s.restoreFromPersisted);

  const handleDiagnosticToggle = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey && e.shiftKey && e.key === "D") {
      e.preventDefault();
      useDiagnosticStore.getState().toggle();
    }
  }, []);

  useEffect(() => {
    window.addEventListener("keydown", handleDiagnosticToggle);
    return () => window.removeEventListener("keydown", handleDiagnosticToggle);
  }, [handleDiagnosticToggle]);

  useEffect(() => {
    initializeConnection();
  }, [initializeConnection]);

  useEffect(() => {
    if (!ready || restoredFlag) return;
    useAppStore.setState({ restored: true });
    setRestoring(true);

    (async () => {
      try {
        listRootDir();

        const urlParams = new URLSearchParams(window.location.search);
        const urlSessionId = urlParams.get("session");

        if (urlSessionId) {
          addLog(`Loading session from URL: ${urlSessionId}`);
          try {
            const lookup = await apiClient.call("project.findSessionById", { sessionId: urlSessionId });
            const sessionInfo = lookup.session as { sessionPath: string; projectPath: string; name: string } | null;

            if (!sessionInfo) {
              addLog(`Session not found: ${urlSessionId}`);
              setRestoring(false);
              return;
            }

            const { projectPath, sessionPath, name: sessionName } = sessionInfo;
            const projectName = projectPath.split("/").filter(Boolean).pop() ?? projectPath;
            const tabId = `proj-${projectPath.replace(/\//g, "-")}`;

            addProjectTab({ id: tabId, name: projectName, path: projectPath });
            useSessionStore.getState().setActiveProject(tabId);

            await loadSessionsForProject(projectPath);

            const result = await apiClient.call("agent.start", {
              sessionId: urlSessionId,
              projectPath,
              sessionPath,
            });
            log.info("agent.start for URL session", { status: result.status, sessionId: urlSessionId });

            useSessionStore.getState().setActiveSession(urlSessionId, true);
            useChatStore.getState().loadSessionMessages(urlSessionId, { force: true, sessionPath });

            addLog(`URL session loaded: ${sessionName} (${projectName})`);
          } catch (err) {
            addLog(`Failed to load URL session: ${err instanceof Error ? err.message : String(err)}`);
          }
          setRestoring(false);
          return;
        }

        const restored = await restoreFromPersisted();
        if (restored) {
          addLog("Restored last session from cache");
          setRestoring(false);
          return;
        }

        const tabResult = await apiClient.call("project.restoreTabs", {});
        const savedTabs = tabResult.tabs as Array<{ id: string; name: string; path: string }>;
        const savedActiveId = tabResult.activeTabId as string | null;

        if (savedTabs && savedTabs.length > 0) {
          const { projectTabs } = useSessionStore.getState();
          for (const t of savedTabs) {
            const exists = projectTabs.find((pt) => pt.id === t.id);
            if (!exists) {
              addProjectTab({ id: t.id, name: t.name, path: t.path });
            }
          }

          const targetId = savedActiveId && savedTabs.some((t) => t.id === savedActiveId)
            ? savedActiveId
            : savedTabs[0].id;
          useSessionStore.getState().setActiveProject(targetId);

          const tab = savedTabs.find((t) => t.id === targetId);
          if (tab) {
            const sessions = await loadSessionsForProject(tab.path);
            addLog(`Restored ${savedTabs.length} tabs from server config (${sessions.length} sessions)`);
            if (sessions.length > 0) {
              const sid = sessions[0].sessionId;
              useSessionStore.getState().setActiveSession(sid);
            } else {
              await useSessionStore.getState().createNewSession();
            }
          }
          setRestoring(false);
          return;
        }

        const result = await apiClient.call("project.listRecent", {});
        const projects = (result.projects as Array<{ path: string; name: string; sessionCount: number }>) || [];
        if (projects.length === 0) {
          setRestoring(false);
          return;
        }

        const first = projects[0];
        const tabId = `proj-${first.path.replace(/\//g, "-")}`;
        addProjectTab({ id: tabId, name: first.name, path: first.path });

        const sessions = await loadSessionsForProject(first.path);
        addLog(`Restored project: ${first.name} (${sessions.length} sessions)`);

        if (sessions.length > 0) {
          const sid = sessions[0].sessionId;
          useSessionStore.getState().setActiveSession(sid);
        } else {
          await useSessionStore.getState().createNewSession();
        }
        setRestoring(false);
      } catch (err) {
        addLog(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
        setRestoring(false);
      }
    })();
  }, [ready, addLog, listRootDir, addProjectTab, loadSessionsForProject, restoreFromPersisted]);

  const handleSelectProject = async (path: string, name: string) => {
    setProjectLoading(true);

    const prevSessionId = useSessionStore.getState().activeSessionId;
    if (prevSessionId) {
      useSessionStore.getState().cleanupActiveSession(prevSessionId);
    }

    try {
      await apiClient.call("project.open", { path });
      addLog(`Opened project: ${name}`);
    } catch (err) {
      addLog(`Failed to open project: ${err instanceof Error ? err.message : String(err)}`);
    }

    const tabId = `proj-${path.replace(/\//g, "-")}`;
    addProjectTab({ id: tabId, name, path });
    useSessionStore.getState().setActiveProject(tabId);
    addLog(`Loaded project: ${name}`);

    setProjectLoading(false);
  };

  if (!ready || restoring || projectLoading) {
    return (
      <ErrorBoundary>
        <div className="h-screen flex items-center justify-center" style={{ backgroundColor: '#030712' }}>
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-4" />
            <div className="text-gray-400 text-sm">
              {!ready ? "Connecting to RPC server..." : projectLoading ? `加载项目中...` : "恢复会话中..."}
            </div>
          </div>
        </div>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <>
        <MainLayout onAddProject={() => setPickerOpen(true)} />
        <ProjectPickerDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={handleSelectProject}
        />
        <DiagnosticPanel />
      </>
    </ErrorBoundary>
  );
}

export default App;
