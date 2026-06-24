import { execFile } from "node:child_process";
import { basename, dirname, posix } from "node:path";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { createLogger } from "../lib/logger";
import { getSessionBucketKey } from "../lib/pi-agent-paths";
import type { ActiveRuntimeSelection } from "./remote-runtime-selection";
import { buildSshArgs, shQuote, shRemotePath } from "../../sandbox/providers/ssh";

const log = createLogger("agent");

type RemoteChildRuntime = Extract<ActiveRuntimeSelection, { kind: "remote-agent-child" }>;

interface MirrorClient {
  getState(): Promise<{ sessionFile?: string | null }>;
  onEvent?: (handler: (event: unknown) => void) => (() => void) | void;
  stop(): Promise<void>;
}

export function getRemoteChildSessionDir(options: {
  remotePiAgentDir?: string;
  remoteCwd: string;
}): string | undefined {
  if (!options.remotePiAgentDir) return undefined;
  const base = options.remotePiAgentDir.replace(/\/+$/, "");
  return posix.join(base, "sessions", getSessionBucketKey(options.remoteCwd));
}

export function normalizeRemoteSessionJsonlForLocalIndex(input: {
  content: string;
  sessionId: string;
  localProjectPath: string;
}): string | null {
  const lines = input.content.split(/\r?\n/);
  let sawMatchingHeader = false;
  const normalized = lines.map((line) => {
    if (!line.trim()) return line;
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.type === "session") {
        if (entry.id !== input.sessionId) return line;
        sawMatchingHeader = true;
        return JSON.stringify({ ...entry, cwd: input.localProjectPath });
      }
      if (entry.type === "session_info" && typeof entry.cwd === "string") {
        return JSON.stringify({ ...entry, cwd: input.localProjectPath });
      }
    } catch {
      return line;
    }
    return line;
  });

  if (!sawMatchingHeader) return null;
  return normalized.join("\n").replace(/\n*$/, "\n");
}

async function readRemoteFile(options: {
  runtime: RemoteChildRuntime;
  remoteSessionFile: string;
}): Promise<string> {
  const command = `cat ${shRemotePath(options.remoteSessionFile)}`;
  const args = [
    ...buildSshArgs({
      target: options.runtime.target,
      port: options.runtime.port,
      keyPath: options.runtime.keyPath,
      extra: options.runtime.sshArgs,
    }),
    `${options.runtime.shell} ${shQuote(command)}`,
  ];

  return new Promise((resolve, reject) => {
    execFile("ssh", args, { maxBuffer: 64 * 1024 * 1024, timeout: 20_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`ssh session mirror failed: ${err.message}\nstderr: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

async function writeLocalMirror(options: {
  localSessionPath: string;
  content: string;
}): Promise<void> {
  let current = "";
  try {
    current = await readFile(options.localSessionPath, "utf-8");
  } catch {
    current = "";
  }
  if (current === options.content) return;

  const dir = dirname(options.localSessionPath);
  await mkdir(dir, { recursive: true });
  const tempPath = `${options.localSessionPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, options.content, "utf-8");
  await rename(tempPath, options.localSessionPath);
}

export function attachRemoteSessionMirror(options: {
  client: MirrorClient;
  runtime: RemoteChildRuntime;
  sessionId: string | undefined;
  localProjectPath: string;
  localSessionPath: string | undefined;
  debounceMs?: number;
}): void {
  if (!options.sessionId || !options.localSessionPath) return;

  let timer: NodeJS.Timeout | undefined;
  let inFlight = false;
  let pending = false;
  let disposed = false;
  let lastRemoteSessionFile = "";

  const mirrorNow = async (): Promise<void> => {
    if (disposed) return;
    if (inFlight) {
      pending = true;
      return;
    }
    inFlight = true;
    try {
      const state = await options.client.getState();
      const remoteSessionFile =
        typeof state.sessionFile === "string" && state.sessionFile ? state.sessionFile : "";
      if (!remoteSessionFile) return;
      lastRemoteSessionFile = remoteSessionFile;

      const content = await readRemoteFile({
        runtime: options.runtime,
        remoteSessionFile,
      });
      const normalized = normalizeRemoteSessionJsonlForLocalIndex({
        content,
        sessionId: options.sessionId,
        localProjectPath: options.localProjectPath,
      });
      if (!normalized) {
        log.warn("[remote-session-mirror] skipped non-matching session file", {
          sessionId: options.sessionId,
          remoteSessionFile,
        });
        return;
      }
      await writeLocalMirror({ localSessionPath: options.localSessionPath, content: normalized });
    } catch (err: unknown) {
      log.debug("[remote-session-mirror] mirror skipped", {
        sessionId: options.sessionId,
        remoteSessionFile: lastRemoteSessionFile,
        localSessionFile: basename(options.localSessionPath ?? ""),
        err: err instanceof Error ? err.message : String(err),
      });
    } finally {
      inFlight = false;
      if (pending && !disposed) {
        pending = false;
        scheduleMirror();
      }
    }
  };

  const scheduleMirror = (): void => {
    if (disposed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      void mirrorNow();
    }, options.debounceMs ?? 1500);
  };

  const unsubscribe = options.client.onEvent?.(() => {
    scheduleMirror();
  });

  const originalStop = options.client.stop.bind(options.client);
  options.client.stop = async () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    await mirrorNow().catch(() => {});
    disposed = true;
    if (typeof unsubscribe === "function") unsubscribe();
    return originalStop();
  };

  scheduleMirror();
}
