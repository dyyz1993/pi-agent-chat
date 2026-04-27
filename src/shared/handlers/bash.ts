import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import type { BashChannelCommand } from "../modules/bash";
import { getProcessManager } from "./agent";
import { statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { spawn as spawnProc } from "child_process";

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  r("bash.list", async (params) => {
    const { sessionId } = params as { sessionId?: string };
    if (!sessionId) return { processes: [] };

    const pm = getProcessManager();
    if (!pm) return { processes: [] };

    pm.sendChannelData(sessionId, "bash", { action: "list" });
    return { processes: [] };
  });

  r("bash.command", async (params) => {
    const { sessionId, action, toolCallId, data } = params as {
      sessionId: string;
    } & BashChannelCommand & { sessionId: string };

    const pm = getProcessManager();
    if (!pm) throw new Error("No process manager available");
    pm.sendChannelData(sessionId, "bash", { action, toolCallId, data });

    return { ok: true };
  });

  r("bash.readLog", async (params) => {
    const { logPath, offset = 0, limit = 500 } = params as {
      logPath: string;
      offset?: number;
      limit?: number;
    };

    if (!logPath || typeof logPath !== "string") {
      return { lines: [], totalLines: 0, hasMore: false };
    }

    try {
      statSync(logPath);
    } catch {
      return { lines: [], totalLines: 0, hasMore: false };
    }

    const lines: string[] = [];
    let totalLines = 0;
    let skipped = 0;

    const rl = createInterface({ input: createReadStream(logPath, { encoding: "utf-8" }) });

    for await (const line of rl) {
      totalLines++;
      if (skipped < offset) {
        skipped++;
        continue;
      }
      if (lines.length >= limit) continue;
      lines.push(line);
    }

    return {
      lines,
      totalLines,
      hasMore: offset + lines.length < totalLines,
    };
  });

  const watchers = new Map<string, ReturnType<typeof spawnProc>>();

  r("bash.watchLog", async (params) => {
    const { logPath } = params as { logPath: string };
    if (!logPath || typeof logPath !== "string") return { watching: false };
    if (watchers.has(logPath)) return { watching: true };

    const tail = spawnProc("tail", ["-F", "-n", "0", logPath], {
      env: process.env,
    });

    let buffer = "";
    tail.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      const completeLines = lines.filter((l) => l.length > 0);
      if (completeLines.length > 0) {
        server.emitEvent("bash.logUpdate", { logPath, newLines: completeLines });
      }
    });
    tail.stderr.on("data", () => {});
    tail.on("error", () => {});

    watchers.set(logPath, tail);
    return { watching: true };
  });

  r("bash.unwatchLog", async (params) => {
    const { logPath } = params as { logPath: string };
    const tail = watchers.get(logPath);
    if (tail) {
      tail.kill("SIGTERM");
      watchers.delete(logPath);
    }
    return { stopped: true };
  });
}
