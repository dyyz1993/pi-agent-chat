import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type { UsageRangePreset, UsageScope, UsageShareStats } from "../modules/usage";
import { normalizeProjectPath } from "../lib/pi-agent-paths";
import {
  buildUsageStatsFromIndex,
  readUsageSnapshot,
  refreshUsageIndex,
  writeUsageSnapshot,
  type UsageIndexRefreshResult,
} from "../lib/usage-index";
import { createLogger } from "../lib/logger";

const log = createLogger("usage");
const refreshInFlight = new Map<string, Promise<UsageShareStats>>();
const indexRefreshInFlight = new Map<string, Promise<UsageIndexRefreshResult>>();

function refreshKey(scope: UsageScope, projectPath: string, range: UsageRangePreset): string {
  return `${scope}::${projectPath}::${range}`;
}

function indexRefreshKey(scope: UsageScope, projectPath: string): string {
  return `${scope}::${projectPath}`;
}

async function getRefreshedIndex(
  scope: UsageScope,
  projectPath: string,
): Promise<UsageIndexRefreshResult> {
  const key = indexRefreshKey(scope, projectPath);
  const existing = indexRefreshInFlight.get(key);
  if (existing) return existing;

  const promise = refreshUsageIndex(scope, projectPath);
  indexRefreshInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    indexRefreshInFlight.delete(key);
  }
}

async function refreshStats(
  scope: UsageScope,
  projectPath: string,
  range: UsageRangePreset,
): Promise<UsageShareStats> {
  const key = refreshKey(scope, projectPath, range);
  const existing = refreshInFlight.get(key);
  if (existing) return existing;

  const promise = (async () => {
    const { index, scannedSessionFiles } = await getRefreshedIndex(scope, projectPath);
    const stats = buildUsageStatsFromIndex(index, {
      projectPath,
      scope,
      range,
      scannedSessionFiles,
    });
    const lastCacheWriteAt = await writeUsageSnapshot({
      ...stats,
      dataQuality: { ...stats.dataQuality, cacheStatus: "refresh" },
    });
    return {
      ...stats,
      dataQuality: {
        ...stats.dataQuality,
        cacheStatus: "refresh",
        lastCacheWriteAt,
      },
    };
  })();

  refreshInFlight.set(key, promise);
  try {
    return await promise;
  } catch (err) {
    log.warn("usage refresh failed", { scope, projectPath, range, error: String(err) });
    throw err;
  } finally {
    refreshInFlight.delete(key);
  }
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("usage.getShareStats", async (params) => {
    const scope = params.scope ?? (params.projectPath ? "project" : "global");
    const projectPath = params.projectPath ? normalizeProjectPath(params.projectPath) : "";
    const range = params.range ?? "30d";
    const mode = params.mode ?? "refresh";

    if (mode === "cache") {
      const cached = await readUsageSnapshot(scope, projectPath, range);
      if (cached) return cached;
      return null;
    }

    return refreshStats(scope, projectPath, range);
  });
}
