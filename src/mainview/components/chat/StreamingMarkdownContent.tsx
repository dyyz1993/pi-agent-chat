import { memo, type ComponentProps, type JSX } from "react";
import { Streamdown, type Components, type ExtraProps } from "streamdown";

import { MermaidPreBlock } from "./mermaid/MermaidPreBlock";

type StreamingCodeProps = ComponentProps<"code"> &
  ExtraProps & {
    "data-block"?: string | boolean;
  };
type StreamingElementProps<Tag extends keyof JSX.IntrinsicElements> = ComponentProps<Tag> &
  ExtraProps;

function StreamingInlineCode({ children, className, node: _node, ...props }: StreamingCodeProps) {
  return (
    <code
      className={`rounded bg-muted px-1.5 py-0.5 font-mono text-sm ${className ?? ""}`.trim()}
      data-streamdown="inline-code"
      {...props}
    >
      {children}
    </code>
  );
}

function StreamingCodeBlock({ children, className, node }: StreamingCodeProps) {
  const classNames = typeof className === "string" ? className.split(/\s+/).filter(Boolean) : [];
  const nodeClassNames = Array.isArray(node?.properties?.className)
    ? node.properties.className.filter((value): value is string => typeof value === "string")
    : [];
  const codeNode =
    node && node.type === "element"
      ? {
          ...node,
          properties: {
            ...node.properties,
            className:
              classNames.length > 0
                ? classNames
                : nodeClassNames.length > 0
                  ? nodeClassNames
                  : undefined,
          },
        }
      : undefined;

  return (
    <MermaidPreBlock node={codeNode}>
      <code className={className}>{children}</code>
    </MermaidPreBlock>
  );
}

function StreamingTable({ node: _node, ...props }: StreamingElementProps<"table">) {
  return <table {...props} />;
}

function StreamingTableHead({ node: _node, ...props }: StreamingElementProps<"thead">) {
  return <thead {...props} />;
}

function StreamingTableBody({ node: _node, ...props }: StreamingElementProps<"tbody">) {
  return <tbody {...props} />;
}

function StreamingTableRow({ node: _node, ...props }: StreamingElementProps<"tr">) {
  return <tr {...props} />;
}

function StreamingTableHeaderCell({ node: _node, ...props }: StreamingElementProps<"th">) {
  return <th {...props} />;
}

function StreamingTableCell({ node: _node, ...props }: StreamingElementProps<"td">) {
  return <td {...props} />;
}

const streamdownComponents = {
  code: StreamingCodeBlock,
  inlineCode: StreamingInlineCode,
  table: StreamingTable,
  thead: StreamingTableHead,
  tbody: StreamingTableBody,
  tr: StreamingTableRow,
  th: StreamingTableHeaderCell,
  td: StreamingTableCell,
} satisfies Components;

export default memo(function StreamingMarkdownContent({ text }: { text: string }) {
  return (
    <Streamdown
      mode="streaming"
      parseIncompleteMarkdown
      controls={false}
      components={streamdownComponents}
    >
      {text}
    </Streamdown>
  );
});
