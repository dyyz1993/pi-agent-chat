import { readdir, stat } from "fs/promises";
import { createReadStream } from "fs";
import { existsSync } from "fs";
import { createInterface } from "readline";
import { join, basename } from "path";
import { homedir } from "os";
import { createLogger } from "./logger";
import type { SessionMeta, PiProject, MergedProject } from "../modules/project";
import { listRecentProjects, listPinnedSessionIds } from "./project-config";

const log = createLogger("session");

const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

function encodeCwd(cwd: string): string {
  return "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
}

interface JsonlHeader {
  type: "session";
  version: number;
  id: string;
  timestamp: string;
  cwd: string;
  delegateParentSessionId?: string;
}

async function parseJsonlHeader(filePath: string): Promise<JsonlHeader | null> {
  try {
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    const firstLine: string | null = await new Promise((resolve) => {
      rl.once("line", (line) => {
        rl.close();
        stream.destroy();
        resolve(line);
      });
      rl.once("error", () => {
        rl.close();
        stream.destroy();
        resolve(null);
      });
      // Safety timeout — if no line event within 3s, treat as unreadable
      setTimeout(() => {
        rl.close();
        stream.destroy();
        resolve(null);
      }, 3000);
    });
    if (!firstLine?.trim()) return null;
    const header: unknown = JSON.parse(firstLine);
    if (
      typeof header === "object" &&
      header !== null &&
      "type" in header &&
      (header as { type: string }).type !== "session"
    )
      return null;
    return header as JsonlHeader;
  } catch (e) {
    log.debug("parseJsonlHeader: failed to parse", { filePath, error: String(e) });
    return null;
  }
}

async function parseJsonlMeta(filePath: string): Promise<{
  messageCount: number;
  firstMessage: string;
  sessionName: string;
  parentSessionPath: string | null;
  effectiveCwd: string | null;
  delegateParentSessionId: string | null;
  delegateType: string | null;
  tierConfig: { tierModels: Record<string, string>; currentTier: string | null } | undefined;
} | null> {
  try {
    const stream = createReadStream(filePath, { encoding: "utf-8" });
    const rl = createInterface({ input: stream, crlfDelay: Infinity });

    let messageCount = 0;
    let firstMessage = "";
    let sessionName = "";
    let parentSessionPath: string | null = null;
    let effectiveCwd: string | null = null;
    let delegateParentSessionId: string | null = null;
    let delegateType: string | null = null;
    let tierConfig: { tierModels: Record<string, string>; currentTier: string | null } | undefined;
    let lineCount = 0;
    const MAX_LINES = 50;

    return new Promise((resolve) => {
      let resolved = false;

      const finish = () => {
        if (resolved) return;
        resolved = true;
        resolve({
          messageCount,
          firstMessage,
          sessionName,
          parentSessionPath,
          effectiveCwd,
          delegateParentSessionId,
          delegateType,
          tierConfig,
        });
      };

      rl.on("line", (line) => {
        lineCount++;
        if (lineCount > MAX_LINES) {
          rl.close();
          stream.destroy();
          return;
        }
        if (!line.trim()) return;
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (
            entry.type === "message" &&
            (entry.message as Record<string, unknown>)?.role === "user"
          ) {
            messageCount++;
            if (!firstMessage && (entry.message as Record<string, unknown>)?.content) {
              const contentArr = (entry.message as Record<string, unknown>).content as Array<
                Record<string, unknown>
              >;
              const textPart = contentArr.find((c) => c.type === "text" && c.text);
              if (textPart?.text) {
                firstMessage = (textPart.text as string).slice(0, 100);
              }
            }
          }
          if (entry.type === "session_info") {
            if (entry.name) sessionName = entry.name as string;
            if (entry.cwd) effectiveCwd = entry.cwd as string;
          }
          if (entry.type === "session_tier_config") {
            tierConfig = {
              tierModels: entry.tierModels as Record<string, string>,
              currentTier: entry.currentTier as string | null,
            };
          }
          if (entry.type === "session" && "parentSession" in entry) {
            parentSessionPath = entry.parentSession as string;
          }
          if (entry.type === "delegate_info" && entry.delegateParentSessionId) {
            delegateParentSessionId = entry.delegateParentSessionId as string;
            if (entry.delegateType) delegateType = entry.delegateType as string;
            if (entry.parentSessionPath && !parentSessionPath) {
              parentSessionPath = entry.parentSessionPath as string;
            }
          }
        } catch {
          // Skip malformed lines
        }
      });

      rl.on("close", finish);

      rl.on("error", () => {
        rl.close();
        stream.destroy();
        finish();
      });

      setTimeout(() => {
        rl.close();
        stream.destroy();
        finish();
      }, 5000);
    });
  } catch {
    return null;
  }
}

export async function scanSessionDir(sessionDir: string, pinnedIds?: Set<string>): Promise<SessionMeta[]> {
  if (!existsSync(sessionDir)) return [];

  const files = await readdir(sessionDir);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  const PRE_SCAN_LIMIT = 120;

  // Phase 1: stat all files in parallel to get mtime, then sort by mtime desc
  const statted = await Promise.all(
    jsonlFiles.map(async (file) => {
      const filePath = join(sessionDir, file);
      try {
        const fstat = await stat(filePath);
        return { file, filePath, mtimeMs: fstat.mtimeMs, size: fstat.size };
      } catch {
        return null;
      }
    }),
  );
  const validFiles = statted.filter((s): s is NonNullable<typeof s> => s !== null && s.size > 0);
  validFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);

  // Promote pinned files to the front so they survive the PRE_SCAN_LIMIT slice
  if (pinnedIds && pinnedIds.size > 0) {
    const pinned = validFiles.filter((e) => {
      const id = e.file.replace(/\.jsonl$/, "");
      return pinnedIds.has(id);
    });
    const unpinned = validFiles.filter((e) => {
      const id = e.file.replace(/\.jsonl$/, "");
      return !pinnedIds.has(id);
    });
    validFiles.length = 0;
    validFiles.push(...pinned, ...unpinned);
  }

  // Phase 2: only process the most recent files
  const candidates = validFiles.slice(0, PRE_SCAN_LIMIT);

  const BATCH_SIZE = 20;
  const results: (SessionMeta | null)[] = [];

  for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(
      batch.map(async ({ file, filePath, mtimeMs }) => {
        try {
          const [header, meta] = await Promise.all([
            parseJsonlHeader(filePath),
            parseJsonlMeta(filePath),
          ]);
          if (!header) return null;
          return {
            sessionId: header.id,
            name: meta?.sessionName ?? basename(file, ".jsonl"),
            sessionPath: filePath,
            projectPath: meta?.effectiveCwd ?? header.cwd,
            parentSessionPath: meta?.parentSessionPath ?? null,
            delegateParentSessionId:
              header.delegateParentSessionId ?? meta?.delegateParentSessionId ?? null,
            delegateType: meta?.delegateType ?? null,
            messageCount: meta?.messageCount ?? 0,
            firstMessage: meta?.firstMessage ?? "",
            createdAt: new Date(header.timestamp).getTime(),
            updatedAt: mtimeMs,
            status: "idle" as const,
            pinned: pinnedIds ? pinnedIds.has(header.id) : false,
            tierConfig: meta?.tierConfig,
          };
        } catch (e) {
          log.debug("scanSessionDir: skipping invalid session file", {
            filePath,
            error: String(e),
          });
          return null;
        }
      }),
    );
    results.push(...batchResults);
  }

  const filtered = results
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .filter((s) => existsSync(s.projectPath));
  filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  // Limit to 100 most recent sessions to keep WS response size manageable
  return filtered.slice(0, 100) as SessionMeta[];
}

export async function findSessionById(
  sessionId: string,
): Promise<(SessionMeta & { sessionPath: string }) | null> {
  if (!existsSync(SESSIONS_DIR)) return null;

  const dirs = await readdir(SESSIONS_DIR);
  const targetFile = `${sessionId}.jsonl`;

  for (const dir of dirs) {
    const fullPath = join(SESSIONS_DIR, dir);
    try {
      const dirStat = await stat(fullPath);
      if (!dirStat.isDirectory()) continue;
    } catch (e) {
      log.debug("findSessionById: skipping non-accessible dir", { fullPath, error: String(e) });
      continue;
    }

    const candidate = join(fullPath, targetFile);
    if (!existsSync(candidate)) continue;

    const [header, meta, fileStat] = await Promise.all([
      parseJsonlHeader(candidate),
      parseJsonlMeta(candidate),
      stat(candidate),
    ]);
    if (!header) continue;

    const projectPath = meta?.effectiveCwd ?? header.cwd;
    if (!existsSync(projectPath)) continue;

    const pinnedIds = await loadPinnedSet();
    return {
      sessionId: header.id,
      name: meta?.sessionName ?? basename(candidate, ".jsonl"),
      sessionPath: candidate,
      projectPath,
      parentSessionPath: meta?.parentSessionPath ?? null,
      delegateParentSessionId:
        header.delegateParentSessionId ?? meta?.delegateParentSessionId ?? null,
      delegateType: meta?.delegateType ?? null,
      messageCount: meta?.messageCount ?? 0,
      firstMessage: meta?.firstMessage ?? "",
      createdAt: new Date(header.timestamp).getTime(),
      updatedAt: fileStat.mtimeMs,
      status: "idle" as const,
      pinned: pinnedIds.has(header.id),
      tierConfig: meta?.tierConfig,
    };
  }

  return null;
}

export function buildDelegateIndex(sessions: SessionMeta[]): Map<string, SessionMeta[]> {
  const index = new Map<string, SessionMeta[]>();
  for (const sess of sessions) {
    if (!sess.delegateParentSessionId) continue;
    const children = index.get(sess.delegateParentSessionId);
    if (children) {
      children.push(sess);
    } else {
      index.set(sess.delegateParentSessionId, [sess]);
    }
  }
  return index;
}

export async function findDelegateChildren(
  parentSessionId: string,
  projectPath: string,
): Promise<string[]> {
  const dirName = encodeCwd(projectPath);
  const sessionDir = join(SESSIONS_DIR, dirName);
  if (!existsSync(sessionDir)) return [];

  const files = await readdir(sessionDir);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  const childIds: string[] = [];

  await Promise.all(
    jsonlFiles.map(async (file) => {
      const filePath = join(sessionDir, file);
      const [header, meta] = await Promise.all([
        parseJsonlHeader(filePath),
        parseJsonlMeta(filePath),
      ]);
      if (!header) return;
      const delegateId = header.delegateParentSessionId ?? meta?.delegateParentSessionId ?? null;
      if (delegateId === parentSessionId) {
        childIds.push(header.id);
      }
    }),
  );

  return childIds;
}

export async function scanSessionsForProject(projectPath: string): Promise<SessionMeta[]> {
  const dirName = encodeCwd(projectPath);
  const sessionDir = join(SESSIONS_DIR, dirName);
  const pinnedIds = await loadPinnedSet();
  return scanSessionDir(sessionDir, pinnedIds);
}

async function loadPinnedSet(): Promise<Set<string>> {
  try {
    const ids = await listPinnedSessionIds();
    return new Set(ids);
  } catch (e) {
    log.debug("loadPinnedSet: failed to load pinned session ids", { error: String(e) });
    return new Set();
  }
}

export async function scanAllProjects(): Promise<
  { projectPath: string; sessionCount: number; sessions: SessionMeta[] }[]
> {
  if (!existsSync(SESSIONS_DIR)) return [];

  const pinnedIds = await loadPinnedSet();
  const dirs = await readdir(SESSIONS_DIR);

  const allResults = await Promise.all(
    dirs.map(async (dir) => {
      const fullPath = join(SESSIONS_DIR, dir);
      try {
        const dirStat = await stat(fullPath);
        if (!dirStat.isDirectory()) return null;
      } catch (e) {
        log.debug("scanAllProjects: skipping inaccessible dir", { fullPath, error: String(e) });
        return null;
      }

      const sessions = await scanSessionDir(fullPath, pinnedIds);
      if (sessions.length === 0) return null;

      return { projectPath: sessions[0].projectPath, sessionCount: sessions.length, sessions };
    }),
  );

  const results = allResults.filter(
    (r): r is { projectPath: string; sessionCount: number; sessions: SessionMeta[] } => r !== null,
  );

  results.sort((a, b) => {
    const aLatest = a.sessions[0]?.updatedAt ?? 0;
    const bLatest = b.sessions[0]?.updatedAt ?? 0;
    return bLatest - aLatest;
  });

  return results;
}

export async function listPiProjects(): Promise<PiProject[]> {
  const allProjects = await scanAllProjects();
  return allProjects.map((p) => ({
    path: p.projectPath,
    name: basename(p.projectPath),
    sessionCount: p.sessionCount,
    lastModified: p.sessions[0]?.updatedAt ?? 0,
    hasActiveSession: p.sessions.some((s) => s.status === "running"),
  }));
}

export async function listMergedProjects(): Promise<MergedProject[]> {
  const [piProjects, recentProjects] = await Promise.all([listPiProjects(), listRecentProjects()]);

  const mergedMap = new Map<string, MergedProject>();

  for (const proj of piProjects) {
    mergedMap.set(proj.path, {
      path: proj.path,
      name: proj.name,
      source: "pi",
      sessionCount: proj.sessionCount,
      lastModified: proj.lastModified,
      hasActiveSession: proj.hasActiveSession,
    });
  }

  for (const proj of recentProjects) {
    if (!mergedMap.has(proj.path)) {
      mergedMap.set(proj.path, {
        path: proj.path,
        name: proj.name,
        source: "recent",
        sessionCount: proj.sessionCount,
        lastModified: proj.lastOpened,
        hasActiveSession: false,
      });
    }
  }

  return Array.from(mergedMap.values()).sort((a, b) => b.lastModified - a.lastModified);
}
