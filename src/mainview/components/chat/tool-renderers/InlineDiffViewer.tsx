import { memo, useMemo } from "react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { useThemeStore, isDarkGroup } from "../../../stores/use-theme-store";
import { useLayoutStore } from "../../../layouts/use-layout-store";

interface InlineDiffViewerProps {
  oldValue: string;
  newValue: string;
  maxHeight?: string;
  splitView?: boolean;
}

type DiffStyleOverride = Record<string, Record<string, unknown>>;

function makeCompactStyles(extra?: DiffStyleOverride): DiffStyleOverride {
  return {
    variables: {
      light: {
        diffViewerBackground: "transparent",
      },
      dark: {
        diffViewerBackground: "transparent",
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
        emptyLineBackground: "transparent",
        gutterBackgroundDark: "var(--diff-gutter-bg)",
        highlightGutterBackground: "var(--diff-highlight-bg)",
        highlightBackground: "var(--diff-highlight-bg)",
      },
    },
    diffContainer: {
      minWidth: "unset",
      fontSize: "11px",
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
      lineHeight: "1.5",
      border: "none",
      borderRadius: "4px",
    },
    line: {
      fontSize: "11px",
      lineHeight: "1.5",
      padding: "0 4px",
    },
    gutter: {
      minWidth: 32,
      width: 32,
      padding: "0 3px",
      fontSize: "10px",
    },
    contentText: {
      fontSize: "11px",
    },
    lineContent: {
      padding: "0",
    },
    marker: {
      width: 16,
      paddingLeft: 2,
      paddingRight: 2,
      fontSize: "11px",
    },
    emptyGutter: {
      minWidth: 32,
    },
    codeFoldGutter: {
      minWidth: 20,
      width: 20,
      padding: "0 2px",
      fontSize: "9px",
    },
    codeFold: {
      fontSize: "10px",
    },
    ...extra,
  };
}

export const InlineDiffViewer = memo(function InlineDiffViewer({
  oldValue,
  newValue,
  maxHeight = "200px",
  splitView = false,
}: InlineDiffViewerProps) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const isDark = isDarkGroup(resolvedTheme);
  const breakpoint = useLayoutStore((s) => s.breakpoint);
  const isMobile = breakpoint === "mobile";

  const styles = useMemo(() => {
    if (!isMobile) return makeCompactStyles();
    return makeCompactStyles({
      gutter: {
        minWidth: 24,
        width: 24,
        padding: "0 1px",
        fontSize: "9px",
      },
      marker: {
        width: 14,
        paddingLeft: 1,
        paddingRight: 1,
        fontSize: "9px",
      },
      line: {
        fontSize: "10px",
        lineHeight: "1.35",
        padding: "0 2px",
      },
      emptyGutter: {
        minWidth: 24,
      },
      codeFoldGutter: {
        minWidth: 18,
        width: 18,
        padding: "0 1px",
        fontSize: "8px",
      },
      contentText: {
        fontSize: "10px",
      },
    });
  }, [isMobile]);

  return (
    <div className="overflow-auto rounded text-[11px]" style={{ maxHeight }}>
      <ReactDiffViewer
        oldValue={oldValue}
        newValue={newValue}
        splitView={splitView}
        compareMethod={DiffMethod.LINES}
        useDarkTheme={isDark}
        styles={styles}
        hideLineNumbers={false}
        showDiffOnly
      />
    </div>
  );
});
