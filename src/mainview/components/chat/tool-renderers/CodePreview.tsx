import { memo, useMemo } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { getLanguage } from "../../../utils/file-utils";
import { useThemeStore, isDarkGroup } from "../../../stores/use-theme-store";

interface CodePreviewProps {
  code: string;
  filename: string;
  maxHeight?: string;
}

export const CodePreview = memo(function CodePreview({
  code,
  filename,
  maxHeight = "200px",
}: CodePreviewProps) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const prismTheme = isDarkGroup(resolvedTheme) ? themes.nightOwl : themes.nightOwlLight;
  const language = useMemo(() => getLanguage(filename), [filename]);

  if (!language) {
    return (
      <div className="overflow-auto bg-surface-code rounded" style={{ maxHeight }}>
        <pre className="text-[11px] leading-relaxed font-mono text-text-primary whitespace-pre p-2">
          {code}
        </pre>
      </div>
    );
  }

  return (
    <div className="overflow-auto bg-surface-code rounded" style={{ maxHeight }}>
      <Highlight theme={prismTheme} code={code} language={language}>
        {({ tokens, getLineProps, getTokenProps }) => (
          <pre className="text-[11px] leading-relaxed font-mono p-2 m-0">
            {tokens.map((line, i) => (
              <div key={i} {...getLineProps({ line })} className="table-row">
                <span className="table-cell text-right pr-3 select-none text-text-tertiary w-8 text-[10px]">
                  {i + 1}
                </span>
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
    </div>
  );
});
