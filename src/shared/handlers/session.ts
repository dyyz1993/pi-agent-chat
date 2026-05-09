import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { SessionEntry } from "../modules/session";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
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
}
