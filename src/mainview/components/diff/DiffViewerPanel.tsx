import { useState } from "react";
import { X, Columns2, Rows3 } from "lucide-react";
import ReactDiffViewer, { DiffMethod } from "react-diff-viewer-continued";
import { useGitStore } from "../../stores/use-git-store";

/* Module-level constant: avoids re-creating the styles object on every render */
const DIFF_STYLES = {
  variables: {
    light: {
      diffViewerBackground: "#111827",
    },
    dark: {
      diffViewerBackground: "#111827",
      diffViewerColor: "#e5e7eb",
      addedBackground: "#052e16",
      addedColor: "#4ade80",
      removedBackground: "#450a0a",
      removedColor: "#fca5a5",
      wordAddedBackground: "#065f46",
      wordRemovedBackground: "#7f1d1d",
      addedGutterBackground: "#052e16",
      removedGutterBackground: "#450a0a",
      gutterBackground: "#1f2937",
      gutterColor: "#6b7280",
      codeFoldGutterBackground: "#1f2937",
      codeFoldBackground: "#1f2937",
      emptyLineBackground: "#111827",
      gutterBackgroundDark: "#1f2937",
      highlightGutterBackground: "#374151",
      highlightBackground: "#374151",
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
  const currentDiff = useGitStore((s) => s.currentDiff);
  const loadingDiff = useGitStore((s) => s.loadingDiff);
  const clearDiff = useGitStore((s) => s.clearDiff);
  const [splitView, setSplitView] = useState(false);

  if (!currentDiff && !loadingDiff) return null;

  const fileName = currentDiff?.filePath.split("/").pop() || "";

  return (
    <div className="absolute inset-0 bg-gray-900 flex flex-col" style={{ zIndex: 40 }}>
      {/* Header */}
      <div className="h-9 bg-gray-800 border-b border-gray-700 flex items-center px-3 text-xs flex-shrink-0 gap-2">
        <span className="text-gray-300 font-medium">{fileName}</span>
        <span className="text-gray-500 truncate text-[10px]">{currentDiff?.filePath}</span>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setSplitView(false)}
            className={`p-1 rounded transition-colors ${!splitView ? "bg-gray-600 text-white" : "text-gray-500 hover:text-white"}`}
            title="Line by line"
          >
            <Rows3 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setSplitView(true)}
            className={`p-1 rounded transition-colors ${splitView ? "bg-gray-600 text-white" : "text-gray-500 hover:text-white"}`}
            title="Side by side"
          >
            <Columns2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={clearDiff}
            className="ml-1 text-gray-500 hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        {loadingDiff ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading diff...
          </div>
        ) : currentDiff ? (
          <ReactDiffViewer
            oldValue={currentDiff.oldContent}
            newValue={currentDiff.newContent}
            splitView={splitView}
            compareMethod={DiffMethod.LINES}
            useDarkTheme={true}
            leftTitle="Before"
            rightTitle="After"
            styles={DIFF_STYLES}
          />
        ) : null}
      </div>
    </div>
  );
}
