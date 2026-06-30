import { memo } from "react";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import { toJsxRuntime } from "hast-util-to-jsx-runtime";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { VFile } from "vfile";
import type { Element } from "hast";
import { MermaidPreBlock } from "./mermaid/MermaidPreBlock";
import { transformClickableFilePaths, resolveFilePath } from "./clickable-file-paths";
import { apiClient } from "../../lib/api-client";
import { useChatOverlayStore } from "../../stores/use-chat-overlay-store";
import { useExplorerStore } from "../../stores/use-explorer-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useNotificationStore } from "../../stores/use-notification-store";
import { createLogger } from "../../../shared/lib/logger";
import type { FilePreview } from "../../types";

const log = createLogger("file");

const MAX_CACHE = 200;

const processor = unified().use(remarkParse).use(remarkGfm).use(remarkRehype);

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

function isImageExtension(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return ["png", "jpg", "jpeg", "gif", "svg", "webp", "ico", "bmp"].includes(ext);
}

function isTextExtension(path: string): boolean {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  const textExts = new Set([
    "ts",
    "tsx",
    "js",
    "jsx",
    "json",
    "html",
    "css",
    "scss",
    "less",
    "md",
    "txt",
    "py",
    "rs",
    "go",
    "sh",
    "bash",
    "yml",
    "yaml",
    "toml",
    "xml",
    "sql",
    "graphql",
    "env",
    "gitignore",
    "prettierrc",
    "eslintrc",
    "lock",
    "log",
    "conf",
    "cfg",
    "ini",
    "csv",
    "tsv",
    "mjs",
    "cjs",
    "mts",
    "cts",
    "mdc",
  ]);
  return textExts.has(ext);
}

function getImageMimeType(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    svg: "image/svg+xml",
    webp: "image/webp",
    ico: "image/x-icon",
    bmp: "image/bmp",
  };
  return map[ext] ?? "application/octet-stream";
}

function openFile(absolutePath: string, fileName: string): void {
  const isImage = isImageExtension(fileName);
  const isText = !isImage && isTextExtension(fileName);

  if (isImage) {
    apiClient
      .call("file.readBinaryFile", { path: absolutePath })
      .then((res) => {
        const mimeType = getImageMimeType(fileName);
        const imageUrl = `data:${mimeType};base64,${res.base64}`;
        const preview: FilePreview = {
          path: absolutePath,
          name: fileName,
          content: null,
          imageUrl,
          mimeType,
          size: res.size,
          isText: false,
          isImage: true,
        };
        useChatOverlayStore.getState().openFile();
        useExplorerStore.setState({
          filePreview: preview,
          selectedPath: absolutePath,
          loadingFile: false,
        });
      })
      .catch((err: unknown) => {
        log.warn("Failed to open image file", { path: absolutePath, error: String(err) });
        useNotificationStore.getState().push({
          message: `Failed to open: ${fileName}`,
          level: "warning",
        });
      });
    return;
  }

  const fetchPromise = isText
    ? apiClient.call("file.readFile", { path: absolutePath })
    : apiClient.call("file.readFile", { path: absolutePath }).catch(() =>
      apiClient
        .call("file.readBinaryFile", { path: absolutePath })
        .then((res) => ({
          content: `[Binary file: ${fileName}]\n\nSize: ${res.size} bytes`,
          size: res.size,
        })),
    );

  fetchPromise
    .then((res) => {
      const totalLines = (res.content.match(/\n/g) ?? []).length + 1;
      const preview: FilePreview = {
        path: absolutePath,
        name: fileName,
        content: res.content,
        imageUrl: null,
        mimeType: "text/plain",
        size: res.size,
        isText: true,
        isImage: false,
        totalLines,
      };
      useChatOverlayStore.getState().openFile();
      useExplorerStore.setState({
        filePreview: preview,
        selectedPath: absolutePath,
        loadingFile: false,
      });
    })
    .catch((err: unknown) => {
      log.warn("Failed to open file", { path: absolutePath, error: String(err) });
      useNotificationStore.getState().push({
        message: `Cannot open: ${fileName} (path may not exist)`,
        level: "info",
      });
    });
}

/**
 * Custom `a` element component that intercepts data-file-path links
 * (inserted by transformClickableFilePaths) and renders them as clickable
 * file path references. Passes through normal markdown links unchanged.
 */
function FilePathLink({
  "data-file-path": dataFilePath,
  children,
  ...props
}: {
  href?: string;
  children?: React.ReactNode;
  "data-file-path"?: string;
  node?: Element;
}) {
  if (dataFilePath) {
    return (
      <span
        className="cursor-pointer text-primary underline decoration-dotted underline-offset-2 hover:text-primary/80 transition-colors"
        title={`Open file: ${dataFilePath}`}
        onClick={() => {
          const state = useSessionStore.getState();
          const tab = state.projectTabs.find((t) => t.id === state.activeProjectId);
          const projectPath = tab?.remote?.remotePath ?? tab?.path ?? "";
          if (!projectPath) {
            log.warn("No active project path to resolve file", { filePath: dataFilePath });
            useNotificationStore.getState().push({
              message: `No project root to resolve: ${dataFilePath}`,
              level: "info",
            });
            return;
          }
          const absolutePath = resolveFilePath(projectPath, dataFilePath);
          openFile(absolutePath, dataFilePath.split("/").pop() ?? dataFilePath);
        }}
      >
        {children}
      </span>
    );
  }

  // Normal markdown link — pass through
  return <a {...props} />;
}

export const CachedReactMarkdown = memo(function CachedReactMarkdown({
  children,
}: {
  children: string;
}) {
  const hast = parseToHast(children);
  // Transform the HAST to wrap file-like paths in clickable <a data-file-path> elements
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
