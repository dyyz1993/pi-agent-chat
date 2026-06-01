import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";
import { apiClient, resolveAuthToken } from "./lib/api-client";
import { useAppStore } from "./stores/use-app-store";
import { useSessionStore } from "./stores/use-session-store";
import {
  setupProjectStatusSubscription,
  setupSessionRenamedSubscription,
} from "./stores/session-subscriptions";
import { useChatStore } from "./stores/use-chat-store";
import { createLogger } from "../shared/lib/logger";
import { MainLayout } from "./layouts/MainLayout";
import { ProjectPickerDialog } from "./components/project-picker/ProjectPickerDialog";
import { DiagnosticPanel } from "./components/debug/DiagnosticPanel";
import { useDiagnosticStore } from "./stores/use-diagnostic-store";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginPage } from "./components/LoginPage";

function App() {
  const { t } = useTranslation("common");
  const log = createLogger("chat");
  const initError = useAppStore((s) => s.initError);
  const ready = useAppStore((s) => s.ready);
  const initializeConnection = useAppStore((s) => s.initializeConnection);
  const addLog = useAppStore((s) => s.addLog);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const restoredFlag = useAppStore((s) => s.restored);
  const [restoring, setRestoring] = useState(!useAppStore.getState().restored);
  const addProjectTab = useSessionStore((s) => s.addProjectTab);
  const loadSessionsForProject = useSessionStore((s) => s.loadSessionsForProject);

  const [hasToken, setHasToken] = useState(() => !!resolveAuthToken());
  const [loginError, setLoginError] = useState<string | null>(null);
  const loginTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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
    return () => {
      if (loginTimerRef.current) clearTimeout(loginTimerRef.current);
    };
  }, []);

  const handleLogin = useCallback(() => {
    setLoginError(null);
    setHasToken(true);

    loginTimerRef.current = setTimeout(() => {
      const currentReady = useAppStore.getState().ready;
      if (!currentReady) {
        localStorage.removeItem("rpc-auth-token");
        setLoginError("连接失败，请检查 Token 是否正确");
        setHasToken(false);
      }
    }, 15000);
  }, []);

  useEffect(() => {
    if (ready && loginTimerRef.current) {
      clearTimeout(loginTimerRef.current);
      loginTimerRef.current = null;
    }
  }, [ready]);

  useEffect(() => {
    if (!hasToken) return;

    let cancelled = false;

    const doInit = async () => {
      if (cancelled) return;
      await Promise.all([
        initializeConnection(),
        setupProjectStatusSubscription(),
        setupSessionRenamedSubscription(),
      ]);
    };

    doInit();

    return () => {
      cancelled = true;
    };
  }, [initializeConnection, hasToken]);

  useEffect(() => {
    if (!ready || restoredFlag) return;

    let cancelled = false;
    useAppStore.setState({ restored: true });
    setRestoring(true);

    (async () => {
      try {
        const urlParams = new URLSearchParams(window.location.search);
        const urlSessionId = urlParams.get("session");

        if (urlSessionId) {
          if (cancelled) return;
          addLog(`Loading session from URL: ${urlSessionId}`);
          try {
            const lookup = await apiClient.call("project.findSessionById", {
              sessionId: urlSessionId,
            });
            const sessionInfo = lookup.session as {
              sessionPath: string;
              projectPath: string;
              name: string;
            } | null;

            if (!sessionInfo) {
              addLog(`Session not found: ${urlSessionId}`);
              setRestoring(false);
              return;
            }

            const { projectPath, sessionPath, name: sessionName } = sessionInfo;
            const projectName = projectPath.split("/").filter(Boolean).pop() ?? projectPath;
            const tabId = `proj-${projectPath.replace(/\//g, "-")}`;

            addProjectTab({ id: tabId, name: projectName, path: projectPath });
            useSessionStore.getState().setActiveProject(tabId, { skipAutoSession: true });

            await loadSessionsForProject(projectPath);

            if (cancelled) return;
            const result = await apiClient.call("agent.start", {
              sessionId: urlSessionId,
              projectPath,
              sessionPath,
            });
            log.info("agent.start for URL session", {
              status: result.status,
              sessionId: urlSessionId,
            });

            useSessionStore.getState().setActiveSession(urlSessionId, true);
            useChatStore.getState().loadSessionMessages(urlSessionId, { force: true, sessionPath });

            addLog(`URL session loaded: ${sessionName} (${projectName})`);
          } catch (err) {
            addLog(
              `Failed to load URL session: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
          if (!cancelled) setRestoring(false);
          return;
        }

        if (cancelled) return;
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

          const targetId =
            savedActiveId && savedTabs.some((t) => t.id === savedActiveId)
              ? savedActiveId
              : savedTabs[0].id;
          useSessionStore.getState().setActiveProject(targetId, { skipAutoSession: true });

          const tab = savedTabs.find((t) => t.id === targetId);
          if (tab) {
            const sessions = await Promise.race([
              loadSessionsForProject(tab.path),
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error("loadSessionsForProject timed out (10s)")),
                  10_000,
                ),
              ),
            ]).catch((err) => {
              addLog(`Session load failed: ${err instanceof Error ? err.message : String(err)}`);
              return [] as Awaited<ReturnType<typeof loadSessionsForProject>>;
            });
            addLog(
              `Restored ${savedTabs.length} tabs from server config (${sessions.length} sessions)`,
            );
            if (sessions.length > 0) {
              const { lastActiveSessionByProject } = useSessionStore.getState();
              const lastSid = lastActiveSessionByProject[tab.path];
              const targetSession =
                lastSid && sessions.some((s) => s.sessionId === lastSid)
                  ? lastSid
                  : sessions[0].sessionId;
              useSessionStore.getState().setActiveSession(targetSession);
            } else {
              await useSessionStore.getState().createNewSession();
            }
          }
          if (!cancelled) setRestoring(false);
          return;
        }

        if (cancelled) return;
        const result = await apiClient.call("project.listRecent", {});
        const projects =
          (result.projects as Array<{ path: string; name: string; sessionCount: number }>) || [];
        if (projects.length === 0) {
          if (!cancelled) setRestoring(false);
          return;
        }

        const first = projects[0];
        const tabId = `proj-${first.path.replace(/\//g, "-")}`;
        addProjectTab({ id: tabId, name: first.name, path: first.path });
        useSessionStore.getState().setActiveProject(tabId, { skipAutoSession: true });

        const sessions = await loadSessionsForProject(first.path);
        addLog(`Restored project: ${first.name} (${sessions.length} sessions)`);

        if (sessions.length > 0) {
          const { lastActiveSessionByProject } = useSessionStore.getState();
          const lastSid = lastActiveSessionByProject[first.path];
          const sid =
            lastSid && sessions.some((s) => s.sessionId === lastSid)
              ? lastSid
              : sessions[0].sessionId;
          useSessionStore.getState().setActiveSession(sid);
        } else {
          await useSessionStore.getState().createNewSession();
        }
        if (!cancelled) setRestoring(false);
      } catch (err) {
        addLog(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
        if (!cancelled) setRestoring(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ready, addLog, addProjectTab, loadSessionsForProject]);

  // 首次恢复完成后，后台拉取所有项目所有会话的运行状态
  useEffect(() => {
    if (!restoring && ready) {
      useSessionStore.getState().fetchAllProjectsSessionsStatus();
    }
  }, [restoring, ready]);

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

  if (!hasToken) {
    return (
      <ErrorBoundary>
        <LoginPage
          onLogin={handleLogin}
          loginError={loginError}
          onClearError={() => setLoginError(null)}
        />
      </ErrorBoundary>
    );
  }

  if (!ready || restoring || projectLoading) {
    const showRetry = initError && !restoring && !projectLoading;
    return (
      <ErrorBoundary>
        <div className="h-screen flex items-center justify-center bg-bg-primary">
          <div className="text-center">
            {showRetry ? (
              <>
                <div className="text-status-error text-sm font-medium mb-2">
                  {t("connectionFailed")}
                </div>
                <div className="text-text-tertiary text-xs mb-4 max-w-xs">{initError}</div>
                <button
                  onClick={initializeConnection}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-semantic-accent hover:bg-semantic-accent rounded-lg text-sm text-white transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t("retry")}
                </button>
              </>
            ) : (
              <>
                <div className="inline-block w-8 h-8 border-2 border-semantic-accent border-t-transparent rounded-full animate-spin mb-4" />
                <div className="text-text-secondary text-sm">
                  {!ready
                    ? t("connectingRpc")
                    : projectLoading
                      ? t("loadingProject")
                      : t("restoringSession")}
                </div>
              </>
            )}
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
