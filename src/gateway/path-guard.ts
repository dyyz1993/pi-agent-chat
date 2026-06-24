/**
 * Path whitelist guard — prevents path traversal attacks.
 *
 * Shared by all file-serving route handlers. The allowed roots are
 * computed from the static ALLOWED_ROOTS list plus the user's recent
 * projects and open tabs (loaded from config.json).
 */

import { resolve } from "path";
import { createLogger } from "../shared/lib/logger";
import { listRecentProjects, restoreOpenTabs } from "../shared/lib/project-config";
import { getPiAgentDir } from "../shared/lib/pi-agent-paths";

const log = createLogger("gateway");

const ALLOWED_ROOTS = [
  resolve(process.cwd()),
  resolve("/root"),
  resolve(process.env.HOME ?? "", ".claude", "rules"),
  resolve(process.env.HOME ?? "", ".config", "opencode", "rules"),
  resolve(process.env.HOME ?? "", ".opencode", "rules"),
  resolve(process.env.HOME ?? "", ".agents"),
  resolve("/tmp"),
  resolve("/private/tmp"),
];

const READ_ONLY_ROOTS = [
  resolve(process.env.HOME ?? "", ".claude", "settings.json"),
  resolve(process.env.HOME ?? "", ".claude", "settings.local.json"),
  resolve(process.env.HOME ?? "", ".claude", "hooks"),
  resolve(process.env.HOME ?? "", ".pi", "agent", "settings.json"),
  resolve(process.env.HOME ?? "", ".pi", "agent", "hooks"),
  resolve(getPiAgentDir(), "projects"),
];

let cachedAllowedRoots: string[] | null = null;
let rootsCacheTime = 0;
const ROOTS_CACHE_TTL = 30_000;

async function getAllowedRoots(): Promise<string[]> {
  const now = Date.now();
  if (cachedAllowedRoots && now - rootsCacheTime < ROOTS_CACHE_TTL) return cachedAllowedRoots;
  try {
    const projects = await listRecentProjects();
    const { tabs } = await restoreOpenTabs();
    const tabPaths = tabs.map((t) => resolve(t.path));
    cachedAllowedRoots = [...ALLOWED_ROOTS, ...projects.map((p) => resolve(p.path)), ...tabPaths];
    rootsCacheTime = now;
  } catch (e) {
    log.debug("getAllowedRoots: failed to load projects, using defaults", { error: String(e) });
    cachedAllowedRoots = [...ALLOWED_ROOTS];
  }
  return cachedAllowedRoots;
}

export async function isPathAllowed(requestedPath: string): Promise<boolean> {
  const resolved = resolve(requestedPath);
  const roots = await getAllowedRoots();
  return roots.some((root) => resolved === root || resolved.startsWith(root + "/"));
}

export async function isPathReadable(requestedPath: string): Promise<boolean> {
  const resolved = resolve(requestedPath);
  if (READ_ONLY_ROOTS.some((root) => resolved === root || resolved.startsWith(root + "/"))) {
    return true;
  }
  return isPathAllowed(requestedPath);
}
