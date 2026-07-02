import { memo, type ReactNode } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { VFile } from "vfile";
import type { Element } from "hast";
import { MermaidPreBlock } from "./mermaid/MermaidPreBlock";
import { resolveFilePath, transformClickableFilePaths } from "./clickable-file-paths";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { useSessionStore } from "../../stores/use-session-store";
import { getProjectWorkspacePath } from "../../lib/project-workspace-path";
import type { TreeNode } from "../../types";

const MAX_CACHE = 200;

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

const cache = new Map<string, ReturnType<typeof processor.runSync>>();

function parseToHast(text: string) {
  const cached = cache.get(text);
  if (cached) return structuredClone(cached);
  const file = new VFile();
  file.value = text;
  const tree = processor.parse(file);
  const hast = processor.runSync(tree, file);
  if (cache.size >= MAX_CACHE) {
    const firstKey = cache.keys().next().value;
    if (firstKey !== undefined) cache.delete(firstKey);
  }
  cache.set(text, hast);
  return structuredClone(hast);
}

function getActiveProjectPath(): string | null {
  const state = useSessionStore.getState();
  if (state.activeSessionId) {
    for (const sessions of Object.values(state.sessionsByProject)) {
      const session = sessions.find((item) => item.sessionId === state.activeSessionId);
      if (session?.projectPath) return session.projectPath;
    }
  }

  const activeTab = state.projectTabs.find((item) => item.id === state.activeProjectId);
  return getProjectWorkspacePath(activeTab) || null;
}

function basename(path: string): string {
  return path.split("/").filter(Boolean).pop() ?? path;
}

function FilePathLink({
  dataFilePath,
  "data-file-path": dataFilePathAttr,
  node: _node,
  children,
  ...props
}: {
  dataFilePath?: string;
  "data-file-path"?: string;
  href?: string;
  node?: Element;
  children?: ReactNode;
}) {
  const openFile = useExplorerStore((s) => s.openFile);
  const notify = useNotificationStore((s) => s.push);
  const filePath = dataFilePath ?? dataFilePathAttr;

  if (!filePath) return <a {...props}>{children}</a>;

  return (
    <button
      type="button"
      className="inline cursor-pointer rounded-sm px-0.5 text-left text-primary underline decoration-dotted underline-offset-2 transition-colors hover:text-primary/80"
      title={`Open file: ${filePath}`}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const projectPath = getActiveProjectPath();
        if (!projectPath) {
          notify({ level: "info", message: `No project root to resolve: ${filePath}` });
          return;
        }

        const absolutePath = resolveFilePath(projectPath, filePath);
        const node: TreeNode = {
          name: basename(absolutePath),
          path: absolutePath,
          type: "file",
        };
        void openFile(node, false);
      }}
    >
      {children}
    </button>
  );
}

export const CachedReactMarkdown = memo(function CachedReactMarkdown({
  children,
}: {
  children: string;
}) {
  const hast = parseToHast(children);
  transformClickableFilePaths(hast);
  return toJsxRuntime(hast, {
    Fragment,
    ignoreInvalidStyle: true,
    jsx,
    jsxs,
    passKeys: true,
    passNode: true,
    components: {
      pre: MermaidPreBlock,
      a: FilePathLink,
    },
  });
});
