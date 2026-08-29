import { createLogger } from "../lib/logger";

const log = createLogger("agent");

export interface ProcessSignalDeps {
  isAlive: (pid: number) => boolean;
  kill: (pid: number, signal: "SIGTERM" | "SIGKILL") => void;
  sleep: (ms: number) => Promise<void>;
}

export const defaultProcessDeps: ProcessSignalDeps = {
  isAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
  kill: (pid, signal) => {
    try {
      process.kill(pid, signal);
    } catch {
      // already dead between the liveness check and the signal
    }
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Make sure a CLI child that was handed to client.stop() is really gone.
 *
 * Observed on long-running servers: client.stop() resolves ok while the
 * spawned `pi` process keeps living (the in-process kill silently misses),
 * leaving scheduler-lock-holding orphans behind. The child always responds
 * to a direct pid signal, so after the normal stop we verify death and
 * escalate SIGTERM -> SIGKILL against the recorded pid. Never throws.
 *
 * Returns true when the pid had to be reaped (was alive after client.stop()).
 */
export async function reapChildProcess(
  pid: number | undefined | null,
  deps: ProcessSignalDeps = defaultProcessDeps,
): Promise<boolean> {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) return false;
  if (!deps.isAlive(pid)) return false;

  log.warn("CLI child survived client.stop() — reaping by pid", { pid });
  try {
    deps.kill(pid, "SIGTERM");
  } catch {
    // deps may throw on dead pids — the liveness re-check below decides
  }
  await deps.sleep(500);
  if (!deps.isAlive(pid)) return true;

  try {
    deps.kill(pid, "SIGKILL");
  } catch {
    // same — treat as dead if the liveness check agrees
  }
  await deps.sleep(500);
  const dead = !deps.isAlive(pid);
  if (!dead) {
    log.error("CLI child still alive after SIGKILL reap — manual cleanup needed", { pid });
  }
  return true;
}

/**
 * Read the OS pid of a fork RpcClient child, when the client exposes its
 * process snapshot. Returns undefined when unsupported or already dead.
 */
export function readClientPid(client: unknown): number | undefined {
  const c = client as { getProcessSnapshot?: () => { pid?: number } } | null | undefined;
  if (!c || typeof c.getProcessSnapshot !== "function") return undefined;
  try {
    const pid = c.getProcessSnapshot().pid;
    return typeof pid === "number" && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}
