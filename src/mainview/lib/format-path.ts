import { useSessionStore } from "../stores/use-session-store";

const TOOL_HEADER_PATH_MAX_LEN = 56;

type ProjectRootInput = string | string[];
type FormatPathLikeOptions = {
  maxLen?: number;
  projectRoot?: ProjectRootInput;
};

export function getProjectRoot(): string {
  return getProjectRoots()[0] ?? "";
}

function getProjectRoots(): string[] {
  return getProjectRootsFromState(useSessionStore.getState());
}

function getProjectRootsFromState(
  state: Pick<ReturnType<typeof useSessionStore.getState>, "activeProjectId" | "projectTabs">,
): string[] {
  const { activeProjectId, projectTabs } = state;
  const roots: string[] = [];
  const addRoot = (path: string | undefined) => {
    if (path && !roots.includes(path)) roots.push(path);
  };

  const activeTab = projectTabs.find((t) => t.id === activeProjectId);
  addRoot(activeTab?.remote?.remotePath);
  addRoot(activeTab?.path);

  for (const tab of projectTabs) {
    addRoot(tab.remote?.remotePath);
    addRoot(tab.path);
  }

  return roots;
}

export function useKnownProjectRoots(): string[] {
  const rootKey = useSessionStore((state) => getProjectRootsFromState(state).join("\n"));
  return typeof rootKey === "string" && rootKey ? rootKey.split("\n") : [];
}

export function formatFilePath(
  filePath: string,
  options?: { projectRoot?: ProjectRootInput; maxLen?: number },
): string {
  if (!filePath) return "";

  const normalizedPath = normalizePathForDisplay(filePath);
  const roots = normalizeProjectRoots(options?.projectRoot ?? getProjectRoots());

  for (const root of roots) {
    if (root && normalizedPath.startsWith(root + "/")) {
      const relative = normalizedPath.slice(root.length + 1);
      return shortPath(relative, options?.maxLen);
    }

    if (root && normalizedPath === root) {
      const basename = getLastPathSegment(normalizedPath);
      return shortPath(basename, options?.maxLen);
    }
  }

  return shortPath(normalizedPath, options?.maxLen);
}

export function formatToolHeaderPath(filePath: string, projectRoot?: ProjectRootInput): string {
  return formatFilePath(filePath, { projectRoot, maxLen: TOOL_HEADER_PATH_MAX_LEN });
}

export function formatPathLikeText(
  text: string,
  optionsOrMaxLen: number | FormatPathLikeOptions = TOOL_HEADER_PATH_MAX_LEN,
  projectRoot?: ProjectRootInput,
): string {
  if (!isPathLikeText(text)) return text;
  const options =
    typeof optionsOrMaxLen === "number"
      ? { maxLen: optionsOrMaxLen, projectRoot }
      : optionsOrMaxLen;
  return formatFilePath(text, {
    maxLen: options.maxLen ?? TOOL_HEADER_PATH_MAX_LEN,
    projectRoot: options.projectRoot,
  });
}

function shortPath(p: string, maxLen?: number): string {
  if (!maxLen || p.length <= maxLen) return p;

  const parts = splitPathSegments(p);
  const basename = parts.length > 0 ? parts[parts.length - 1] : p;
  if (maxLen <= 1) return "…".slice(0, maxLen);

  if (basename.length >= maxLen) {
    return "…" + basename.slice(-(maxLen - 1));
  }

  let tail = basename;
  for (let i = parts.length - 2; i >= 0; i -= 1) {
    const candidate = `${parts[i]}/${tail}`;
    if (`…/${candidate}`.length > maxLen) {
      break;
    }
    tail = candidate;
  }

  return `…/${tail}`;
}

function normalizePathForDisplay(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized === "/" || /^[A-Za-z]:\/?$/.test(normalized)) {
    return normalized;
  }
  return normalized.replace(/\/+$/g, "");
}

function normalizeProjectRoots(projectRoot: string | string[]): string[] {
  const roots = Array.isArray(projectRoot) ? projectRoot : [projectRoot];
  const seen = new Set<string>();
  const normalized: string[] = [];

  for (const root of roots) {
    const value = normalizePathForDisplay(root);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
  }

  return normalized.sort((a, b) => b.length - a.length);
}

function splitPathSegments(path: string): string[] {
  const segments = path.split("/").filter(Boolean);
  return segments.length > 0 ? segments : [path];
}

function getLastPathSegment(path: string): string {
  const segments = splitPathSegments(path);
  return segments.length > 0 ? segments[segments.length - 1] : path;
}

function isPathLikeText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) return false;

  const normalized = trimmed.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.startsWith("~/")) return true;
  if (/^[A-Za-z]:\//.test(normalized)) return true;

  const lower = normalized.toLowerCase();
  const segmentCount = normalized.split("/").filter(Boolean).length;
  if (segmentCount < 3) return false;

  return (
    lower.startsWith("users/") ||
    lower.startsWith("home/") ||
    lower.startsWith("var/") ||
    lower.startsWith("tmp/")
  );
}
