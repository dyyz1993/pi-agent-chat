import { memo } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { VFile } from "vfile";
import { MermaidPreBlock } from "./mermaid/MermaidPreBlock";

const MAX_CACHE = 200;

const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkRehype);

const cache = new Map<string, ReturnType<typeof processor.runSync>>();

function parseToHast(text: string) {
  const cached = cache.get(text);
  if (cached) return cached;
  const file = new VFile();
  file.value = text;
  const tree = processor.parse(file);
  const hast = processor.runSync(tree, file);
  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(text, hast);
  return hast;
}

export const CachedReactMarkdown = memo(function CachedReactMarkdown({
  children,
}: {
  children: string;
}) {
  const hast = parseToHast(children);
  return toJsxRuntime(hast, {
    Fragment,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
    components: {
      pre: MermaidPreBlock,
    },
  });
});
