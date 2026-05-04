import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import type { BashChannelCommand, BashProcess } from "../modules/bash";
import { getProcessManager } from "./agent";
import { statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { spawn as spawnProc, type ChildProcess } from "child_process";

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  const serverSubs = (server as unknown as { subscriptions: Map<string, { eventType: string; filter: Record<string, unknown> }> }).subscriptions;

  const killedToolCalls = new Set<string>();

  r("bash.list", async (params) => {
    const { sessionId } = params as { sessionId?: string };
    if (!sessionId) return { processes: [] };

    const pm = getProcessManager();
    if (!pm) return { processes: [] };

    try {
      const result = await pm.callChannel(sessionId, "bash", "list", {}) as { processes?: BashProcess[] };
      return { processes: result?.processes ?? [] };
    } catch {
      return { processes: [] };
    }
  });

  r("bash.command", async (params) => {
    const { sessionId, action, toolCallId, data } = params as {
      sessionId: string;
    } & BashChannelCommand & { sessionId: string };

    if (action === "kill" && toolCallId) {
      const dedupeKey = `${sessionId}:${toolCallId}`;
      if (killedToolCalls.has(dedupeKey)) {
        return { ok: true };
      }
      killedToolCalls.add(dedupeKey);
    }

    const pm = getProcessManager();
    if (!pm) throw new Error("No process manager available");
    await pm.callChannel(sessionId, "bash", action, { toolCallId, data });

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

  const watchers = new Map<string, { tail: ChildProcess; subId: string; sendQueue: Promise<void> }>();

  const isValidLogPath = (path: string): boolean => {
    if (!path || typeof path !== "string") return false;
    if (path.includes("..")) return false;
    if (/[<>"'|;&$`\\]/.test(path)) return false;
    try {
      statSync(path);
      return true;
    } catch {
      return false;
    }
  };

  function killWatcher(logPath: string): void {
    const entry = watchers.get(logPath);
    if (!entry) return;
    entry.tail.kill("SIGTERM");
    serverSubs.delete(entry.subId);
    watchers.delete(logPath);
  }

  r("bash.watchLog", async (params) => {
    const { logPath, sessionId } = params as { logPath: string; sessionId?: string };
    if (!isValidLogPath(logPath)) return { watching: false };

    killWatcher(logPath);

    const subId = `__bash_log_${logPath}`;
    serverSubs.set(subId, { eventType: "bash.logUpdate", filter: {} });

    const tail = spawnProc("tail", ["-F", "-n", "0", logPath], {
      env: process.env,
    });

    const entry: { tail: ChildProcess; subId: string; sendQueue: Promise<void> } = {
      tail,
      subId,
      sendQueue: Promise.resolve(),
    };

    let buffer = "";
    tail.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf-8");
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      const completeLines = lines.filter((l) => l.length > 0);
      if (completeLines.length > 0) {
        entry.sendQueue = entry.sendQueue.then(() =>
          server.emitEvent("bash.logUpdate", { logPath, newLines: completeLines }, sessionId ? { sessionId } : undefined)
        );
      }
    });
    tail.stderr.on("data", () => {});
    tail.on("error", () => {});

    watchers.set(logPath, entry);
    return { watching: true };
  });

  r("bash.unwatchLog", async (params) => {
    const { logPath } = params as { logPath: string };
    killWatcher(logPath);
    return { stopped: true };
  });
}
