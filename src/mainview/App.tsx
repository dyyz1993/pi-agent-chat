import { useEffect, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { apiClient, resolveAuthToken } from "./lib/api-client";
import { useAppStore } from "./stores/use-app-store";
import { useExplorerStore } from "./stores/use-explorer-store";
import { useSessionStore } from "./stores/use-session-store";
import { setupProjectStatusSubscription } from "./stores/session-subscriptions";
import { useChatStore } from "./stores/use-chat-store";
import { createLogger } from "../shared/lib/logger";
import { MainLayout } from "./layouts/MainLayout";
import { ProjectPickerDialog } from "./components/project-picker/ProjectPickerDialog";
import { DiagnosticPanel } from "./components/debug/DiagnosticPanel";
import { useDiagnosticStore } from "./stores/use-diagnostic-store";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginPage } from "./components/LoginPage";
import { notificationGateway } from "./lib/notification-gateway";
import { pushChannel } from "./lib/channels/push-channel";
import {
  parseDeepLink,
  setupDeepLinkListener,
  executeDeepLinkRecovery,
} from "./lib/deep-link-handler";
import { useEdgeSwipe } from "./hooks/use-edge-swipe";
import { offlineQueue } from "./lib/offline-queue";

function App() {
  const { t } = useTranslation("common");
  const log = createLogger("chat");
  const ready = useAppStore((s) => s.ready);
  const initializeConnection = useAppStore((s) => s.initializeConnection);
  const addLog = useAppStore((s) => s.addLog);
  const connectionStatus = useAppStore((s) => s.connectionStatus);
  const connectionFailed = useAppStore((s) => s.connectionFailed);
  const listRootDir = useExplorerStore((s) => s.listRootDir);

  // 边缘滑动手势
  useEdgeSwipe();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const restoredFlag = useAppStore((s) => s.restored);
  const [restoring, setRestoring] = useState(!useAppStore.getState().restored);
  const addProjectTab = useSessionStore((s) => s.addProjectTab);
  const loadSessionsForProject = useSessionStore((s) => s.loadSessionsForProject);
  const restoreFromPersisted = useSessionStore((s) => s.restoreFromPersisted);
  const [hasToken, setHasToken] = useState(() => !!resolveAuthToken());
  const [loginError, setLoginError] = useState<string | null>(null);
  const loginTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deepLinkHandledRef = useRef(false);
  const pushRegisteredRef = useRef(false);
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
      initializeConnection();
      setupProjectStatusSubscription();
    };

    doInit();

    return () => {
      cancelled = true;
    };
  }, [initializeConnection, hasToken]);

  useEffect(() => {
    if (!hasToken) return;
    if (deepLinkHandledRef.current) return;

    const unsubscribe = setupDeepLinkListener((url) => {
      try {
        const data = parseDeepLink(url);
        if (!data || data.action === "home") return;
        if (deepLinkHandledRef.current) return;
        deepLinkHandledRef.current = true;

        addLog(`Deep link received: ${url}`);

        const waitReady = () =>
          new Promise<void>((resolve) => {
            if (useAppStore.getState().ready) return resolve();
            const unsub = useAppStore.subscribe((s) => {
              if (s.ready) {
                unsub();
                resolve();
              }
            });
          });

        executeDeepLinkRecovery(data, {
          isConnected: () => apiClient.isConnected(),
          waitForConnection: waitReady,
          openProject: async (projectId: string) => {
            await apiClient.call("project.open", { path: projectId });
          },
          addProjectTab: (projectId: string) => {
            const name = projectId.split("/").filter(Boolean).pop() ?? projectId;
            const tabId = `proj-${projectId.replace(/\//g, "-")}`;
            useSessionStore.getState().addProjectTab({ id: tabId, name, path: projectId });
          },
          restoreSession: async (sessionId: string) => {
            try {
              const lookup = await apiClient.call("project.findSessionById", { sessionId });
              const info = lookup.session as {
                sessionPath: string;
                projectPath: string;
                name: string;
              } | null;
              if (!info) return;
              await apiClient.call("agent.start", {
                sessionId,
                projectPath: info.projectPath,
                sessionPath: info.sessionPath,
              });
              useSessionStore.getState().setActiveSession(sessionId, true);
              useChatStore.getState().loadSessionMessages(sessionId, {
                force: true,
                sessionPath: info.sessionPath,
              });
            } catch (err) {
              addLog(
                `Deep link restore session failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          },
          listRecentSessions: async (projectId: string) => {
            const sessions = await useSessionStore.getState().loadSessionsForProject(projectId);
            return sessions.map((s) => ({ id: s.sessionId }));
          },
          createNewSession: async (_projectId: string) => {
            await useSessionStore.getState().createNewSession();
            const sid = useSessionStore.getState().activeSessionId;
            if (!sid) throw new Error("Failed to create session");
            return sid;
          },
          scrollToMessage: () => {},
          getCurrentProjectId: () => useSessionStore.getState().activeProjectId ?? undefined,
          getCurrentSessionId: () => useSessionStore.getState().activeSessionId ?? undefined,
        }).catch((err) => {
          addLog(`Deep link recovery failed: ${err instanceof Error ? err.message : String(err)}`);
        });
      } catch (err) {
        addLog(`Deep link parse failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

    return unsubscribe;
  }, [hasToken, addLog]);

  useEffect(() => {
    if (!ready || pushRegisteredRef.current) return;
    pushRegisteredRef.current = true;
    try {
      notificationGateway.registerChannel(pushChannel);
      addLog("Push channel registered");
    } catch (err) {
      addLog(
        `Push channel registration failed: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }, [ready, addLog]);

  // 连接恢复后 flush 离线队列
  useEffect(() => {
    if (connectionStatus !== "connected" || !offlineQueue.hasPending()) return;
    offlineQueue
      .flush(async (msg) => {
        try {
          await apiClient.call("agent.send", {
            sessionId: msg.sessionId,
            content: msg.content,
          });
          return true;
        } catch {
          return false;
        }
      })
      .then((sent) => {
        if (sent > 0) addLog(`离线队列已发送 ${sent} 条消息`);
      });
  }, [connectionStatus, addLog]);

  useEffect(() => {
    if (!ready || restoredFlag) return;

    let cancelled = false;
    useAppStore.setState({ restored: true });
    setRestoring(true);

    (async () => {
      try {
        listRootDir();

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
            useSessionStore.getState().setActiveProject(tabId);

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
        const restored = await restoreFromPersisted();
        if (restored) {
          addLog("Restored last session from cache");
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
          useSessionStore.getState().setActiveProject(targetId);

          const tab = savedTabs.find((t) => t.id === targetId);
          if (tab) {
            const sessions = await loadSessionsForProject(tab.path);
            addLog(
              `Restored ${savedTabs.length} tabs from server config (${sessions.length} sessions)`,
            );
            if (sessions.length > 0) {
              const sid = sessions[0].sessionId;
              useSessionStore.getState().setActiveSession(sid);
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

        const sessions = await loadSessionsForProject(first.path);
        addLog(`Restored project: ${first.name} (${sessions.length} sessions)`);

        if (sessions.length > 0) {
          const sid = sessions[0].sessionId;
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

  if (connectionFailed) {
    return (
      <ErrorBoundary>
        <LoginPage
          onLogin={handleLogin}
          loginError="连接服务器失败，请检查服务器地址和 Token"
          onClearError={() => {
            useAppStore.setState({ connectionFailed: false });
            setLoginError(null);
          }}
        />
      </ErrorBoundary>
    );
  }

  if (!ready || restoring || projectLoading) {
    return (
      <ErrorBoundary>
        <div className="h-screen flex items-center justify-center bg-white dark:bg-gray-950">
          <div className="text-center">
            <div className="inline-block w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-4" />
            <div className="text-gray-500 dark:text-gray-400 text-sm">
              {!ready
                ? t("connectingRpc")
                : projectLoading
                  ? t("loadingProject")
                  : t("restoringSession")}
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
