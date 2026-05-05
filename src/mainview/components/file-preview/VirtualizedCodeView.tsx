import { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Highlight, themes } from "prism-react-renderer";
import { getLanguage } from "../../utils/file-utils";
import { useThemeStore } from "../../stores/use-theme-store";

interface VirtualizedCodeViewProps {
  code: string;
  filename: string;
}

/** Lines longer than this skip syntax highlighting (plain text instead) */
const LONG_LINE_THRESHOLD = 5000;

export function VirtualizedCodeView({ code, filename }: VirtualizedCodeViewProps) {
  const parentRef = useRef<HTMLDivElement>(null);
  const language = getLanguage(filename);
  const lines = useMemo(() => code.split("\n"), [code]);
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const prismTheme = resolvedTheme === "dark" ? themes.nightOwl : themes.nightOwlLight;

  const avgLineLength = code.length / Math.max(lines.length, 1);
  const NO_HIGHLIGHT_EXTS = new Set(["json", "lock", "map", "log", "csv"]);
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const forcePlainText = !language || avgLineLength > 500 || NO_HIGHLIGHT_EXTS.has(ext);

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });

  // --- Plain text path: no Prism tokenization ---
  if (forcePlainText) {
    return (
      <div ref={parentRef} className="flex-1 min-h-0 overflow-auto bg-white dark:bg-gray-900">
        <div
          style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
        >
          {virtualizer.getVirtualItems().map((vr) => (
            <div
              key={vr.key}
              style={{
                position: "absolute", top: 0, left: 0, width: "100%",
                height: `${vr.size}px`, transform: `translateY(${vr.start}px)`,
              }}
              className="flex text-xs leading-5 font-mono"
            >
              <span className="inline-block w-10 text-right pr-4 text-gray-400 dark:text-gray-600 select-none shrink-0">
                {vr.index + 1}
              </span>
              <span className="flex-1 text-gray-800 dark:text-gray-300 whitespace-pre" style={{ tabSize: 2 }}>{lines[vr.index]}</span>
            </div>
          ))}
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
          <div ref={parentRef} className="flex-1 min-h-0 overflow-auto bg-white dark:bg-gray-900">
            <div
              style={{ height: `${virtualizer.getTotalSize()}px`, width: "100%", position: "relative" }}
            >
              {virtualizer.getVirtualItems().map((vr) => {
                const lineTokens = tokens[vr.index];
                const lineText = lines[vr.index];
                const isLongLine = (lineText?.length ?? 0) > LONG_LINE_THRESHOLD;

                return (
                  <div
                    key={vr.key}
                    style={{
                      position: "absolute", top: 0, left: 0, width: "100%",
                      height: `${vr.size}px`, transform: `translateY(${vr.start}px)`,
                    }}
                    className="flex text-xs leading-5 font-mono"
                  >
                    <span className="inline-block w-10 text-right pr-4 text-gray-400 dark:text-gray-600 select-none shrink-0">
                      {vr.index + 1}
                    </span>
                    {isLongLine || !tokensValid || !lineTokens ? (
                      <span className="flex-1 text-gray-800 dark:text-gray-300 whitespace-pre" style={{ tabSize: 2 }}>{lineText}</span>
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
            </div>
          </div>
        );
      }}
    </Highlight>
  );
}
