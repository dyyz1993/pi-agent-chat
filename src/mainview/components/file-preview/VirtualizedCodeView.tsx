import { forwardRef, useRef, useMemo, type ComponentType } from "react";
import { Virtualizer } from "virtua";
import type { CustomContainerComponentProps } from "virtua";
import { Highlight, Prism, themes } from "prism-react-renderer";
import { createLogger } from "../../../shared/lib/logger";
import { getLanguage } from "../../utils/file-utils";
import { useThemeStore, isDarkGroup } from "../../stores/use-theme-store";
import { registerShellPrismLanguage } from "../../lib/prism-languages";

registerShellPrismLanguage(Prism);

interface VirtualizedCodeViewProps {
  code: string;
  filename: string;
  fontSize?: number;
  /** When true, long lines wrap at the viewport width instead of horizontal-scrolling. */
  wrap?: boolean;
}

/** Lines longer than this skip syntax highlighting (plain text instead) */
const LONG_LINE_THRESHOLD = 5000;
/** Max lines to attempt Prism tokenization; beyond this, plain text only */
const MAX_HIGHLIGHT_LINES = 5000;
/** Max chars for JSON pretty-print; beyond this, skip formatting */
const MAX_JSON_FORMAT_CHARS = 500_000;

const logger = createLogger("file");

function getVisualLineLength(line: string): number {
  let length = 0;
  for (const char of line) {
    if (char === "\t") {
      length += 2;
    } else {
      length += 1;
    }
  }
  return length;
}

const CodeVirtualizerContainer = forwardRef<
  HTMLDivElement,
  Omit<CustomContainerComponentProps, "ref">
>(function CodeVirtualizerContainer({ style, children }, ref) {
  return (
    <div ref={ref} className="min-h-full" style={style}>
      {children}
    </div>
  );
}) as ComponentType<CustomContainerComponentProps>;

export function VirtualizedCodeView({ code, filename, fontSize = 12, wrap = false }: VirtualizedCodeViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const language = getLanguage(filename);

  const formattedCode = useMemo(() => {
    const ext = filename.split(".").pop()?.toLowerCase() ?? "";
    if ((ext === "json" || ext === "jsonc") && code.length <= MAX_JSON_FORMAT_CHARS) {
      try {
        const parsed = JSON.parse(code) as unknown;
        return JSON.stringify(parsed, null, 2);
      } catch (e) {
        logger.warn("Failed to format JSON for preview", { error: String(e) });
        return code;
      }
    }
    return code;
  }, [code, filename]);

  const lines = useMemo(() => formattedCode.split("\n"), [formattedCode]);

  // For wrap mode, content fills the viewport (100%); each line wraps based on
  // the available width, which is a function of fontSize — zoom out = more chars
  // per line = fewer wraps. This lets users shrink until ASCII art fits un-wrapped.
  // For non-wrap mode, content width is the longest line so horizontal scroll works.
  const contentWidth = useMemo(() => {
    if (wrap) return undefined;
    const maxLineLength = lines.reduce((max, line) => Math.max(max, getVisualLineLength(line)), 0);
    return "max(100%, calc(" + maxLineLength + "ch + 56px))";
  }, [lines, wrap]);

  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const prismTheme = isDarkGroup(resolvedTheme) ? themes.nightOwl : themes.nightOwlLight;

  const avgLineLength = formattedCode.length / Math.max(lines.length, 1);
  const NO_HIGHLIGHT_EXTS = new Set(["lock", "map", "log", "csv"]);
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const forcePlainText =
    !language ||
    avgLineLength > 500 ||
    NO_HIGHLIGHT_EXTS.has(ext) ||
    lines.length > MAX_HIGHLIGHT_LINES;

  /** Compute line height matching the original leading-5 (20px) ratio at fontSize 12 */
  const lineHeight = Math.round(fontSize * (20 / 12));

  // Shared styling strings, branched on wrap mode
  const scrollClassName = wrap
    ? "flex-1 min-h-0 overflow-y-auto overflow-x-hidden bg-bg-elevated dark:bg-surface-code"
    : "flex-1 min-h-0 overflow-auto bg-bg-elevated dark:bg-surface-code";
  const lineDivClassName = wrap ? "flex font-mono" : "flex min-w-max font-mono";
  const lineDivStyle = { lineHeight: lineHeight + "px" };
  const contentSpanClassName = wrap
    ? "flex-1 min-w-0 whitespace-pre-wrap break-words"
    : "flex-1 whitespace-pre";
  const innerDivStyle = wrap
    ? { fontSize: fontSize + "px" }
    : { width: contentWidth, fontSize: fontSize + "px", minWidth: "max-content" as const };

  // itemSize is only useful as a hint in non-wrap mode (fixed line height).
  // In wrap mode lines have variable height (wrapping), so we let virtua measure.
  const virtualizerProps = wrap ? {} : { itemSize: lineHeight };

  const gutter = (index: number) => (
    <span className="inline-block w-10 text-right pr-4 text-text-tertiary dark:text-text-secondary select-none shrink-0">
      {index + 1}
    </span>
  );

  // --- Plain text path: no Prism tokenization ---
  if (forcePlainText) {
    return (
      <div ref={parentRef} className={scrollClassName}>
        <div className="min-h-full" style={innerDivStyle}>
          <Virtualizer as={CodeVirtualizerContainer} scrollRef={parentRef} {...virtualizerProps}>
            {lines.map((line, index) => (
              <div key={index} className={lineDivClassName} style={lineDivStyle}>
                {gutter(index)}
                <span
                  className={contentSpanClassName + " text-text-primary dark:text-text-secondary"}
                  style={{ tabSize: 2 }}
                >
                  {line}
                </span>
              </div>
            ))}
          </Virtualizer>
        </div>
      </div>
    );
  }

  // --- Highlighted path: tokenize ONCE for the whole file, virtualize rendering ---
  return (
    <Highlight theme={prismTheme} code={code} language={language}>
      {({ tokens, getTokenProps }) => {
        const tokensValid = tokens.length === lines.length;
        return (
          <div ref={parentRef} className={scrollClassName}>
            <div className="min-h-full" style={innerDivStyle}>
              <Virtualizer as={CodeVirtualizerContainer} scrollRef={parentRef} {...virtualizerProps}>
                {lines.map((lineText, index) => {
                  const lineTokens = tokens[index];
                  const isLongLine = (lineText?.length ?? 0) > LONG_LINE_THRESHOLD;

                  return (
                    <div key={index} className={lineDivClassName} style={lineDivStyle}>
                      {gutter(index)}
                      {isLongLine || !tokensValid ? (
                        <span
                          className={contentSpanClassName + " text-text-primary dark:text-text-secondary"}
                          style={{ tabSize: 2 }}
                        >
                          {lineText}
                        </span>
                      ) : (
                        <span className={contentSpanClassName} style={{ tabSize: 2 }}>
                          {lineTokens.map((token, key) => {
                            const { className: _className, ...tokenProps } = getTokenProps({
                              token,
                            });
                            return <span key={key} {...tokenProps} />;
                          })}
                        </span>
                      )}
                    </div>
                  );
                })}
              </Virtualizer>
            </div>
          </div>
        );
      }}
    </Highlight>
  );
}
