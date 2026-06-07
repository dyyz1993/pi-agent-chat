import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { BashChannelCommand, BashProcess } from "../modules/bash";
import { getProcessManager } from "./agent";
import { statSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { spawn as spawnProc, type ChildProcess } from "child_process";
import { createLogger } from "../lib/logger";

const log = createLogger("bash");

const CHANNEL_TIMEOUT_MS = 1_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`channel call timed out (${ms}ms)`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  const serverSubs = (
    server as unknown as {
      subscriptions: Map<string, { eventType: string; filter: Record<string, unknown> }>;
    }
  ).subscriptions;

  r("bash.list", async (params) => {
    const { sessionId } = params as { sessionId?: string };
    if (!sessionId) return { processes: [] };

    const pm = getProcessManager();
    if (!pm) return { processes: [] };

    try {
      const rawResult: unknown = await withTimeout(
        pm.callChannel(sessionId, "bash", "list", {}),
        CHANNEL_TIMEOUT_MS,
      );
      const processes =
        typeof rawResult === "object" &&
        rawResult !== null &&
        "processes" in rawResult &&
        Array.isArray((rawResult as Record<string, unknown>).processes)
          ? (rawResult as { processes: BashProcess[] }).processes
          : [];
      return { processes };
    } catch {
      return { processes: [] };
    }
  });

  r("bash.command", async (params) => {
    const { sessionId, action, toolCallId, data } = params as {
      sessionId: string;
    } & BashChannelCommand & { sessionId: string };

    const pm = getProcessManager();
    if (!pm) throw new Error("No process manager available");
    try {
      await withTimeout(
        pm.callChannel(sessionId, "bash", action, { toolCallId, data }),
        CHANNEL_TIMEOUT_MS,
      );
    } catch (err) {
      log.warn("bash.command channel call failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      throw new Error("bash channel call failed");
    }

    return { ok: true };
  });

  r("bash.readLog", async (params) => {
    const {
      logPath,
      offset = 0,
      limit = 500,
    } = params as {
      logPath: string;
      offset?: number;
      limit?: number;
    };

    if (!logPath || typeof logPath !== "string") {
      return { lines: [], totalLines: 0, hasMore: false };
    }

    try {
      statSync(logPath);
    } catch (e) {
      log.debug("bash.readLog: log file not accessible", { logPath, error: String(e) });
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

  const watchers = new Map<
    string,
    { tail: ChildProcess; subId: string; sendQueue: Promise<void> }
  >();

  const isValidLogPath = (path: string): boolean => {
    if (!path || typeof path !== "string") return false;
    if (path.includes("..")) return false;
    if (/[<>"'|;&$`\\]/.test(path)) return false;
    try {
      statSync(path);
      return true;
    } catch (e) {
      log.debug("isValidLogPath: path not accessible", { path, error: String(e) });
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
          server.emitEvent(
            "bash.logUpdate",
            { logPath, newLines: completeLines },
            sessionId ? { sessionId } : undefined,
          ),
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
