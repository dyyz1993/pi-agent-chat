import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { SessionEntry } from "../modules/session";
import { readFile, writeFile, appendFile, mkdir, unlink } from "fs/promises";
import { existsSync, createReadStream } from "fs";
import * as readline from "readline";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";
import { pinSession, unpinSession, listPinnedSessionIds } from "../lib/project-config";
import { createLogger } from "../lib/logger";

const log = createLogger("session");

const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

function encodeCwd(cwd: string): string {
  return "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("session.getEntries", async (params) => {
    const { sessionPath } = params;

    if (!existsSync(sessionPath)) {
      return { entries: [], hasMore: false };
    }

    const entries: SessionEntry[] = [];
    let lineIdx = 0;

    const rl = readline.createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) {
        lineIdx++;
        continue;
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

    rl.close();
    return { entries, hasMore: false };
  });

  r("session.create", async (params) => {
    const { projectPath } = params;
    const sessionId = randomUUID();
    const dirName = encodeCwd(projectPath);
    const sessionDir = join(SESSIONS_DIR, dirName);
    const sessionPath = join(sessionDir, `${sessionId}.jsonl`);

    await mkdir(sessionDir, { recursive: true });

    const header = {
      type: "session",
      version: 1,
      id: sessionId,
      timestamp: new Date().toISOString(),
      cwd: projectPath,
    };
    await writeFile(sessionPath, JSON.stringify(header) + "\n", "utf-8");

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
    const cwd = process.cwd();
    const sessionsDir = join(cwd, ".pi", "sessions");

    if (!existsSync(sessionsDir)) {
      throw new Error("No sessions directory found in current working directory");
    }

    const files = await (await import("fs/promises")).readdir(sessionsDir);
    const sessionFiles = files.filter((f) => f.endsWith(".jsonl"));

    if (sessionFiles.length === 0) {
      throw new Error("No session files found in .pi/sessions directory");
    }

    // 读取第一个（最近）会话文件的 header
    const sessionFile = join(sessionsDir, sessionFiles[0]);
    const { readFile } = await import("fs/promises");
    const content = await readFile(sessionFile, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    let delegateParentSessionId: string | undefined;
    let delegateType: string | undefined;

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as Record<string, unknown>;
        if (parsed.type === "session") {
          return {
            sessionId: (parsed.id as string) ?? "",
            sessionPath: sessionFile,
            projectPath: (parsed.cwd as string) ?? cwd,
            cwd: (parsed.cwd as string) ?? cwd,
            delegateParentSessionId:
              (parsed.delegateParentSessionId as string | undefined) ?? delegateParentSessionId,
            delegateType: delegateType ?? null,
            createdAt: parsed.timestamp as string | undefined,
          };
        }
        if (parsed.type === "delegate_info" && parsed.delegateParentSessionId) {
          delegateParentSessionId = parsed.delegateParentSessionId as string;
          if (parsed.delegateType) delegateType = parsed.delegateType as string;
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
