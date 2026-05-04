import type { ClassAttributes, HTMLAttributes, ReactNode } from "react";
import { MermaidBlock, isMermaidLang } from "./MermaidBlock";

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
  if (node?.children) {
    const codeEl = node.children.find(
      (c) => c.type === "element" && "tagName" in c,
    );
    if (codeEl && codeEl.properties?.className) {
      const langClass = codeEl.properties.className.find((cls) =>
        cls.startsWith("language-"),
      );
      if (langClass) {
        const lang = langClass.replace("language-", "");
        if (isMermaidLang(lang)) {
          const code = extractTextFromNode(codeEl);
          return <MermaidBlock code={code} />;
        }
      }
    }
  }

  return <pre {...rest}>{children}</pre>;
}
