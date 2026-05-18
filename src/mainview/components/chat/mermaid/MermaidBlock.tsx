import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useMermaidStore } from "../../../stores/use-mermaid-store";
import { useThemeStore, isDarkGroup } from "../../../stores/use-theme-store";

const MERMAID_LANGS = new Set([
  "mermaid",
  "sequence",
  "sequencediagram",
  "flowchart",
  "flow",
  "classdiagram",
  "class",
  "statediagram",
  "state",
  "erdiagram",
  "er",
  "gantt",
  "pie",
  "gitgraph",
  "git",
  "journey",
  "userjourney",
  "mindmap",
  "timeline",
  "quadrantchart",
  "quadrant",
  "sankey",
  "xychart",
  "block",
  "c4",
  "c4context",
]);

export function isMermaidLang(lang: string): boolean {
  return MERMAID_LANGS.has(lang.toLowerCase());
}

interface MermaidAPI {
  initialize: (config: Record<string, unknown>) => void;
  render: (id: string, code: string) => Promise<{ svg: string }>;
}

let mermaidModule: MermaidAPI | null = null;
let initialized = false;
let counter = 0;

async function loadMermaid(theme: "light" | "dark"): Promise<MermaidAPI> {
  if (mermaidModule) {
    mermaidModule.initialize({
      startOnLoad: false,
      theme: theme === "dark" ? "dark" : "default",
      securityLevel: "strict",
    });
    return mermaidModule;
  }
  const mod = await import("mermaid");
  mermaidModule = mod.default as MermaidAPI;
  if (!initialized) {
    mermaidModule.initialize({
      startOnLoad: false,
      theme: theme === "dark" ? "dark" : "default",
      securityLevel: "strict",
    });
    initialized = true;
  }
  return mermaidModule;
}

interface MermaidBlockProps {
  code: string;
  inline?: boolean;
}

export const MermaidBlock = memo(function MermaidBlock({ code, inline = true }: MermaidBlockProps) {
  const { t } = useTranslation("chat");
  const [svg, setSvg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [scale, setScale] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const openFullscreen = useMermaidStore((s) => s.openFullscreen);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);

  useEffect(() => {
    let cancelled = false;
    const id = `m-${++counter}-${Date.now()}`;
    setLoading(true);
    setError(null);
    setSvg(null);

    loadMermaid(isDarkGroup(resolvedTheme) ? "dark" : "light")
      .then((m) => m.render(id, code))
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
          setError(null);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
      const el = document.getElementById(id);
      if (el) el.remove();
    };
  }, [code, resolvedTheme]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || !inline) return;
    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => Math.min(5, Math.max(0.25, s + e.deltaY * -0.002)));
    };
    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, [inline]);

  const handleZoomIn = useCallback(() => setScale((s) => Math.min(5, s + 0.25)), []);
  const handleZoomOut = useCallback(() => setScale((s) => Math.max(0.25, s - 0.25)), []);
  const handleReset = useCallback(() => setScale(1), []);
  const handleFullscreen = useCallback(() => openFullscreen(code), [code, openFullscreen]);

  if (loading && !svg && !error) {
    return (
      <div className="rounded-lg border border-border-secondary dark:border-border-secondary bg-bg-elevated dark:bg-surface-code/60 p-4 my-3 flex items-center justify-center min-h-[80px]">
        <div className="inline-block w-4 h-4 border-2 border-indigo-500 dark:border-indigo-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-red-300/50 dark:border-red-900/50 bg-bg-elevated dark:bg-surface-code/60 my-3 overflow-hidden">
        <div className="px-3 py-1.5 text-xs text-red-500 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border-b border-red-300/30 dark:border-red-900/30"></div>
        <pre className="p-3 text-xs text-text-primary dark:text-text-secondary overflow-x-auto font-mono">
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-secondary dark:border-border-secondary bg-bg-elevated dark:bg-surface-code/60 my-3 overflow-hidden group relative">
      <div
        ref={containerRef}
        className="overflow-auto p-4"
        style={inline ? { maxHeight: 500 } : undefined}
      >
        <div
          style={{
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            transition: "transform 0.15s ease",
          }}
          dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
        />
      </div>
      <div className="absolute top-2 right-2 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity bg-bg-elevated/90 dark:bg-surface-dim/90 rounded-md border border-border-secondary dark:border-border-secondary p-0.5">
        <button
          onClick={handleZoomOut}
          className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary dark:text-text-tertiary hover:text-text-primary dark:hover:text-text-primary"
          title={t("zoomOut")}
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={handleReset}
          className="px-1.5 py-0.5 text-xs text-text-tertiary dark:text-text-tertiary hover:text-text-primary dark:hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover rounded min-w-[3rem] text-center"
          title={t("resetZoom")}
        >
          {Math.round(scale * 100)}%
        </button>
        <button
          onClick={handleZoomIn}
          className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary dark:text-text-tertiary hover:text-text-primary dark:hover:text-text-primary"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        {inline && (
          <>
            <div className="w-px h-4 bg-border-secondary dark:border-border-secondary mx-0.5" />
            <button
              onClick={handleFullscreen}
              className="p-1 rounded hover:bg-surface-hover dark:hover:bg-surface-hover text-text-tertiary dark:text-text-tertiary hover:text-text-primary dark:hover:text-text-primary"
              title={t("fullscreenView")}
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </>
        )}
      </div>
    </div>
  );
});
