import { useEffect, useCallback, useRef } from "react";
import { useLayoutStore } from "./use-layout-store";
import type { Breakpoint } from "./types";
import { TabBar } from "../components/tab-bar/TabBar";
import { ChatPanel } from "../components/chat/ChatPanel";
import { LeftSidebar } from "../components/left-sidebar/LeftSidebar";
import { RightSidebar } from "../components/right-sidebar/RightSidebar";
import { FilePreviewOverlay } from "../components/file-preview/FilePreviewOverlay";
import { DiffViewerPanel } from "../components/diff/DiffViewerPanel";
import { useExplorerStore } from "../stores/use-explorer-store";
import { useGitStore } from "../stores/use-git-store";

interface MainLayoutProps {
  onAddProject: () => void;
}

export function MainLayout({ onAddProject }: MainLayoutProps) {
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const setBreakpoint = useLayoutStore((s) => s.setBreakpoint);
  const sessionWidth = useLayoutStore((s) => s.sessionWidth);
  const statusWidth = useLayoutStore((s) => s.statusWidth);
  const setSessionWidth = useLayoutStore((s) => s.setSessionWidth);
  const setStatusWidth = useLayoutStore((s) => s.setStatusWidth);

  const sessionPanel = useLayoutStore((s) => s.sessionPanel);
  const statusPanel = useLayoutStore((s) => s.statusPanel);

  const leftResizingRef = useRef(false);
  const rightResizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWRef = useRef(0);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setBreakpoint(getBP(w));
      }
    });
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [setBreakpoint]);

  function getBP(w: number): Breakpoint {
    if (w < 640) return "mobile";
    if (w < 1024) return "tablet";
    if (w < 1440) return "desktop";
    return "wide";
  }

  const handleLeftResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      leftResizingRef.current = true;
      startXRef.current = e.clientX;
      startWRef.current = sessionWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        if (!leftResizingRef.current) return;
        setSessionWidth(startWRef.current + ev.clientX - startXRef.current);
      };
      const onUp = () => {
        leftResizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [sessionWidth, setSessionWidth]
  );

  const handleRightResize = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      rightResizingRef.current = true;
      startXRef.current = e.clientX;
      startWRef.current = statusWidth;
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
      const onMove = (ev: MouseEvent) => {
        if (!rightResizingRef.current) return;
        setStatusWidth(startWRef.current - ev.clientX + startXRef.current);
      };
      const onUp = () => {
        rightResizingRef.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [statusWidth, setStatusWidth]
  );

  const isMobile = breakpoint === "mobile";
  const isTablet = breakpoint === "tablet";

  const handleChatAreaClick = useCallback(() => {
    const store = useLayoutStore.getState();
    if (store.sessionPanel === "visible") store.hideSession();
    if (store.statusPanel === "visible") store.hideStatus();
  }, []);

  const filePreview = useExplorerStore((s) => s.filePreview);
  const loadingFile = useExplorerStore((s) => s.loadingFile);
  const closePreview = useExplorerStore((s) => s.closePreview);
  const currentDiff = useGitStore((s) => s.currentDiff);

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* === ROW 1: Top Tab Bar === */}
      <TabBar onAddProject={onAddProject} />

      {/* === ROW 2: Body - 5 columns === */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* ---- Mobile drawer backdrop ---- */}
        {isMobile && (sessionPanel === "visible" || statusPanel === "visible") && (
          <div
            className="absolute inset-0 bg-black/50 z-10 animate-in fade-in duration-150"
            onClick={handleChatAreaClick}
          />
        )}

        {/* ---- COL 1: Left Sidebar ---- */}
        {sessionPanel !== "hidden" && (!isMobile || sessionPanel === "visible") && (
          <LeftSidebar
            width={sessionPanel === "pinned" ? sessionWidth : isMobile ? Math.round(window.innerWidth * 0.85) : 260}
            overlay={sessionPanel === "visible"}
            onResizeStart={handleLeftResize}
          />
        )}

        {/* ---- COL 2: Chat Area (center) ---- */}
        <div
          className="flex-1 flex flex-col overflow-hidden relative min-w-0 transition-all duration-200 ease-out"
          onClick={handleChatAreaClick}
        >
          <ChatPanel />
          {filePreview && (
            <div onClick={(e) => e.stopPropagation()}>
              <FilePreviewOverlay
                preview={filePreview}
                loading={loadingFile}
                onClose={closePreview}
              />
            </div>
          )}
          {currentDiff && (
            <div onClick={(e) => e.stopPropagation()}>
              <DiffViewerPanel />
            </div>
          )}
        </div>

        {/* ---- COL 3: Right Sidebar ---- */}
        {statusPanel !== "hidden" && (!isMobile || statusPanel === "visible") && !isTablet && (
          <RightSidebar
            width={statusPanel === "pinned" ? statusWidth : isMobile ? Math.round(window.innerWidth * 0.85) : 300}
            overlay={statusPanel === "visible"}
            onResizeStart={handleRightResize}
          />
        )}
      </div>
    </div>
  );
}
