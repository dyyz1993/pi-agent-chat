import { readdir, stat, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join, basename } from "path";
import { homedir } from "os";
import type { SessionMeta, PiProject, MergedProject } from "../modules/project";
import { listRecentProjects, listPinnedSessionIds } from "./project-config";

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
}

interface JsonlEntry {
  type: string;
  id: string;
  parentId: string | null;
  timestamp: string;
  message?: {
    role: string;
    content?: Array<{ type: string; text?: string }>;
  };
  name?: string;
  cwd?: string;
}

async function parseJsonlHeader(filePath: string): Promise<JsonlHeader | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const firstLine = content.split("\n")[0];
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
  } catch {
    return null;
  }
}

async function parseJsonlMeta(filePath: string): Promise<{
  messageCount: number;
  firstMessage: string;
  sessionName: string;
  parentSessionPath: string | null;
  effectiveCwd: string | null;
} | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    let messageCount = 0;
    let firstMessage = "";
    let sessionName = "";
    let parentSessionPath: string | null = null;
    let effectiveCwd: string | null = null;

    for (const line of lines) {
      try {
        const entry: JsonlEntry = JSON.parse(line) as JsonlEntry;
        if (entry.type === "message" && entry.message?.role === "user") {
          messageCount++;
          if (!firstMessage && entry.message.content) {
            const textPart = entry.message.content.find((c) => c.type === "text" && c.text);
            if (textPart?.text) {
              firstMessage = textPart.text.slice(0, 100);
            }
          }
        }
        if (entry.type === "session_info") {
          if (entry.name) sessionName = entry.name;
          if (entry.cwd) effectiveCwd = entry.cwd;
        }
        if (entry.type === "session" && "parentSession" in entry) {
          parentSessionPath = (entry as Record<string, unknown>).parentSession as string;
        }
      } catch {
        continue;
      }
    }

    return { messageCount, firstMessage, sessionName, parentSessionPath, effectiveCwd };
  } catch {
    return null;
  }
}

async function scanSessionDir(sessionDir: string, pinnedIds?: Set<string>): Promise<SessionMeta[]> {
  if (!existsSync(sessionDir)) return [];

  const files = await readdir(sessionDir);
  const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

  const results = await Promise.all(
    jsonlFiles.map(async (file) => {
      const filePath = join(sessionDir, file);
      try {
        const [header, meta, fileStat] = await Promise.all([
          parseJsonlHeader(filePath),
          parseJsonlMeta(filePath),
          stat(filePath),
        ]);
        if (!header) return null;
        return {
          sessionId: header.id,
          name: meta?.sessionName ?? basename(file, ".jsonl"),
          sessionPath: filePath,
          projectPath: meta?.effectiveCwd ?? header.cwd,
          parentSessionPath: meta?.parentSessionPath ?? null,
          messageCount: meta?.messageCount ?? 0,
          firstMessage: meta?.firstMessage ?? "",
          createdAt: new Date(header.timestamp).getTime(),
          updatedAt: fileStat.mtimeMs,
          status: "idle" as const,
          pinned: pinnedIds ? pinnedIds.has(header.id) : false,
        };
      } catch {
        return null;
      }
    }),
  );

  const filtered = results
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .filter((s) => existsSync(s.projectPath));
  filtered.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return b.updatedAt - a.updatedAt;
  });
  return filtered as SessionMeta[];
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
    } catch {
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
      messageCount: meta?.messageCount ?? 0,
      firstMessage: meta?.firstMessage ?? "",
      createdAt: new Date(header.timestamp).getTime(),
      updatedAt: fileStat.mtimeMs,
      status: "idle" as const,
      pinned: pinnedIds.has(header.id),
    };
  }

  return null;
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
  } catch {
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
      } catch {
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
