import type { RPCServer } from "@dyyz1993/rpc-core";
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

    const content = await readFile(sessionPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const subsessions: SubagentSessionInfo[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;

        if (entry.type === "custom" && entry.customType === "subagent") {
          const data = entry.data as SubagentSessionInfo | undefined;
          if (data?.sessionId && data?.sessionPath) {
            subsessions.push(data);
          }
        }
      } catch (e) {
        log.debug("subagent.listBySession: skipping malformed entry", { error: String(e) });
        continue;
      }
    }

    const fallbackSubs = await loadFallbackSubagentSessions(sessionPath);
    const merged = new Map<string, SubagentSessionInfo>();

    for (const sub of fallbackSubs) {
      merged.set(sub.sessionId, sub);
    }
    for (const sub of subsessions) {
      merged.set(sub.sessionId, {
        ...merged.get(sub.sessionId),
        ...sub,
      });
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
