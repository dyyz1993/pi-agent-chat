import type { ClassAttributes, HTMLAttributes, ReactNode } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { MermaidBlock, isMermaidLang } from "./MermaidBlock";
import { useThemeStore } from "../../../stores/use-theme-store";

interface HastNode {
  type: string;
  value?: string;
  children?: HastNode[];
  properties?: {
    className?: string[];
    [key: string]: unknown;
  };
}

function extractTextFromNode(node: HastNode): string {
  if (node.type === "text") return node.value ?? "";
  if (node.children) {
    return node.children.map((c) => extractTextFromNode(c)).join("");
  }
  return "";
}

type PreBlockProps = ClassAttributes<HTMLPreElement> &
  HTMLAttributes<HTMLPreElement> & {
    children?: ReactNode;
    node?: HastNode;
  };

export function MermaidPreBlock({ children, node, ...rest }: PreBlockProps) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const prismTheme = resolvedTheme === "dark" ? themes.nightOwl : themes.github;

  if (node?.children) {
    const codeEl = node.children.find((c) => c.type === "element" && "tagName" in c);
    if (codeEl && codeEl.properties?.className) {
      const langClass = codeEl.properties.className.find((cls) => cls.startsWith("language-"));
      if (langClass) {
        const lang = langClass.replace("language-", "");
        if (isMermaidLang(lang)) {
          const code = extractTextFromNode(codeEl);
          return <MermaidBlock code={code} />;
        }

        const code = extractTextFromNode(codeEl);
        return (
          <Highlight theme={prismTheme} language={lang || "text"} code={code}>
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <div className="relative group">
                <pre
                  className={`${className} rounded-lg text-[13px] overflow-x-auto`}
                  style={{ ...style, background: "var(--tw-colors-gray-900)" }}
                  {...rest}
                >
                  {tokens.map((line, i) => (
                    <div key={i} {...getLineProps({ line })} className="table-row">
                      <span className="table-cell text-right pr-4 select-none text-gray-500/50 w-8 text-xs leading-6">
                        {i + 1}
                      </span>
                      <span className="table-cell">
                        {line.map((token, key) => (
                          <span key={key} {...getTokenProps({ token })} />
                        ))}
                      </span>
                    </div>
                  ))}
                </pre>
              </div>
            )}
          </Highlight>
        );
      }
    }
  }

  return <pre {...rest}>{children}</pre>;
}
