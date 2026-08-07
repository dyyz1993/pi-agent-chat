import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { SessionEntry } from "../modules/session";
import { readFile, writeFile, appendFile, mkdir, unlink, readdir, stat } from "fs/promises";
import { existsSync, createReadStream, openSync, writeSync, closeSync, fsyncSync } from "fs";
import * as readline from "readline";
import { join } from "path";
import { randomUUID } from "crypto";
import { pinSession, unpinSession, listPinnedSessionIds } from "../lib/project-config";
import { createLogger } from "../lib/logger";
import { getProjectSessionDir, getSessionsRoot } from "../lib/pi-agent-paths";

const log = createLogger("session");

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("session.getEntries", async (params) => {
    const { sessionPath } = params;
    // Honor limit + cursor to bound response size on long sessions.
    // Without this, a 100MB session.jsonl is parsed end-to-end and the
    // entire entries array is sent over the WS, blowing the buffer and
    // stalling mobile clients. Default cap matches what callers expect
    // for a single page (200 entries ≈ 100-500 KB depending on payload).
    const DEFAULT_LIMIT = 200;
    const MAX_LIMIT = 2000;
    const limit = Math.min(Math.max(1, params.limit ?? DEFAULT_LIMIT), MAX_LIMIT);
    const cursor = params.cursor; // line index of the last returned entry

    if (!existsSync(sessionPath)) {
      return { entries: [], nextCursor: null, hasMore: false };
    }

    const entries: SessionEntry[] = [];
    let lineIdx = 0;
    let startLine = cursor ? parseInt(cursor, 10) : 0;
    if (Number.isNaN(startLine) || startLine < 0) startLine = 0;
    let nextCursor: string | null = null;
    let hasMore = false;

    const rl = readline.createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    try {
      for await (const line of rl) {
        // Skip lines before cursor (resuming a previous paginated read)
        if (lineIdx < startLine) {
          lineIdx++;
          continue;
        }
        if (!line.trim()) {
          lineIdx++;
          continue;
        }
        if (entries.length >= limit) {
          // There's more data; stop reading to avoid parsing the whole file.
          hasMore = true;
          nextCursor = String(lineIdx);
          break;
        }
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          entries.push({
            id: (parsed.id as string) ?? `entry-${lineIdx}`,
            type: ((parsed.type as string) ?? "custom") as SessionEntry["type"],
            parentId: (parsed.parentId as string | null) ?? null,
            timestamp: new Date((parsed.timestamp as string | number) ?? 0).getTime(),
            data: parsed,
          });
        } catch (err) {
          log.debug("skipping malformed JSONL entry:", { err: String(err) });
        }
        lineIdx++;
      }
    } finally {
      rl.close();
    }

    return { entries, nextCursor, hasMore };
  });

  r("session.create", async (params) => {
    const { projectPath } = params;
    const sessionId = randomUUID();
    const sessionDir = getProjectSessionDir(projectPath);
    const sessionPath = join(sessionDir, `${sessionId}.jsonl`);

    await mkdir(sessionDir, { recursive: true });

    const header = {
      type: "session",
      version: 3,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd: projectPath,
    };
    // Write + fsync to guarantee the header is on disk before pi CLI spawns
    // and reads the file via --session flag. Without fsync, the spawn can
    // race ahead of the write buffer, see an empty file, and truncate it.
    const fd = openSync(sessionPath, "w");
    try {
      writeSync(fd, JSON.stringify(header) + "\n", 0, "utf-8");
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }

    return { sessionId, sessionPath };
  });

  r("session.rename", async (params) => {
    const { sessionPath, newName } = params;
    if (!existsSync(sessionPath)) {
      return { ok: false };
    }

    const content = await readFile(sessionPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    let found = false;
    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>;
        if (entry.type === "session_info") {
          entry.name = newName;
          lines[i] = JSON.stringify(entry);
          found = true;
          break;
        }
      } catch (err) {
        log.debug("renameSession: skipping malformed entry:", { err: String(err) });
      }
    }

    if (!found) {
      const nameEntry = {
        type: "session_info",
        id: randomUUID(),
        parentId: null,
        timestamp: new Date().toISOString(),
        name: newName,
      };
      lines.push(JSON.stringify(nameEntry));
    }

    await writeFile(sessionPath, lines.join("\n") + "\n", "utf-8");
    return { ok: true };
  });

  r("session.delete", async (params) => {
    const { sessionPath, sessionId } = params;
    if (!existsSync(sessionPath)) {
      return { ok: false };
    }
    await unlink(sessionPath);
    await unpinSession(sessionId);
    return { ok: true };
  });

  r("session.pin", async (params) => {
    const pinnedSessionIds = await pinSession(params.sessionId);
    return { pinnedSessionIds };
  });

  r("session.unpin", async (params) => {
    const pinnedSessionIds = await unpinSession(params.sessionId);
    return { pinnedSessionIds };
  });

  r("session.getMetadata", async () => {
    const sessionsDir = getSessionsRoot();

    if (!existsSync(sessionsDir)) {
      throw new Error("No sessions directory found in PI agent directory");
    }

    const dirs = await readdir(sessionsDir);
    const sessionFiles: { path: string; mtimeMs: number }[] = [];
    for (const dir of dirs) {
      const fullDir = join(sessionsDir, dir);
      try {
        if (!(await stat(fullDir)).isDirectory()) continue;
        const files = await readdir(fullDir);
        for (const file of files) {
          if (!file.endsWith(".jsonl")) continue;
          const sessionFile = join(fullDir, file);
          const s = await stat(sessionFile);
          if (s.isFile()) sessionFiles.push({ path: sessionFile, mtimeMs: s.mtimeMs });
        }
      } catch (err) {
        log.debug("session.getMetadata: skipping session directory", {
          fullDir,
          err: String(err),
        });
      }
    }

    if (sessionFiles.length === 0) {
      throw new Error("No session files found in PI agent sessions directory");
    }

    sessionFiles.sort((a, b) => b.mtimeMs - a.mtimeMs);
    const sessionFile = sessionFiles[0].path;
    const content = await readFile(sessionFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    let delegateParentSessionId: string | undefined;
    let delegateType: string | undefined;
    let agent: string | undefined;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.type === "session") {
          return {
            sessionId: (parsed.id as string) ?? "",
            sessionPath: sessionFile,
            projectPath: (parsed.cwd as string) ?? process.cwd(),
            cwd: (parsed.cwd as string) ?? process.cwd(),
            delegateParentSessionId:
              (parsed.delegateParentSessionId as string | undefined) ?? delegateParentSessionId,
            delegateType: delegateType ?? null,
            agent: (parsed.agent as string | undefined) ?? agent,
            createdAt: parsed.timestamp as string | undefined,
          };
        }
        if (parsed.type === "delegate_info" && parsed.delegateParentSessionId) {
          delegateParentSessionId = parsed.delegateParentSessionId as string;
          if (parsed.delegateType) delegateType = parsed.delegateType as string;
          if (typeof parsed.agent === "string" && parsed.agent.trim()) {
            agent = parsed.agent;
          }
        }
      } catch {
        continue;
      }
    }

    throw new Error("No session header found in session file");
  });

  r("session.listPinned", async () => {
    const pinnedSessionIds = await listPinnedSessionIds();
    return { pinnedSessionIds };
  });

  r("session.updateCwd", async (params) => {
    const { sessionPath, newCwd } = params;
    if (!existsSync(sessionPath)) {
      return { ok: false };
    }

    const content = await readFile(sessionPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    let found = false;
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>;
        if (entry.type === "session_info") {
          entry.cwd = newCwd;
          lines[i] = JSON.stringify(entry);
          found = true;
          break;
        }
      } catch (err) {
        log.debug("updateCwd: skipping malformed entry:", { err: String(err) });
      }
    }

    if (!found) {
      const cwdEntry = {
        type: "session_info",
        id: randomUUID(),
        parentId: null,
        timestamp: new Date().toISOString(),
        cwd: newCwd,
      };
      lines.push(JSON.stringify(cwdEntry));
    }

    await writeFile(sessionPath, lines.join("\n") + "\n", "utf-8");
    return { ok: true };
  });

  r("session.saveTierConfig", async (params) => {
    const { sessionPath, tierModels, currentTier, currentModel } = params;
    if (!existsSync(sessionPath)) {
      return { ok: false };
    }

    const entry = {
      type: "session_tier_config",
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      tierModels,
      currentTier,
      currentModel,
    };
    await appendFile(sessionPath, JSON.stringify(entry) + "\n", "utf-8");
    return { ok: true };
  });

  r("session.loadTierConfig", async (params) => {
    const { sessionPath } = params;
    if (!existsSync(sessionPath)) {
      return { config: null };
    }

    const rl = readline.createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    const tierEntries: Array<{
      tierModels: Record<string, string>;
      currentTier: string | null;
      currentModel: { provider: string; id: string } | null;
    }> = [];

    for await (const line of rl) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.type === "session_tier_config") {
          tierEntries.push({
            tierModels: parsed.tierModels as Record<string, string>,
            currentTier: parsed.currentTier as string | null,
            currentModel: parsed.currentModel as { provider: string; id: string } | null,
          });
        }
      } catch (err) {
        log.debug("loadTierConfig: skipping malformed entry:", { err: String(err) });
      }
    }
    rl.close();

    if (tierEntries.length === 0) {
      return { config: null };
    }

    return { config: tierEntries[tierEntries.length - 1] };
  });
}
