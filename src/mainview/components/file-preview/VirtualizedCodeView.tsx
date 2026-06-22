import { useRef, useMemo } from "react";
import { Virtualizer } from "virtua";
import { Highlight, Prism, themes } from "prism-react-renderer";
import { createLogger } from "../../../shared/lib/logger";
import { getLanguage } from "../../utils/file-utils";
import { useThemeStore, isDarkGroup } from "../../stores/use-theme-store";
import { registerShellPrismLanguage } from "../../lib/prism-languages";

registerShellPrismLanguage(Prism);

interface VirtualizedCodeViewProps {
  code: string;
  filename: string;
}

/** Lines longer than this skip syntax highlighting (plain text instead) */
const LONG_LINE_THRESHOLD = 5000;
/** Max lines to attempt Prism tokenization; beyond this, plain text only */
const MAX_HIGHLIGHT_LINES = 5000;
/** Max chars for JSON pretty-print; beyond this, skip formatting */
const MAX_JSON_FORMAT_CHARS = 500_000;

const logger = createLogger("file");

export function VirtualizedCodeView({ code, filename }: VirtualizedCodeViewProps) {
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

  // --- Plain text path: no Prism tokenization ---
  if (forcePlainText) {
    return (
      <div
        ref={parentRef}
        className="flex-1 min-h-0 overflow-auto bg-bg-elevated dark:bg-surface-code"
      >
        <Virtualizer scrollRef={parentRef} itemSize={20}>
          {lines.map((line, index) => (
            <div
              key={index}
              className="flex text-xs leading-5 font-mono"
            >
              <span className="inline-block w-10 text-right pr-4 text-text-tertiary dark:text-text-secondary select-none shrink-0">
                {index + 1}
              </span>
              <span
                className="flex-1 text-text-primary dark:text-text-secondary whitespace-pre"
                style={{ tabSize: 2 }}
              >
                {line}
              </span>
            </div>
          ))}
        </Virtualizer>
      </div>
    );
  }

  // --- Highlighted path: tokenize ONCE for the whole file, virtualize rendering ---
  return (
    <Highlight theme={prismTheme} code={code} language={language}>
      {({ tokens, getTokenProps }) => {
        const tokensValid = tokens.length === lines.length;
        return (
          <div
            ref={parentRef}
            className="flex-1 min-h-0 overflow-auto bg-bg-elevated dark:bg-surface-code"
          >
            <Virtualizer scrollRef={parentRef} itemSize={20}>
              {lines.map((lineText, index) => {
                const lineTokens = tokens[index];
                const isLongLine = (lineText?.length ?? 0) > LONG_LINE_THRESHOLD;

                return (
                  <div
                    key={index}
                    className="flex text-xs leading-5 font-mono"
                  >
                    <span className="inline-block w-10 text-right pr-4 text-text-tertiary dark:text-text-secondary select-none shrink-0">
                      {index + 1}
                    </span>
                    {isLongLine || !tokensValid ? (
                      <span
                        className="flex-1 whitespace-pre text-text-primary dark:text-text-secondary"
                        style={{ tabSize: 2 }}
                      >
                        {lineText}
                      </span>
                    ) : (
                      <span className="flex-1 whitespace-pre" style={{ tabSize: 2 }}>
                        {lineTokens.map((token, key) => (
                          <span key={key} {...getTokenProps({ token })} />
                        ))}
                      </span>
                    )}
                  </div>
                );
              })}
            </Virtualizer>
          </div>
        );
      }}
    </Highlight>
  );
}
