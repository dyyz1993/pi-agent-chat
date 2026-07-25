import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { GoalState, SupervisorStatus, TaskReport, TriggerRecord } from "../modules/supervisor";
import { getProcessManager } from "./agent";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";
import { forwardToChannel } from "./channel-helpers";
import { readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getSessionsRoot } from "../lib/pi-agent-paths";

const log = createLogger("supervisor");
const STATUS_TIMEOUT_MS = 2500;
const CHANNEL_TIMEOUT_MS = 5_000;
const REFINE_TIMEOUT_MS = 60_000;
const GOAL_RUNTIME_FILE = "supervisor-goal-runtime.json";
const TRIGGER_LOG_DIR = "supervisor-logs";

// sessionId → dataDir 缓存，避免每次请求都扫 7999 个 bucket
const sessionDataDirCache = new Map<string, string | null>();

function disabledStatus(): SupervisorStatus {
  return {
    enabled: false,
    state: "disabled",
    continueCount: 0,
    maxContinueCount: 0,
    activeGuards: [],
  };
}

async function getSupervisorStatus(
  pm: NonNullable<ReturnType<typeof getProcessManager>>,
  sessionId: string,
): Promise<SupervisorStatus> {
  try {
    const result: unknown = await withTimeout(
      pm.callChannel(sessionId, "supervisor", "getStatus", {}),
      STATUS_TIMEOUT_MS,
    );
    return result as SupervisorStatus;
  } catch (err: unknown) {
    log.warn("getStatus channel call failed, falling back to disk", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return await readPersistedStatus(sessionId);
  }
}

// ── 磁盘 fallback（进程不在线时从持久化文件恢复状态）──

/** 异步遍历 sessions bucket 查找 sessionId 对应的 supervisor 数据目录
 *  supervisor 扩展的 extName = basename(入口文件 index.ts) = "index"，
 *  所以实际 sessionDataDir = .../data/<sessionId>/index/
 *  结果缓存到 sessionDataDirCache，避免每次请求都扫全部 bucket */
async function findSessionDataDir(sessionId: string): Promise<string | null> {
  if (sessionDataDirCache.has(sessionId)) {
    return sessionDataDirCache.get(sessionId) ?? null;
  }
  const sessionsRoot = getSessionsRoot();
  let buckets: string[];
  try {
    buckets = await readdir(sessionsRoot);
  } catch {
    sessionDataDirCache.set(sessionId, null);
    return null;
  }
  for (const bucket of buckets) {
    const sessionDir = join(sessionsRoot, bucket, "data", sessionId);
    try {
      await stat(sessionDir);
    } catch {
      continue;
    }
    // supervisor 扩展的 extName = "index"，数据在 index/ 子目录下
    const indexDir = join(sessionDir, "index");
    try {
      await stat(indexDir);
      sessionDataDirCache.set(sessionId, indexDir);
      return indexDir;
    } catch {
      // index/ 不存在，fallback 到 sessionDir 本身
      sessionDataDirCache.set(sessionId, sessionDir);
      return sessionDir;
    }
  }
  sessionDataDirCache.set(sessionId, null);
  return null;
}

interface PersistedGoalRuntime {
  activeGoal?: GoalState;
  lastGoldResult?: SupervisorStatus["lastGoldResult"];
  enabled?: boolean;
}

async function readPersistedGoalRuntime(sessionId: string): Promise<PersistedGoalRuntime | null> {
  const dataDir = await findSessionDataDir(sessionId);
  if (!dataDir) return null;

  try {
    const content = await readFile(join(dataDir, GOAL_RUNTIME_FILE), "utf-8");
    return JSON.parse(content) as PersistedGoalRuntime;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return {};
    log.warn("readPersistedGoalRuntime failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

async function writePersistedGoalRuntime(
  sessionId: string,
  state: PersistedGoalRuntime,
): Promise<boolean> {
  const dataDir = await findSessionDataDir(sessionId);
  if (!dataDir) return false;

  const runtimePath = join(dataDir, GOAL_RUNTIME_FILE);
  if (!state.activeGoal && !state.lastGoldResult && state.enabled !== true) {
    try {
      await unlink(runtimePath);
      return true;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return true;
      log.warn("delete persisted supervisor goal failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return false;
    }
  }

  try {
    await writeFile(runtimePath, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
    return true;
  } catch (err) {
    log.warn("writePersistedGoalRuntime failed", {
      sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

async function setPersistedEnabled(sessionId: string, enabled: boolean): Promise<boolean> {
  const existing = await readPersistedGoalRuntime(sessionId);
  if (existing === null) return false;
  return writePersistedGoalRuntime(sessionId, { ...existing, enabled });
}

async function clearPersistedGoal(sessionId: string): Promise<boolean> {
  const existing = await readPersistedGoalRuntime(sessionId);
  if (existing === null) return false;
  return writePersistedGoalRuntime(sessionId, {
    ...existing,
    activeGoal: undefined,
    lastGoldResult: undefined,
    enabled: false,
  });
}

/** 读 supervisor-goal-runtime.json 构造静态状态（进程不在线时使用） */
async function readPersistedStatus(sessionId: string): Promise<SupervisorStatus> {
  const parsed = await readPersistedGoalRuntime(sessionId);
  if (!parsed?.activeGoal && !parsed?.enabled) return disabledStatus();

  return {
    enabled: parsed.enabled === true,
    state: "idle",
    continueCount: parsed.activeGoal?.continuationCount ?? 0,
    maxContinueCount: 0,
    activeGuards: [],
    goal: parsed.activeGoal,
    lastGoldResult: parsed.lastGoldResult,
  };
}

/** 读 supervisor-logs/trigger-*.json 构造 trigger 历史（进程不在线时使用） */
async function readTriggerHistoryFromDisk(sessionId: string, limit: number): Promise<TriggerRecord[]> {
  const dataDir = await findSessionDataDir(sessionId);
  if (!dataDir) return [];

  const triggerDir = join(dataDir, TRIGGER_LOG_DIR);
  let files: string[];
  try {
    files = (await readdir(triggerDir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const records: TriggerRecord[] = [];
  for (const file of files) {
    try {
      const content = await readFile(join(triggerDir, file), "utf-8");
      const record = JSON.parse(content) as TriggerRecord;
      if (typeof record.seq === "number") records.push(record);
    } catch {
      // skip bad files
    }
  }

  records.sort((a, b) => a.seq - b.seq);
  return records.slice(-limit);
}

function makeGoal(
  objective: string,
  status: GoalState["status"],
  blockers: GoalState["blockers"] = [],
): GoalState {
  return {
    id: "",
    objective,
    status,
    startedAt: Date.now(),
    updatedAt: Date.now(),
    continuationCount: 0,
    blockers,
  };
}

function blockedGoal(objective: string, summary: string): { goal: GoalState } {
  return {
    goal: makeGoal(objective, "blocked", [{ kind: "runtime", summary }]),
  };
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("supervisor.getStatus", async (params): Promise<SupervisorStatus> => {
    const { sessionId } = params as { sessionId: string };
    const pm = getProcessManager();
    if (!pm) return disabledStatus();
    return getSupervisorStatus(pm, sessionId);
  });

  r(
    "supervisor.requestPause",
    async (params): Promise<{ scheduled: boolean; scheduledAt?: number }> => {
      const { sessionId, delayMs, reason } = params as {
        sessionId: string;
        delayMs?: number;
        reason?: string;
      };
      const result = await forwardToChannel<{ scheduled: boolean; scheduledAt?: number }>(
        { sessionId },
        "supervisor",
        "requestPause",
        { delayMs, reason },
        CHANNEL_TIMEOUT_MS,
        { skipHasSessionCheck: true },
      );
      if (!result) log.warn("supervisor.requestPause channel call failed", { sessionId });
      return result ?? { scheduled: false };
    },
  );

  r("supervisor.cancelPause", async (params): Promise<{ cancelled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ cancelled: boolean }>(
      { sessionId },
      "supervisor",
      "cancelPause",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("supervisor.cancelPause channel call failed", { sessionId });
    return result ?? { cancelled: false };
  });

  r("supervisor.forceContinue", async (params): Promise<{ triggered: boolean }> => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const result = await forwardToChannel<{ triggered: boolean }>(
      { sessionId },
      "supervisor",
      "forceContinue",
      { reason },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("supervisor.forceContinue channel call failed", { sessionId });
    return result ?? { triggered: false };
  });

  r("supervisor.disable", async (params): Promise<{ disabled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ disabled: boolean }>(
      { sessionId },
      "supervisor",
      "disable",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (result) return result;
    log.warn("supervisor.disable channel call failed, updating persisted status", { sessionId });
    return { disabled: await setPersistedEnabled(sessionId, false) };
  });

  r("supervisor.enable", async (params): Promise<{ enabled: boolean }> => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ enabled: boolean }>(
      { sessionId },
      "supervisor",
      "enable",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (result) return result;
    log.warn("supervisor.enable channel call failed, updating persisted status", { sessionId });
    return { enabled: await setPersistedEnabled(sessionId, true) };
  });

  r("supervisor.getTaskReport", async (params): Promise<{ tasks: TaskReport[] }> => {
    const { sessionId } = params as { sessionId: string };
    const result = await forwardToChannel<{ tasks: TaskReport[] }>(
      { sessionId },
      "supervisor",
      "getTaskReport",
      {},
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (!result) log.warn("supervisor.getTaskReport channel call failed", { sessionId });
    return result ?? { tasks: [] };
  });

  r(
    "supervisor.checkToolStatus",
    async (params): Promise<{ reachable: boolean; status?: string; error?: string }> => {
      const { sessionId, toolName, channelName, method } = params as {
        sessionId: string;
        toolName: string;
        channelName?: string;
        method?: string;
      };
      const result = await forwardToChannel<{
        reachable: boolean;
        status?: string;
        error?: string;
      }>(
        { sessionId },
        "supervisor",
        "checkToolStatus",
        { toolName, channelName, method },
        CHANNEL_TIMEOUT_MS,
        { skipHasSessionCheck: true },
      );
      if (!result) {
        log.warn("supervisor.checkToolStatus channel call failed", { sessionId });
      }
      return result ?? { reachable: false, error: "Channel call failed" };
    },
  );

  r("supervisor.setGoal", async (params): Promise<{ goal: GoalState }> => {
    const { sessionId, objective } = params as { sessionId: string; objective: string };
    const pm = getProcessManager();
    if (!pm) {
      return blockedGoal(objective, "Agent process manager unavailable");
    }
    const result = await forwardToChannel<{ goal: GoalState }>(
      { sessionId },
      "supervisor",
      "setGoal",
      { objective },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (result) return result;
    log.warn("supervisor.setGoal channel call failed, persisting running goal", { sessionId });
    const goal = makeGoal(objective, "running");
    const persisted = await writePersistedGoalRuntime(sessionId, {
      activeGoal: goal,
      enabled: true,
    });
    return persisted ? { goal } : blockedGoal(objective, "Channel call failed");
  });

  r("supervisor.clearGoal", async (params): Promise<{ cleared: boolean }> => {
    const { sessionId, reason } = params as { sessionId: string; reason?: string };
    const result = await forwardToChannel<{ cleared: boolean }>(
      { sessionId },
      "supervisor",
      "clearGoal",
      { reason },
      CHANNEL_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (result) return result;
    log.warn("supervisor.clearGoal channel call failed, clearing persisted goal", { sessionId });
    return { cleared: await clearPersistedGoal(sessionId) };
  });

  r(
    "supervisor.refineGoal",
    async (params): Promise<{ success: boolean; objective?: string; error?: string }> => {
      const { sessionId, objective } = params as {
        sessionId: string;
        objective: string;
      };
      const pm = getProcessManager();
      if (!pm) return { success: false, error: "Agent process manager unavailable" };
      try {
        const result = (await withTimeout(
          pm.callChannel(sessionId, "supervisor", "refineGoal", {
            objective,
          }),
          REFINE_TIMEOUT_MS,
        )) as { success: boolean; objective?: string; error?: string };
        return result;
      } catch (err) {
        log.warn("supervisor.refineGoal channel call failed", {
          sessionId,
          err: err instanceof Error ? err.message : String(err),
        });
        return {
          success: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );

  r("supervisor.getTriggerHistory", async (params): Promise<{ triggers: TriggerRecord[] }> => {
    const { sessionId, limit } = params as { sessionId: string; limit?: number };
    const result = await forwardToChannel<{ triggers: TriggerRecord[] }>(
      { sessionId },
      "supervisor",
      "getTriggerHistory",
      { limit: limit ?? 50 },
      STATUS_TIMEOUT_MS,
      { skipHasSessionCheck: true },
    );
    if (result) return result;
    log.warn("supervisor.getTriggerHistory channel call failed, falling back to disk", {
      sessionId,
    });
    return { triggers: await readTriggerHistoryFromDisk(sessionId, limit ?? 50) };
  });
}
