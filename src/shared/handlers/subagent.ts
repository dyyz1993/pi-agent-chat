import type { RPCServer } from "@dyyz1993/rpc-core";
import * as readline from "node:readline";
import { createReadStream } from "node:fs";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { SubagentSessionInfo } from "../modules/subagent";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { dirname } from "path";
import { createLogger } from "../lib/logger";
import { scanSessionDir } from "../lib/session-scanner";

const log = createLogger("subagent");

async function readSessionHeaderId(sessionPath: string): Promise<string | null> {
  try {
    const content = await readFile(sessionPath, "utf-8");
    const firstLine = content
      .split("\n")
      .map((line) => line.trim())
      .find(Boolean);
    if (!firstLine) return null;
    const entry = JSON.parse(firstLine) as Record<string, unknown>;
    if (entry.type !== "session" || typeof entry.id !== "string") return null;
    return entry.id;
  } catch (error) {
    log.debug("subagent.readSessionHeaderId failed", {
      sessionPath,
      error: String(error),
    });
    return null;
  }
}

function normalizeSubagentDescription(name: string, sessionId: string): string {
  const trimmed = name.trim();
  if (!trimmed) return sessionId;
  if (trimmed.startsWith("子代理:")) return trimmed.slice("子代理:".length).trim() || sessionId;
  if (trimmed.startsWith("Subagent:")) return trimmed.slice("Subagent:".length).trim() || sessionId;
  return trimmed;
}

function normalizePersistedSubagent(data: Partial<SubagentSessionInfo>): SubagentSessionInfo | null {
  if (typeof data.sessionId !== "string" || !data.sessionId.trim()) return null;
  const sessionId = data.sessionId;
  return {
    ...data,
    sessionId,
    sessionPath: typeof data.sessionPath === "string" ? data.sessionPath : "",
    description:
      typeof data.description === "string" && data.description.trim()
        ? data.description
        : sessionId,
    instruction: typeof data.instruction === "string" ? data.instruction : "",
    startedAt: typeof data.startedAt === "number" ? data.startedAt : 0,
  };
}

function preferNonEmpty(primary: string | undefined, fallback: string | undefined): string {
  const trimmed = primary?.trim();
  if (trimmed) return primary ?? "";
  return fallback ?? "";
}

function mergeSubagentInfo(
  fallback: SubagentSessionInfo | undefined,
  persisted: SubagentSessionInfo,
): SubagentSessionInfo {
  return {
    ...fallback,
    ...persisted,
    sessionPath: preferNonEmpty(persisted.sessionPath, fallback?.sessionPath),
    description:
      preferNonEmpty(persisted.description, fallback?.description) || persisted.sessionId,
    instruction:
      preferNonEmpty(persisted.instruction, fallback?.instruction) || persisted.description,
    startedAt: persisted.startedAt > 0 ? persisted.startedAt : (fallback?.startedAt ?? Date.now()),
  };
}

async function loadFallbackSubagentSessions(parentSessionPath: string): Promise<SubagentSessionInfo[]> {
  const parentSessionId = await readSessionHeaderId(parentSessionPath);
  if (!parentSessionId) return [];

  const siblingSessions = await scanSessionDir(dirname(parentSessionPath));
  return siblingSessions
    .filter(
      (session) =>
        session.sessionId !== parentSessionId &&
        session.delegateType === "subagent" &&
        (session.delegateParentSessionId === parentSessionId ||
          session.parentSessionPath === parentSessionPath),
    )
    .map((session) => ({
      sessionId: session.sessionId,
      sessionPath: session.sessionPath,
      description: normalizeSubagentDescription(session.name || session.firstMessage, session.sessionId),
      instruction: session.firstMessage || normalizeSubagentDescription(session.name, session.sessionId),
      startedAt: session.createdAt,
    }));
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("subagent.listBySession", async (params) => {
    const { sessionPath } = params;

    if (!existsSync(sessionPath)) {
      return { subsessions: [] };
    }

    // Stream the file line-by-line instead of readFile(end) so a 100MB
    // session.jsonl doesn't blow memory. Only `customType === "subagent"`
    // entries are kept in memory after parsing.
    const subsessions: SubagentSessionInfo[] = [];
    const rl = readline.createInterface({
      input: createReadStream(sessionPath, { encoding: "utf-8" }),
      crlfDelay: Infinity,
    });

    try {
      for await (const line of rl) {
        if (!line.trim()) continue;
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;

          if (entry.type === "custom" && entry.customType === "subagent") {
            const data = normalizePersistedSubagent(
              (entry.data as Partial<SubagentSessionInfo> | undefined) ?? {},
            );
            if (data) subsessions.push(data);
          }
        } catch (e) {
          log.debug("subagent.listBySession: skipping malformed entry", { error: String(e) });
          continue;
        }
      }
    } finally {
      rl.close();
    }

    const fallbackSubs = await loadFallbackSubagentSessions(sessionPath);
    const merged = new Map<string, SubagentSessionInfo>();

    for (const sub of fallbackSubs) {
      merged.set(sub.sessionId, sub);
    }
    for (const sub of subsessions) {
      merged.set(sub.sessionId, mergeSubagentInfo(merged.get(sub.sessionId), sub));
    }

    return { subsessions: [...merged.values()] };
  });

  r("subagent.rename", async (params) => {
    const { parentSessionPath, subSessionId, newDescription } = params;

    if (!existsSync(parentSessionPath)) {
      return { ok: false };
    }

    const content = await readFile(parentSessionPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    let found = false;
    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]) as Record<string, unknown>;
        if (entry.type === "custom" && entry.customType === "subagent") {
          const data = entry.data as SubagentSessionInfo | undefined;
          if (data?.sessionId === subSessionId) {
            data.description = newDescription;
            entry.data = data;
            lines[i] = JSON.stringify(entry);
            found = true;
            break;
          }
        }
      } catch (err) {
        log.debug("subagent.rename: skipping malformed entry:", { err: String(err) });
      }
    }

    if (!found) {
      log.warn("subagent.rename: subagent not found", { subSessionId });
      return { ok: false };
    }

    await writeFile(parentSessionPath, lines.join("\n") + "\n", "utf-8");
    return { ok: true };
  });

  r("subagent.delete", async (params) => {
    const { parentSessionPath, subSessionId } = params;

    if (!existsSync(parentSessionPath)) {
      return { ok: false };
    }

    const content = await readFile(parentSessionPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());

    const filtered = lines.filter((line) => {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;
        if (entry.type === "custom" && entry.customType === "subagent") {
          const data = entry.data as SubagentSessionInfo | undefined;
          return data?.sessionId !== subSessionId;
        }
      } catch (e) {
        log.debug("subagent.delete: skipping malformed entry", { error: String(e) });
        return true;
      }
      return true;
    });

    if (filtered.length === lines.length) {
      log.warn("subagent.delete: subagent not found", { subSessionId });
      return { ok: false };
    }

    await writeFile(parentSessionPath, filtered.join("\n") + "\n", "utf-8");
    return { ok: true };
  });
}
