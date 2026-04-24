import { useRef, useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Highlight, themes } from "prism-react-renderer";
import { getLanguage } from "../../utils/file-utils";

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

  // Detect minified files: avg line length > 500 chars
  const avgLineLength = code.length / Math.max(lines.length, 1);
  const usePlainText = !language || avgLineLength > 500;

  const virtualizer = useVirtualizer({
    count: lines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 20,
    overscan: 20,
  });

  // --- Plain text path: no Prism tokenization ---
  if (usePlainText) {
    return (
      <div ref={parentRef} className="flex-1 min-h-0 overflow-auto" style={{ background: "#011627" }}>
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
              <span className="inline-block w-10 text-right pr-4 text-gray-600 select-none shrink-0">
                {vr.index + 1}
              </span>
              <span className="flex-1 text-gray-300 whitespace-pre">{lines[vr.index]}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // --- Highlighted path: tokenize ONCE for the whole file, virtualize rendering ---
  return (
    <Highlight theme={themes.nightOwl} code={code} language={language}>
      {({ tokens, getTokenProps }) => (
        <div ref={parentRef} className="flex-1 min-h-0 overflow-auto" style={{ background: "#011627" }}>
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
                  <span className="inline-block w-10 text-right pr-4 text-gray-600 select-none shrink-0">
                    {vr.index + 1}
                  </span>
                  {isLongLine ? (
                    <span className="flex-1 text-gray-300 whitespace-pre">{lineText}</span>
                  ) : (
                    <span className="flex-1">
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
      )}
    </Highlight>
  );
}
