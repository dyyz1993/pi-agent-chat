import { useState } from "react";
import { X, Columns2, Rows3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { useGitStore } from "../../stores/use-git-store";
import { useThemeStore, isDarkGroup } from "../../stores/use-theme-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { formatFilePath } from "../../lib/format-path";

/* Module-level constant: avoids re-creating the styles object on every render */
export const DIFF_STYLES = {
  variables: {
    light: {
      diffViewerBackground: "var(--diff-bg)",
    },
    dark: {
      diffViewerBackground: "var(--diff-bg)",
      diffViewerColor: "var(--diff-color)",
      addedBackground: "var(--diff-added-bg)",
      addedColor: "var(--diff-added-color)",
      removedBackground: "var(--diff-removed-bg)",
      removedColor: "var(--diff-removed-color)",
      wordAddedBackground: "var(--diff-word-added-bg)",
      wordRemovedBackground: "var(--diff-word-removed-bg)",
      addedGutterBackground: "var(--diff-added-bg)",
      removedGutterBackground: "var(--diff-removed-bg)",
      gutterBackground: "var(--diff-gutter-bg)",
      gutterColor: "var(--diff-gutter-color)",
      codeFoldGutterBackground: "var(--diff-gutter-bg)",
      codeFoldBackground: "var(--diff-gutter-bg)",
      emptyLineBackground: "var(--diff-bg)",
      gutterBackgroundDark: "var(--diff-gutter-bg)",
      highlightGutterBackground: "var(--diff-highlight-bg)",
      highlightBackground: "var(--diff-highlight-bg)",
    },
  },
  line: {
    fontSize: "12px",
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    lineHeight: "1.6",
  },
  gutter: {
    fontSize: "12px",
    fontFamily: "ui-monospace, SFMono-Regular, monospace",
    minWidth: "40px",
    padding: "0 8px",
  },
} as const;

export function DiffViewerPanel() {
  const { t } = useTranslation("sidebar");
  const currentDiff = useGitStore((s) => s.currentDiff);
  const loadingDiff = useGitStore((s) => s.loadingDiff);
  const clearDiff = useGitStore((s) => s.clearDiff);
  const [splitView, setSplitView] = useState(false);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const isDark = isDarkGroup(resolvedTheme);
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const isMobileOrTablet = breakpoint === "mobile" || breakpoint === "tablet";
  const effectiveSplitView = isMobileOrTablet ? false : splitView;

  if (!currentDiff && !loadingDiff) return null;

  const rawPath = currentDiff?.filePath ?? "";
  const fileName = rawPath.split("/").pop() ?? "";

  return (
    <div
      className="absolute inset-0 bg-bg-elevated dark:bg-surface-code flex flex-col"
      style={{ zIndex: 40 }}
    >
      {/* Header */}
      <div className="h-9 bg-surface-dim border-b border-border-secondary flex items-center px-3 text-xs flex-shrink-0 gap-2">
        <span className="text-text-primary dark:text-text-secondary font-medium">{fileName}</span>
        <span className="text-text-tertiary truncate text-[10px]" title={rawPath}>
          {rawPath ? formatFilePath(rawPath) : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setSplitView(false)}
            className={`p-1 rounded transition-colors ${!splitView ? "bg-text-tertiary dark:bg-text-secondary text-white" : "text-text-tertiary hover:text-text-primary dark:hover:text-text-primary"}`}
            title={t("diffLineByLine")}
            aria-label={t("diffLineByLine")}
          >
            <Rows3 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setSplitView(true)}
            className={`p-1 rounded transition-colors ${splitView ? "bg-text-tertiary dark:bg-text-secondary text-white" : "text-text-tertiary hover:text-text-primary dark:hover:text-text-primary"}`}
            title={t("diffSideBySide")}
            aria-label={t("diffSideBySide")}
          >
            <Columns2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={clearDiff}
            className="p-2 rounded text-text-tertiary hover:text-text-primary dark:hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors"
            aria-label={t("closeDiff")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        {loadingDiff ? (
          <div className="flex items-center justify-center h-full text-text-tertiary">
            {t("loadingDiff")}
          </div>
        ) : currentDiff ? (
          <ReactDiffViewer
            oldValue={currentDiff.oldContent}
            newValue={currentDiff.newContent}
            splitView={effectiveSplitView}
            compareMethod={DiffMethod.LINES}
            useDarkTheme={isDark}
            leftTitle={t("diffBefore")}
            rightTitle={t("diffAfter")}
            styles={DIFF_STYLES}
          />
        ) : null}
      </div>
    </div>
  );
}
