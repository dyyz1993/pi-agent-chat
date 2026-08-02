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
import { useGoalStore } from "./stores/use-goal-store";
import { useNotificationStore } from "./stores/use-notification-store";
import {
  runQuickCreateAutoStart,
  type QuickCreateAutoStart,
} from "./lib/quick-create-auto-start";
import { abortPreviousAndTrack } from "./lib/quick-create-registry";
import { createLogger } from "../shared/lib/logger";
import { MainLayout } from "./layouts/MainLayout";
import { ProjectPickerDialog } from "./components/project-picker/ProjectPickerDialog";
import { WelcomePage } from "./components/welcome/WelcomePage";
import { SshProjectDialog } from "./components/welcome/SshProjectDialog";
import { DiagnosticPanel } from "./components/debug/DiagnosticPanel";
import { useDiagnosticStore } from "./stores/use-diagnostic-store";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { LoginPage } from "./components/LoginPage";
import { createStartupTrace } from "./lib/startup-monitor";
import { runRestoreFlow } from "./lib/restore-flow";
import type { ProjectTab, RecentProject } from "./types";

function App() {
  const { t } = useTranslation("common");
  const log = createLogger("chat");
  const initError = useAppStore((s) => s.initError);
  const ready = useAppStore((s) => s.ready);
  const initializeConnection = useAppStore((s) => s.initializeConnection);
  const addLog = useAppStore((s) => s.addLog);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sshPickerOpen, setSshPickerOpen] = useState(false);
  const [projectLoading, setProjectLoading] = useState(false);
  const restoredFlag = useAppStore((s) => s.restored);
  const [restoring, setRestoring] = useState(!useAppStore.getState().restored);
  const addProjectTab = useSessionStore((s) => s.addProjectTab);
  const loadSessionsForProject = useSessionStore((s) => s.loadSessionsForProject);
  const projectTabs = useSessionStore((s) => s.projectTabs);

  const [hasToken, setHasToken] = useState(() => !!resolveAuthToken());
  const [loginError, setLoginError] = useState<string | null>(null);
  const loginTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quickStartAbortRef = useRef<AbortController | null>(null);
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
      quickStartAbortRef.current?.abort();
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
    const trace = createStartupTrace("app.restore");
    useAppStore.setState({ restored: true });
    setRestoring(true);

    runRestoreFlow({
      isCancelled: () => cancelled,
      setRestoring,
      addLog,
      callApi: (method, params) => apiClient.call(method as never, params as never),
      loadSessionsForProject,
      addProjectTab,
      setActiveProject: (id, opts) => useSessionStore.getState().setActiveProject(id, opts),
      setActiveSession: (id, skipFetch) =>
        useSessionStore.getState().setActiveSession(id, skipFetch),
      createNewSession: () => useSessionStore.getState().createNewSession(),
      getProjectTabs: () => useSessionStore.getState().projectTabs,
      getLastActiveSessionByProject: () => useSessionStore.getState().lastActiveSessionByProject,
      loadSessionMessages: (sid, opts) => useChatStore.getState().loadSessionMessages(sid, opts),
      log,
      trace,
    });

    return () => {
      cancelled = true;
    };
  }, [ready, addLog, addProjectTab, loadSessionsForProject]);

  // 启动期不再需要延迟 1.2s 再调一次 fetchAllProjectsSessionsStatus：
  // project.scanSessions 在加载每个项目 sessions 列表时，会顺带把该 RPC 的 batch 状态
  // 一起返回并写入 sessionStatusMap（见 session-project-actions.ts），
  // 所以活跃项目一加载完就立即拥有正确状态；非活跃项目由 TabBar 立刻拉。
  // 实时变化走 setupProjectStatusSubscription 推送。

  const handleSelectProject = async (
    path: string,
    name: string,
    options?: { quickStart?: QuickCreateAutoStart },
  ) => {
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
    useSessionStore
      .getState()
      .setActiveProject(tabId, options?.quickStart ? { skipAutoSession: true } : undefined);
    addLog(`Loaded project: ${name}`);

    setProjectLoading(false);

    if (options?.quickStart) {
      const controller = abortPreviousAndTrack(quickStartAbortRef);
      const notifStore = useNotificationStore.getState();
      const startNotifId = notifStore.push({
        message: t("quickCreate.started", { name, defaultValue: `Quick create started: ${name}` }),
        level: "warning",
        actions: [
          {
            id: "cancel",
            label: t("quickCreate.cancel", { defaultValue: "Cancel" }),
            onClick: () => controller.abort(),
          },
        ],
      });

      void runQuickCreateAutoStart(path, name, options.quickStart, {
        signal: controller.signal,
        createNewSession: (projectPath) =>
          useSessionStore.getState().createNewSession(projectPath),
        startAgent: (sessionId, projectPath, sessionPath) =>
          apiClient.call("agent.start", {
            sessionId,
            projectPath,
            sessionPath,
          }) as Promise<{ status: "started" | "already_running" }>,
        setInputText: (text) => useChatStore.getState().setInputText(text),
        sendMessage: () => useChatStore.getState().sendMessage(),
        startSetup: (sessionId, objective) =>
          useGoalStore.getState().startSetup(sessionId, objective),
        submitContract: (sessionId, contract) =>
          useGoalStore.getState().submitContract(sessionId, contract),
        fetchGoalStatus: async (sessionId) => {
          await useGoalStore.getState().fetchStatus(sessionId, { force: true });
          return useGoalStore.getState().bySession[sessionId]?.status ?? null;
        },
        approveContract: (sessionId) => useGoalStore.getState().approveContract(sessionId),
        addLog,
      })
        .then((result) => {
          if (startNotifId) notifStore.dismiss(startNotifId);
          if (result.goalStarted) {
            notifStore.push({
              message: t("quickCreate.completed", {
                name,
                defaultValue: `Quick create completed: ${name}`,
              }),
              level: "info",
            });
          } else if (/cancel/i.test(result.error ?? "")) {
            notifStore.push({
              message: t("quickCreate.cancelled", {
                name,
                defaultValue: `Quick create cancelled: ${name}`,
              }),
              level: "info",
            });
          } else {
            notifStore.push({
              message: t("quickCreate.failed", {
                name,
                error: result.error ?? "",
                defaultValue: `Quick create failed: ${result.error ?? "unknown error"}`,
              }),
              level: "warning",
            });
          }
        })
        .catch((err) => {
          if (startNotifId) notifStore.dismiss(startNotifId);
          const message = err instanceof Error ? err.message : String(err);
          addLog(`Quick create auto-start failed: ${message}`);
          log.warn("Quick create auto-start failed", { projectPath: path, error: message });
          notifStore.push({
            message: t("quickCreate.failed", {
              name,
              error: message,
              defaultValue: `Quick create failed: ${message}`,
            }),
            level: "error",
          });
        });
    }
  };

  const activateProjectTab = useCallback(
    (tab: ProjectTab) => {
      addProjectTab(tab);
      const nextTab = useSessionStore.getState().projectTabs.find((item) => item.path === tab.path);
      useSessionStore.getState().setActiveProject(nextTab?.id ?? tab.id);
    },
    [addProjectTab],
  );

  const handleRemoteProjectOpened = useCallback(
    (tab: ProjectTab) => {
      activateProjectTab(tab);
      addLog(`Loaded remote project: ${tab.name}`);
    },
    [activateProjectTab, addLog],
  );

  const handleSelectRecentProject = useCallback(
    (project: RecentProject) => {
      const tabId = project.remote
        ? `remote-${project.remote.host}-${project.path}`
        : `proj-${project.path.replace(/\//g, "-")}`;
      activateProjectTab({
        id: tabId,
        name: project.name,
        path: project.path,
        runtime: project.runtime,
        remote: project.remote,
      });
    },
    [activateProjectTab],
  );

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
                  className="inline-flex items-center gap-2 px-4 py-2 bg-accent hover:bg-accent-hover rounded-lg text-sm text-white transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  {t("retry")}
                </button>
              </>
            ) : (
              <>
                <div className="inline-block w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin mb-4" />
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
        {projectTabs.length === 0 ? (
          <WelcomePage
            onOpenLocalProject={() => setPickerOpen(true)}
            onOpenRemoteProject={() => setSshPickerOpen(true)}
            onSelectRecentProject={handleSelectRecentProject}
          />
        ) : (
          <MainLayout onAddProject={() => setPickerOpen(true)} />
        )}
        <ProjectPickerDialog
          open={pickerOpen}
          onClose={() => setPickerOpen(false)}
          onSelect={handleSelectProject}
          onOpenRemoteProject={() => setSshPickerOpen(true)}
        />
        <SshProjectDialog
          open={sshPickerOpen}
          onClose={() => setSshPickerOpen(false)}
          onOpened={handleRemoteProjectOpened}
        />
        <DiagnosticPanel />
      </>
    </ErrorBoundary>
  );
}

export default App;
