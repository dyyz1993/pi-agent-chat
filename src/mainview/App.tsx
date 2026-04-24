import { useEffect, useCallback, useRef } from "react";
import { Wifi, Monitor } from "lucide-react";
import { apiClient } from "./lib/api-client";
import { useAppStore } from "./stores/use-app-store";
import { useExplorerStore } from "./stores/use-explorer-store";
import { useChatStore } from "./stores/use-chat-store";
import { useSidebarStore } from "./stores/use-sidebar-store";
import { useBreakpointSync } from "./hooks/use-breakpoint";
import { ActivityBar } from "./components/activity-bar/ActivityBar";
import { MobileTabBar } from "./components/activity-bar/MobileTabBar";
import { ExplorerSidebar } from "./components/explorer/ExplorerSidebar";
import { GitPanel } from "./components/git/GitPanel";
import { ChatPanel } from "./components/chat/ChatPanel";
import { FilePreviewOverlay } from "./components/file-preview/FilePreviewOverlay";
import { DiffViewerPanel } from "./components/diff/DiffViewerPanel";
import { DebugPanel } from "./components/debug/DebugPanel";

function App() {
  const mode = useAppStore((s) => s.mode);
  const ready = useAppStore((s) => s.ready);
  const initializeConnection = useAppStore((s) => s.initializeConnection);
  const addLog = useAppStore((s) => s.addLog);

  const treeNodes = useExplorerStore((s) => s.treeNodes);
  const currentPath = useExplorerStore((s) => s.currentPath);
  const selectedPath = useExplorerStore((s) => s.selectedPath);
  const filePreview = useExplorerStore((s) => s.filePreview);
  const loadingFile = useExplorerStore((s) => s.loadingFile);
  const editingNode = useExplorerStore((s) => s.editingNode);
  const setCurrentPath = useExplorerStore((s) => s.setCurrentPath);
  const listRootDir = useExplorerStore((s) => s.listRootDir);
  const toggleNode = useExplorerStore((s) => s.toggleNode);
  const openFile = useExplorerStore((s) => s.openFile);
  const closePreview = useExplorerStore((s) => s.closePreview);
  const createFile = useExplorerStore((s) => s.createFile);
  const createDir = useExplorerStore((s) => s.createDir);
  const renameNode = useExplorerStore((s) => s.renameNode);
  const deleteNode = useExplorerStore((s) => s.deleteNode);
  const startEditing = useExplorerStore((s) => s.startEditing);
  const cancelEditing = useExplorerStore((s) => s.cancelEditing);
  const importFiles = useExplorerStore((s) => s.importFiles);

  const activePanel = useSidebarStore((s) => s.activePanel);
  const isPinned = useSidebarStore((s) => s.isPinned);
  const drawerOpen = useSidebarStore((s) => s.drawerOpen);
  const setDrawerOpen = useSidebarStore((s) => s.setDrawerOpen);
  const sidebarWidth = useSidebarStore((s) => s.sidebarWidth);
  const setSidebarWidth = useSidebarStore((s) => s.setSidebarWidth);
  const breakpoint = useSidebarStore((s) => s.breakpoint);

  // 全局单一 ResizeObserver 同步断点
  useBreakpointSync();

  const isMobile = breakpoint === "mobile";
  const isDesktop = breakpoint === "desktop";

  const sidebarIsDrawer = isMobile || !isPinned;
  const showSidebar = activePanel !== null && (isPinned || drawerOpen);
  const showDebug = isDesktop;

  // Resize handle
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    resizingRef.current = true;
    startXRef.current = e.clientX;
    startWidthRef.current = sidebarWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: MouseEvent) => {
      if (!resizingRef.current) return;
      const delta = ev.clientX - startXRef.current;
      setSidebarWidth(startWidthRef.current + delta);
    };
    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [sidebarWidth, setSidebarWidth]);

  // Initialize RPC connection
  useEffect(() => {
    initializeConnection();
  }, [initializeConnection]);

  // On ready: subscribe to chat.message + load history + init explorer
  useEffect(() => {
    if (!ready) return;

    let subscriptionId: string | null = null;

    const setup = async () => {
      // Initialize explorer with project root
      listRootDir();

      subscriptionId = await apiClient.subscribe("chat.message", (payload) => {
        useChatStore.getState().addMessage({
          id: payload.id,
          role: payload.role,
          content: payload.content,
          timestamp: payload.timestamp,
        });
      }, {});
      addLog("Subscribed to chat.message");

      try {
        const history = await apiClient.call("chat.list", { limit: 100 });
        if (history.messages.length > 0) {
          useChatStore.getState().setMessages(
            history.messages.map((m: { id: string; role: "user" | "assistant"; content: string; timestamp: number }) => ({
              id: m.id,
              role: m.role,
              content: m.content,
              timestamp: m.timestamp,
            }))
          );
          addLog(`Loaded ${history.messages.length} history messages`);
        }
      } catch (err) {
        addLog(`Failed to load history: ${err instanceof Error ? err.message : String(err)}`);
      }
    };
    setup();

    return () => {
      if (subscriptionId) {
        apiClient.unsubscribe(subscriptionId);
      }
    };
  }, [ready, addLog, listRootDir]);

  if (!ready) {
    return (
      <div className="h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin mb-4" />
          <div className="text-gray-400 text-sm">Connecting to RPC server...</div>
        </div>
      </div>
    );
  }

  const sidebarContent = activePanel === "explorer" ? (
    <ExplorerSidebar
      treeNodes={treeNodes}
      currentPath={currentPath}
      selectedPath={selectedPath}
      editingNode={editingNode}
      onPathChange={setCurrentPath}
      onRefresh={listRootDir}
      onToggle={toggleNode}
      onOpenFile={openFile}
      onCreateFile={createFile}
      onCreateDir={createDir}
      onRenameNode={renameNode}
      onDeleteNode={deleteNode}
      onStartEditing={startEditing}
      onCancelEditing={cancelEditing}
      onImportFiles={importFiles}
      hideOuterShell
    />
  ) : activePanel === "git" ? (
    <GitPanel hideOuterShell />
  ) : activePanel === "search" ? (
    <div className="flex-1 flex items-center justify-center text-gray-500 text-xs p-4 text-center">
      Search panel coming soon
    </div>
  ) : null;

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden">
      {/* Title bar — mobile 隐藏 */}
      {!isMobile && (
        <div className="h-8 bg-gray-800 flex items-center px-3 text-xs border-b border-gray-700 flex-shrink-0">
          <span className={`px-2 py-0.5 rounded flex items-center gap-1 ${mode === "desktop" ? "bg-green-600" : "bg-blue-600"}`}>
            {mode === "desktop" ? <Monitor className="w-3 h-3" /> : <Wifi className="w-3 h-3" />}
            {mode === "desktop" ? "Desktop (IPC)" : "Web (WebSocket)"}
          </span>
          <span className="ml-3 text-gray-400">PiAgentChat</span>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden relative">
        {/* Desktop/Tablet: 左侧 ActivityBar */}
        {!isMobile && <ActivityBar />}

        {/* Sidebar — Pinned 模式 */}
        {showSidebar && isPinned && !isMobile && (
          <div className="bg-gray-850 border-r border-gray-700 flex flex-col flex-shrink-0 overflow-hidden relative"
            style={{ width: sidebarWidth }}>
            {sidebarContent}
            {/* Resize handle */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1 cursor-col-resize hover:bg-indigo-500/50 active:bg-indigo-500 transition-colors z-10"
              onMouseDown={handleResizeStart}
            />
          </div>
        )}

        {/* CENTER: Chat + File preview + Diff */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          <ChatPanel />
          {filePreview && (
            <FilePreviewOverlay
              preview={filePreview}
              loading={loadingFile}
              onClose={closePreview}
            />
          )}
          <DiffViewerPanel />
        </div>

        {/* Debug — 仅 desktop */}
        {showDebug && <DebugPanel />}
      </div>

      {/* Drawer 覆盖层 */}
      {sidebarIsDrawer && showSidebar && (
        <>
          <div
            className="fixed inset-0 bg-black/50 z-40"
            style={isMobile ? { bottom: 56 } : undefined}
            onClick={() => setDrawerOpen(false)}
          />
          <div
            className="fixed left-0 top-0 w-60 z-50 bg-gray-850 border-r border-gray-700 flex flex-col overflow-hidden"
            style={isMobile ? { top: 0, bottom: 56 } : { top: 0, bottom: 0 }}
          >
            {sidebarContent}
          </div>
        </>
      )}

      {/* Mobile: 底部 Tab Bar */}
      {isMobile && <MobileTabBar />}
    </div>
  );
}

export default App;
