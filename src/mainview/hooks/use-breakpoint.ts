import { useEffect } from "react";
import { useSidebarStore, type Breakpoint } from "../stores/use-sidebar-store";

function getBreakpoint(width: number): Breakpoint {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

/**
 * 单一 ResizeObserver，同步 breakpoint 到 sidebar store。
 * 组件通过 useSidebarStore(s => s.breakpoint) 读取。
 */
export function useBreakpointSync() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const obs = new ResizeObserver((entries) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const entry of entries) {
          const bp = getBreakpoint(entry.contentRect.width);
          if (bp !== useSidebarStore.getState().breakpoint) {
            useSidebarStore.getState()._setBreakpoint(bp);
          }
        }
      }, 100);
    });
    obs.observe(document.documentElement);
    return () => {
      clearTimeout(timer);
      obs.disconnect();
    };
  }, []);
}
