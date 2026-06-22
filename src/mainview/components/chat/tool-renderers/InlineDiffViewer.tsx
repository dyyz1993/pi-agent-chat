import { memo, useMemo, useCallback, useState } from "react";
import { Columns2, Rows3, Maximize2 } from "lucide-react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { Highlight, Prism, themes } from "prism-react-renderer";
import { useTranslation } from "react-i18next";
import { useThemeStore, isDarkGroup } from "../../../stores/use-theme-store";
import { useLayoutStore } from "../../../layouts/use-layout-store";
import { useChatOverlayStore } from "../../../stores/use-chat-overlay-store";
import { useGitStore } from "../../../stores/use-git-store";
import { getLanguage } from "../../../utils/file-utils";
import { createDiffStyles, DIFF_STYLE_PRESETS } from "../../diff/diff-style-factory";
import { registerShellPrismLanguage } from "../../../lib/prism-languages";

registerShellPrismLanguage(Prism);

interface InlineDiffViewerProps {
  oldValue: string;
  newValue: string;
  maxHeight?: string;
  splitView?: boolean;
  showToggle?: boolean;
  expandable?: boolean;
  filePath?: string;
}

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

export const InlineDiffViewer = memo(function InlineDiffViewer({
  oldValue,
  newValue,
  maxHeight = "200px",
  splitView: externalSplitView,
  showToggle = false,
  expandable = true,
  filePath,
}: InlineDiffViewerProps) {
  const { t } = useTranslation();
  const [internalSplitView, setInternalSplitView] = useState(false);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const isDark = isDarkGroup(resolvedTheme);
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const isMobile = breakpoint === "mobile";
  const openDiffOverlay = useChatOverlayStore((s) => s.openDiff);

  const splitView = externalSplitView ?? internalSplitView;

  const inlineStyles = useMemo(
    () => createDiffStyles(isMobile ? DIFF_STYLE_PRESETS.inlineMobile : DIFF_STYLE_PRESETS.inline),
    [isMobile],
  );

  const renderContent = useSyntaxRenderer(filePath);

  const handleExpand = useCallback(() => {
    // Reuse the same overlay channel as the git/file sidebar opens (openDiff → DiffOverlay),
    // so the expanded diff occupies the chat panel area consistently.
    useGitStore.setState({
      currentDiff: {
        filePath: filePath ?? "Diff",
        diff: "",
        oldContent: oldValue,
        newContent: newValue,
      },
      loadingDiff: false,
    });
    openDiffOverlay();
  }, [openDiffOverlay, filePath, oldValue, newValue]);

  const expandInToolbar = expandable && showToggle;
  const expandFloating = expandable && !showToggle;

  return (
    <>
      {showToggle && (
        <div className="flex items-center gap-1 px-1 pb-1">
          <button
            onClick={() => setInternalSplitView(false)}
            className={`p-1 rounded transition-colors ${!splitView ? "bg-surface-hover text-text-primary" : "text-text-tertiary hover:text-text-primary"}`}
            title={t("diffLineByLine", { defaultValue: "Line by line" })}
          >
            <Rows3 className="w-3 h-3" />
          </button>
          <button
            onClick={() => setInternalSplitView(true)}
            className={`p-1 rounded transition-colors ${splitView ? "bg-surface-hover text-text-primary" : "text-text-tertiary hover:text-text-primary"}`}
            title={t("diffSideBySide", { defaultValue: "Side by side" })}
          >
            <Columns2 className="w-3 h-3" />
          </button>
          {expandInToolbar && (
            <button
              onClick={handleExpand}
              className="ml-auto p-1 rounded text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
              title={t("expand", { defaultValue: "Expand" })}
            >
              <Maximize2 className="w-3 h-3" />
            </button>
          )}
        </div>
      )}
      <div className="relative rounded">
        <div className="overflow-auto" style={{ maxHeight }}>
          <ReactDiffViewer
            oldValue={oldValue}
            newValue={newValue}
            splitView={splitView}
            compareMethod={DiffMethod.LINES}
            useDarkTheme={isDark}
            styles={inlineStyles}
            hideLineNumbers={false}
            showDiffOnly
            renderContent={renderContent}
          />
        </div>
        {expandFloating && (
          <button
            onClick={handleExpand}
            className="absolute top-1 right-1 p-1.5 rounded bg-bg-elevated/80 text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-colors"
            title={t("expand", { defaultValue: "Expand" })}
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </>
  );
});
