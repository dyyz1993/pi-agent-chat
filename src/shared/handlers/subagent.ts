import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { SubagentSessionInfo } from "../modules/subagent";
import { readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { createLogger } from "../lib/logger";

const log = createLogger("subagent");

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

    return { subsessions };
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
