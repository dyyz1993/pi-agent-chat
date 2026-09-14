import { memo, useMemo, useCallback } from "react";
import { Maximize2 } from "lucide-react";
import { Highlight, Prism, themes } from "prism-react-renderer";
import { getLanguage } from "../../../utils/file-utils";
import { useThemeStore, isDarkGroup } from "../../../stores/use-theme-store";
import { useChatOverlayStore } from "../../../stores/use-chat-overlay-store";
import { registerShellPrismLanguage } from "../../../lib/prism-languages";

registerShellPrismLanguage(Prism);

interface InlineCodeViewerProps {
  code: string;
  filename: string;
  maxHeight?: string;
  expandable?: boolean;
}

function HighlightedCode({
  code,
  prismTheme,
  language,
  inheritFontSize = false,
}: {
  code: string;
  prismTheme: typeof themes.nightOwl;
  language: string;
  /** Expand overlays drive font size via a parent style; a fixed text-[11px] here would override it. */
  inheritFontSize?: boolean;
}) {
  if (!language) {
    return (
      <pre
        className={`leading-relaxed font-mono text-text-primary whitespace-pre p-2 ${
          inheritFontSize ? "" : "text-[11px]"
        }`}
      >
        {code}
      </pre>
    );
  }

  const preClass = `leading-relaxed font-mono p-2 m-0 ${inheritFontSize ? "" : "text-[11px]"}`;
  const lineNumberClass = inheritFontSize
    ? "table-cell text-right pr-3 select-none text-text-tertiary w-8 text-[0.91em]"
    : "table-cell text-right pr-3 select-none text-text-tertiary w-8 text-[10px]";

  return (
    <Highlight theme={prismTheme} code={code} language={language}>
      {({ tokens, getLineProps, getTokenProps }) => (
        <pre className={preClass}>
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })} className="table-row">
              <span className={lineNumberClass}>{i + 1}</span>
              <span className="table-cell whitespace-pre">
                {line.map((token, key) => (
                  <span key={key} {...getTokenProps({ token })} />
                ))}
              </span>
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  );
}

export const InlineCodeViewer = memo(function InlineCodeViewer({
  code,
  filename,
  maxHeight = "200px",
  expandable = true,
}: InlineCodeViewerProps) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const prismTheme = isDarkGroup(resolvedTheme) ? themes.nightOwl : themes.nightOwlLight;
  const language = useMemo(() => getLanguage(filename), [filename]);
  const openNodeExpand = useChatOverlayStore((s) => s.openExpand);

  const handleExpand = useCallback(() => {
    openNodeExpand(
      filename,
      <HighlightedCode
        code={code}
        prismTheme={prismTheme}
        language={language}
        inheritFontSize
      />,
    );
  }, [openNodeExpand, filename, code, prismTheme, language]);

  return (
    <div className="relative group rounded">
      <div className="overflow-auto bg-surface-code rounded" style={{ maxHeight }}>
        <HighlightedCode code={code} prismTheme={prismTheme} language={language} />
      </div>
      {expandable && (
        <button
          onClick={handleExpand}
          className="absolute top-1 right-1 p-1.5 rounded bg-bg-elevated/80 text-text-tertiary hover:text-text-primary hover:bg-surface-hover transition-opacity"
        >
          <Maximize2 className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
});
