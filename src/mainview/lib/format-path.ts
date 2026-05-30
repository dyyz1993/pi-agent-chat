import { useSessionStore } from "../stores/use-session-store";

export function getProjectRoot(): string {
  const { activeProjectId, projectTabs } = useSessionStore.getState();
  if (!activeProjectId) return "";
  const tab = projectTabs.find((t) => t.id === activeProjectId);
  return tab?.path ?? "";
}

export function formatFilePath(
  filePath: string,
  options?: { projectRoot?: string; maxLen?: number },
): string {
  if (!filePath) return "";

  const root = options?.projectRoot ?? getProjectRoot();

  if (root && filePath.startsWith(root + "/")) {
    const relative = filePath.slice(root.length + 1);
    return shortPath(relative, options?.maxLen);
  }

  if (root && filePath.startsWith(root)) {
    const basename = filePath.split("/").pop() ?? filePath;
    return shortPath(basename, options?.maxLen);
  }

  return shortPath(filePath, options?.maxLen);
}

function shortPath(p: string, maxLen?: number): string {
  if (!maxLen || p.length <= maxLen) return p;

  const basename = p.split("/").pop() ?? p;
  if (basename.length >= maxLen) {
    return "…" + basename.slice(-(maxLen - 1));
  }

  const parts = p.split("/");
  const fileName = parts.pop() ?? "";
  let dir = parts.join("/");
  const available = maxLen - fileName.length - 1;
  if (available > 0 && dir.length > available) {
    dir = "…" + dir.slice(-(available - 1));
  } else if (available <= 0) {
    return "…" + fileName.slice(0, maxLen - 1);
  }
  return `${dir}/${fileName}`;
}
