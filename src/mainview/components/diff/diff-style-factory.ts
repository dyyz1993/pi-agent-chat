type DiffStyleOverride = Record<string, Record<string, unknown>>;

export interface DiffStyleConfig {
  fontSize: number;
  gutterWidth: number;
  gutterFontSize: number;
  lineHeight: number;
  background: string;
  markerWidth?: number;
  markerFontSize?: number;
}

export const DIFF_STYLE_PRESETS = {
  overlay: {
    fontSize: 13,
    gutterWidth: 40,
    gutterFontSize: 12,
    lineHeight: 1.6,
    background: "var(--diff-bg)",
    markerWidth: 20,
    markerFontSize: 12,
  },
  overlayMobile: {
    fontSize: 12,
    gutterWidth: 28,
    gutterFontSize: 11,
    lineHeight: 1.4,
    background: "var(--diff-bg)",
    markerWidth: 16,
    markerFontSize: 11,
  },
  inline: {
    fontSize: 11,
    gutterWidth: 32,
    gutterFontSize: 10,
    lineHeight: 1.5,
    background: "transparent",
    markerWidth: 16,
    markerFontSize: 11,
  },
  inlineMobile: {
    fontSize: 12,
    gutterWidth: 28,
    gutterFontSize: 11,
    lineHeight: 1.4,
    background: "transparent",
    markerWidth: 14,
    markerFontSize: 11,
  },
} as const;

export function createDiffStyles(config: DiffStyleConfig): DiffStyleOverride {
  return {
    variables: {
      light: {
        diffViewerBackground: config.background,
      },
      dark: {
        diffViewerBackground: config.background,
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
        emptyLineBackground: config.background,
        gutterBackgroundDark: "var(--diff-gutter-bg)",
        highlightGutterBackground: "var(--diff-highlight-bg)",
        highlightBackground: "var(--diff-highlight-bg)",
      },
    },
    diffContainer: {
      minWidth: "unset",
      fontSize: `${config.fontSize}px`,
      fontFamily: "ui-monospace, SFMono-Regular, monospace",
      lineHeight: String(config.lineHeight),
      border: "none",
      borderRadius: "4px",
    },
    line: {
      fontSize: `${config.fontSize}px`,
      lineHeight: String(config.lineHeight),
      padding: "0 4px",
    },
    gutter: {
      minWidth: config.gutterWidth,
      width: config.gutterWidth,
      padding: "0 3px",
      fontSize: `${config.gutterFontSize}px`,
    },
    contentText: {
      fontSize: `${config.fontSize}px`,
    },
    lineContent: {
      padding: "0",
    },
    marker: {
      width: config.markerWidth ?? 16,
      paddingLeft: 2,
      paddingRight: 2,
      fontSize: `${config.markerFontSize ?? config.fontSize}px`,
    },
    emptyGutter: {
      minWidth: config.gutterWidth,
    },
    codeFoldGutter: {
      minWidth: 20,
      width: 20,
      padding: "0 2px",
      fontSize: `${Math.max(config.fontSize - 2, 8)}px`,
    },
    codeFold: {
      fontSize: `${config.fontSize - 1}px`,
    },
  };
}
