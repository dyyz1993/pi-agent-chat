import { useState, useMemo, useCallback } from "react";
import { Columns2, Rows3 } from "lucide-react";
import { useTranslation } from "react-i18next";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Highlight, Prism, themes } from "prism-react-renderer";
import { useGitStore } from "../../stores/use-git-store";
import { useThemeStore, isDarkGroup } from "../../stores/use-theme-store";
import { useLayoutStore } from "../../layouts/use-layout-store";
import { formatFilePath } from "../../lib/format-path";
import { getLanguage } from "../../utils/file-utils";
import { createDiffStyles, DIFF_STYLE_PRESETS } from "./diff-style-factory";
import { FullscreenOverlay } from "../primitives";
import { registerShellPrismLanguage } from "../../lib/prism-languages";

registerShellPrismLanguage(Prism);

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

  const actions = !isMobile ? (
    <div className="flex items-center gap-1">
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
    </div>
  ) : undefined;

  const title = (
    <>
      <span className="font-medium">{fileName}</span>
      <span className="text-text-tertiary truncate text-[10px] ml-2" title={rawPath}>
        {rawPath ? formatFilePath(rawPath) : ""}
      </span>
    </>
  );

  return (
    <FullscreenOverlay
      title={title}
      onClose={clearDiff}
      closeLabel={t("closeDiff")}
      actions={actions}
      position="absolute"
      layer="modal"
      headerClassName="h-9 text-xs gap-2"
    >
      {loadingDiff ? (
        <div className="flex items-center justify-center h-full text-text-tertiary text-sm">
          <div className="w-5 h-5 border-2 border-semantic-accent border-t-transparent rounded-full animate-spin mr-2" />
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
    </FullscreenOverlay>
  );
}
