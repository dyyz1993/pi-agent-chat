import type { ClassAttributes, HTMLAttributes, ReactNode } from "react";
import { Highlight, themes } from "prism-react-renderer";
import { MermaidBlock, isMermaidLang } from "./MermaidBlock";
import { useThemeStore, isDarkGroup } from "../../../stores/use-theme-store";
import { CopyButton } from "../CopyButton";

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

function extractTextFromChildren(children: ReactNode): string {
  if (typeof children === "string") return children;
  if (Array.isArray(children)) return children.map(extractTextFromChildren).join("");
  if (children && typeof children === "object" && "props" in children) {
    return extractTextFromChildren(
      (children as { props: { children?: ReactNode } }).props.children,
    );
  }
  return "";
}

export function MermaidPreBlock({ children, node, ...rest }: PreBlockProps) {
  const resolvedTheme = useThemeStore((s) => s.resolvedTheme);
  const prismTheme = isDarkGroup(resolvedTheme) ? themes.nightOwl : themes.github;

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
                  className={`${className} rounded-lg text-[13px] overflow-x-auto whitespace-pre`}
                  style={{ ...style, background: "var(--color-surface-code)" }}
                  {...rest}
                >
                  {tokens.map((line, i) => (
                    <div key={i} {...getLineProps({ line })} className="table-row">
                      <span className="table-cell text-right pr-4 select-none text-text-tertiary w-8 text-xs leading-6">
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
                <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 md:opacity-100 transition-opacity">
                  <CopyButton text={code} size="xs" />
                </div>
              </div>
            )}
          </Highlight>
        );
      }
    }
  }

  const fallbackText = extractTextFromChildren(children);

  return (
    <div className="relative group">
      <pre
        {...rest}
        className="overflow-x-auto whitespace-pre rounded-lg text-[13px] p-3 text-text-primary"
        style={{ background: "var(--color-surface-code)" }}
      >
        {children}
      </pre>
      {fallbackText && (
        <div className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 md:opacity-100 transition-opacity">
          <CopyButton text={fallbackText} size="xs" />
        </div>
      )}
    </div>
  );
}
