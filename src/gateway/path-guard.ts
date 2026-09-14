/**
 * Path whitelist guard — prevents path traversal attacks.
 *
 * Shared by all file-serving route handlers. Allowed roots:
 *  - Admin / single-token connections (no uid): static roots + the global
 *    recent projects + open tabs (previous behavior).
 *  - Token-user connections (uid from TOKEN_USERS): ONLY /tmp-like scratch
 *    roots, read-only config files, and the project roots this uid opened
 *    sessions on. Global recents/tabs are other users' data and stay hidden.
 */

import { resolve } from "path";
import { createLogger } from "../shared/lib/logger";
import { listRecentProjects, restoreOpenTabs } from "../shared/lib/project-config";
import { getPiAgentDir } from "../shared/lib/pi-agent-paths";
import { getUserProjectRoots } from "../shared/agent/session-ownership";

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

// Scratch roots a token-user may read/write without admin involvement.
const TOKEN_USER_STATIC_ROOTS = [resolve("/tmp"), resolve("/private/tmp")];

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

async function getAdminAllowedRoots(): Promise<string[]> {
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

function isUnderAny(resolved: string, roots: string[]): boolean {
  return roots.some((root) => resolved === root || resolved.startsWith(root + "/"));
}

export async function isPathAllowed(requestedPath: string, uid?: string): Promise<boolean> {
  const resolved = resolve(requestedPath);
  // Token-users are scoped to their own project roots + scratch space; the
  // admin/global roots (server cwd, /root, dotfile rules dirs, other users'
  // recent projects) must not leak through the file routes.
  if (uid) {
    return isUnderAny(resolved, [...TOKEN_USER_STATIC_ROOTS, ...getUserProjectRoots(uid)]);
  }
  const roots = await getAdminAllowedRoots();
  return isUnderAny(resolved, roots);
}

export async function isPathReadable(requestedPath: string, uid?: string): Promise<boolean> {
  const resolved = resolve(requestedPath);
  if (isUnderAny(resolved, READ_ONLY_ROOTS)) {
    return true;
  }
  return isPathAllowed(requestedPath, uid);
}
