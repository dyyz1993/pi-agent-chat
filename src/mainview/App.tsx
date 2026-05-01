import { useEffect, useState, useCallback } from "react";
import { apiClient } from "./lib/api-client";
import { useAppStore } from "./stores/use-app-store";
import { useExplorerStore } from "./stores/use-explorer-store";
import { useSessionStore } from "./stores/use-session-store";
import { MainLayout } from "./layouts/MainLayout";
import { ProjectPickerDialog } from "./components/project-picker/ProjectPickerDialog";
import { DiagnosticPanel } from "./components/debug/DiagnosticPanel";
import { useDiagnosticStore } from "./stores/use-diagnostic-store";

function waitForSessionReady(sessionId: string): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (useSessionStore.getState().sessionReady[sessionId]) {
        resolve();
      } else {
        setTimeout(check, 50);
      }
    };
    setTimeout(check, 50);
  });
}

function App() {
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
              await waitForSessionReady(sid);
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
          await waitForSessionReady(sid);
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
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: '#030712' }}>
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-4" />
          <div className="text-gray-400 text-sm">
            {!ready ? "Connecting to RPC server..." : projectLoading ? `加载项目中...` : "恢复会话中..."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <MainLayout onAddProject={() => setPickerOpen(true)} />
      <ProjectPickerDialog
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={handleSelectProject}
      />
      <DiagnosticPanel />
    </>
  );
}

export default App;
