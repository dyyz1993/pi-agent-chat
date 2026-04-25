import { useEffect, useState, useRef } from "react";
import { apiClient } from "./lib/api-client";
import { useAppStore } from "./stores/use-app-store";
import { useExplorerStore } from "./stores/use-explorer-store";
import { useSessionStore } from "./stores/use-session-store";
import { MainLayout } from "./layouts/MainLayout";
import { ProjectPickerDialog } from "./components/project-picker/ProjectPickerDialog";

function App() {
  const ready = useAppStore((s) => s.ready);
  const initializeConnection = useAppStore((s) => s.initializeConnection);
  const addLog = useAppStore((s) => s.addLog);
  const listRootDir = useExplorerStore((s) => s.listRootDir);
  const [pickerOpen, setPickerOpen] = useState(false);
  const addProjectTab = useSessionStore((s) => s.addProjectTab);
  const loadSessionsForProject = useSessionStore((s) => s.loadSessionsForProject);
  const restoreFromPersisted = useSessionStore((s) => s.restoreFromPersisted);
  const restoredRef = useRef(false);

  useEffect(() => {
    initializeConnection();
  }, [initializeConnection]);

  useEffect(() => {
    if (!ready || restoredRef.current) return;
    restoredRef.current = true;

    (async () => {
      try {
        listRootDir();

        const restored = await restoreFromPersisted();
        if (restored) {
          addLog("Restored last session from cache");
          return;
        }

        const result = await apiClient.call("project.listRecent", {});
        const projects = (result.projects as Array<{ path: string; name: string; sessionCount: number }>) || [];
        if (projects.length === 0) return;

        const first = projects[0];
        const tabId = `proj-${first.path.replace(/\//g, "-")}`;
        addProjectTab({ id: tabId, name: first.name, path: first.path });

        const sessions = await loadSessionsForProject(first.path);
        addLog(`Restored project: ${first.name} (${sessions.length} sessions)`);

        if (sessions.length > 0) {
          useSessionStore.getState().setActiveSession(sessions[0].sessionId);
        }
      } catch (err) {
        addLog(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    })();
  }, [ready, addLog, listRootDir, addProjectTab, loadSessionsForProject, restoreFromPersisted]);

  const handleSelectProject = async (path: string, name: string) => {
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
  };

  if (!ready) {
    return (
      <div className="h-screen bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-4" />
          <div className="text-gray-400 text-sm">Connecting to RPC server...</div>
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
    </>
  );
}

export default App;
