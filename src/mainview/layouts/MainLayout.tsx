import { useEffect, useCallback, useRef } from "react";
import { useLayoutStore } from "./use-layout-store";
import type { Breakpoint } from "./types";
import { TabBar } from "../components/tab-bar/TabBar";
import { ChatPanel } from "../components/chat/ChatPanel";
import { LeftSidebar } from "../components/left-sidebar/LeftSidebar";
import { RightSidebar } from "../components/right-sidebar/RightSidebar";
import { FilePreviewOverlay } from "../components/file-preview/FilePreviewOverlay";
import { DiffViewerPanel } from "../components/diff/DiffViewerPanel";
import { ConnectionBanner } from "../components/ConnectionBanner";
import { useExplorerStore } from "../stores/use-explorer-store";
import { useGitStore } from "../stores/use-git-store";

interface MainLayoutProps {
  onAddProject: () => void;
}

export function MainLayout({ onAddProject }: MainLayoutProps) {
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const setBreakpoint = useLayoutStore((s) => s.setBreakpoint);
  const contentWidth = useLayoutStore((s) => s.contentWidth);
  const setContentWidth = useLayoutStore((s) => s.setContentWidth);
  const sessionWidth = useLayoutStore((s) => s.sessionWidth);
  const statusWidth = useLayoutStore((s) => s.statusWidth);
  const setSessionWidth = useLayoutStore((s) => s.setSessionWidth);
  const setStatusWidth = useLayoutStore((s) => s.setStatusWidth);

  const sessionPanel = useLayoutStore((s) => s.sessionPanel);
  const statusPanel = useLayoutStore((s) => s.statusPanel);
  const sessionCollapsed = useLayoutStore((s) => s.sessionCollapsed);
  const toggleSessionCollapse = useLayoutStore((s) => s.toggleSessionCollapse);

  const leftResizingRef = useRef(false);
  const rightResizingRef = useRef(false);

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const w = entry.contentRect.width;
        setBreakpoint(getBP(w));
        setContentWidth(Math.round(w));
      }
    });
    observer.observe(document.documentElement);
    return () => observer.disconnect();
  }, [setBreakpoint, setContentWidth]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "b") {
        e.preventDefault();
        toggleSessionCollapse();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [toggleSessionCollapse]);

  function getBP(w: number): Breakpoint {
    if (w < 640) return "mobile";
    if (w < 1024) return "tablet";
    if (w < 1440) return "desktop";
    return "wide";
  }

  function attachDrag(
    startX: number,
    startWidth: number,
    direction: "left" | "right",
    setter: (w: number) => void,
    resizingRef: React.MutableRefObject<boolean>,
  ) {
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    resizingRef.current = true;

    const sign = direction === "left" ? 1 : -1;

    const onMove = (ev: MouseEvent | TouchEvent) => {
      if (!resizingRef.current) return;
      const clientX = "touches" in ev ? ev.touches[0].clientX : ev.clientX;
      setter(startWidth + sign * (clientX - startX));
    };

    const onTouchMove = (ev: TouchEvent) => {
      ev.preventDefault();
      onMove(ev);
    };

    const onUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    window.addEventListener("touchend", onUp);
  }

  const handleLeftResize = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      attachDrag(clientX, sessionWidth, "left", setSessionWidth, leftResizingRef);
    },
    [sessionWidth, setSessionWidth],
  );

  const handleRightResize = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      e.preventDefault();
      const clientX = "touches" in e ? e.touches[0].clientX : e.clientX;
      attachDrag(clientX, statusWidth, "right", setStatusWidth, rightResizingRef);
    },
    [statusWidth, setStatusWidth],
  );

  const isMobile = breakpoint === "mobile";
  const isTablet = breakpoint === "tablet";

  const showLeftHandle = sessionPanel === "pinned" && !isMobile && !sessionCollapsed;
  const showRightHandle = statusPanel === "pinned" && !isMobile && !isTablet;

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
    <div className="h-screen bg-white text-gray-900 dark:bg-gray-950 dark:text-white flex flex-col overflow-hidden">
      <ConnectionBanner />
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
        {sessionPanel !== "hidden" &&
          !sessionCollapsed &&
          (!isMobile || sessionPanel === "visible") && (
            <LeftSidebar
              width={isMobile ? Math.round(contentWidth * 0.85) : sessionWidth}
              overlay={sessionPanel === "visible"}
            />
          )}

        {/* ---- Left Resize Handle ---- */}
        {showLeftHandle && (
          <div
            className="resize-handle"
            style={{ left: sessionWidth }}
            onMouseDown={handleLeftResize}
            onTouchStart={handleLeftResize}
          >
            <div className="resize-handle-indicator w-0.5 h-8 rounded-full bg-gray-700 transition-all duration-150 mx-auto mt-[50vh] -translate-y-1/2" />
          </div>
        )}

        {/* ---- COL 2: Chat Area (center) ---- */}
        <div
          className="flex-1 flex flex-col overflow-hidden relative min-w-[240px]"
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

        {/* ---- Right Resize Handle ---- */}
        {showRightHandle && (
          <div
            className="resize-handle"
            style={{ right: statusWidth }}
            onMouseDown={handleRightResize}
            onTouchStart={handleRightResize}
          >
            <div className="resize-handle-indicator w-0.5 h-8 rounded-full bg-gray-700 transition-all duration-150 mx-auto mt-[50vh] -translate-y-1/2" />
          </div>
        )}

        {/* ---- COL 3: Right Sidebar ---- */}
        {statusPanel !== "hidden" && (!isMobile || statusPanel === "visible") && (
          <RightSidebar
            width={isMobile ? Math.round(contentWidth * 0.85) : isTablet ? 48 : statusWidth}
            overlay={statusPanel === "visible"}
          />
        )}
      </div>
    </div>
  );
}
