import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import type { SessionEntry } from "../modules/session";
import { readFile, writeFile, mkdir, unlink } from "fs/promises";
import { existsSync, createReadStream } from "fs";
import * as readline from "readline";
import { join } from "path";
import { homedir } from "os";
import { randomUUID } from "crypto";

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

const SESSIONS_DIR = join(homedir(), ".pi", "agent", "sessions");

function encodeCwd(cwd: string): string {
  return "--" + cwd.replace(/^\//, "").replace(/\//g, "-") + "--";
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  r("session.getEntries", async (params) => {
    const { sessionPath, limit = 200, cursor } = params;

    if (!existsSync(sessionPath)) {
      return { entries: [], hasMore: false };
    }

    const startIdx = cursor ? parseInt(cursor, 10) : 1;
    const entries: SessionEntry[] = [];
    let lineIdx = 0;
    let hasMore = false;

    const rl = readline.createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) { lineIdx++; continue; }
      if (lineIdx < startIdx) { lineIdx++; continue; }
      if (entries.length >= limit) { hasMore = true; break; }
      try {
        const parsed = JSON.parse(line);
        entries.push({
          id: parsed.id || `entry-${lineIdx}`,
          type: (parsed.type || "custom") as SessionEntry["type"],
          parentId: parsed.parentId || null,
          timestamp: new Date(parsed.timestamp || 0).getTime(),
          data: parsed,
        });
      } catch {}
      lineIdx++;
    }

    rl.close();
    return { entries, hasMore };
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
        const entry = JSON.parse(lines[i]);
        if (entry.type === "session_info") {
          entry.name = newName;
          lines[i] = JSON.stringify(entry);
          found = true;
          break;
        }
      } catch {
        continue;
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
    const { sessionPath } = params;
    if (!existsSync(sessionPath)) {
      return { ok: false };
    }
    await unlink(sessionPath);
    return { ok: true };
  });
}
