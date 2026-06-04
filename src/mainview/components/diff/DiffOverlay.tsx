import { useState, useMemo, useCallback } from "react";
import { X, Columns2, Rows3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Highlight, themes } from "prism-react-renderer";
import { useGitStore } from "../../stores/use-git-store";
import { useThemeStore, isDarkGroup } from "../../stores/use-theme-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { formatFilePath } from "../../lib/format-path";
import { getLanguage } from "../../utils/file-utils";
import { createDiffStyles, DIFF_STYLE_PRESETS } from "./diff-style-factory";

function useSyntaxRenderer(filePath: string | undefined) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const prismTheme = isDarkGroup(resolvedTheme) ? themes.nightOwl : themes.nightOwlLight;
  const language = filePath ? getLanguage(filePath) : "";

  return useCallback(
    (source: string) => {
      if (!language) return <>{source}</>;
      return (
        <Highlight theme={prismTheme} code={source} language={language}>
          {({ tokens, getLineProps, getTokenProps }) => (
            <>
              {tokens.map((line, i) => (
                <span key={i} {...getLineProps({ line })}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token })} />
                  ))}
                  {i < tokens.length - 1 && "\n"}
                </span>
              ))}
            </>
          )}
        </Highlight>
      );
    },
    [language, prismTheme],
  );
}

export function DiffOverlay() {
  const { t } = useTranslation("sidebar");
  const currentDiff = useGitStore((s) => s.currentDiff);
  const loadingDiff = useGitStore((s) => s.loadingDiff);
  const clearDiff = useGitStore((s) => s.clearDiff);
  const [splitView, setSplitView] = useState(false);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const isDark = isDarkGroup(resolvedTheme);
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const isMobile = breakpoint === "mobile";
  const effectiveSplitView = isMobile ? false : splitView;

  const rawPath = currentDiff?.filePath ?? "";
  const styles = useMemo(
    () =>
      createDiffStyles(isMobile ? DIFF_STYLE_PRESETS.overlayMobile : DIFF_STYLE_PRESETS.overlay),
    [isMobile],
  );
  const renderContent = useSyntaxRenderer(rawPath);

  if (!currentDiff && !loadingDiff) return null;

  const fileName = rawPath.split("/").pop() ?? "";

  return (
    <div
      className="absolute inset-0 bg-bg-elevated dark:bg-surface-code flex flex-col"
      style={{ zIndex: 40 }}
    >
      <div className="h-9 bg-surface-dim border-b border-border-secondary flex items-center px-3 text-xs flex-shrink-0 gap-2">
        <span className="text-text-primary dark:text-text-secondary font-medium">{fileName}</span>
        <span className="text-text-tertiary truncate text-[10px]" title={rawPath}>
          {rawPath ? formatFilePath(rawPath) : ""}
        </span>
        <div className="ml-auto flex items-center gap-1">
          {!isMobile && (
            <>
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
            </>
          )}
          <button
            onClick={clearDiff}
            className="p-2 rounded text-text-tertiary hover:text-text-primary dark:hover:text-text-primary hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors"
            aria-label={t("closeDiff")}
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

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
            styles={styles}
            renderContent={renderContent}
            showDiffOnly
            {...(effectiveSplitView && { leftTitle: t("diffBefore"), rightTitle: t("diffAfter") })}
          />
        ) : null}
      </div>
    </div>
  );
}
