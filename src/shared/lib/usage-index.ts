import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UsageRangePreset, UsageScope, UsageShareStats } from "../modules/usage";
import {
  addUsageFactToDailyRollup,
  aggregateUsageDailyRollups,
  createUsageDailyRollup,
  localDateKey,
  usageFactFromEntry,
  type AggregateOptions,
  type UsageDailyRollup,
  type UsageSourceEntry,
} from "./usage-aggregator";
import {
  getPiAgentDir,
  getProjectSessionDir,
  getProjectUserStateDir,
  getSessionsRoot,
} from "./pi-agent-paths";
import { createLogger } from "./logger";

const log = createLogger("usage-index");
const USAGE_INDEX_VERSION = 3;

interface UsageIndexedFile {
  sessionId: string;
  path: string;
  size: number;
  mtimeMs: number;
  parsedEntries: number;
  skippedEntries: number;
  days: Record<string, UsageDailyRollup>;
}

interface UsageIndexFile {
  schemaVersion: number;
  scope: UsageScope;
  projectPath: string;
  createdAt: number;
  updatedAt: number;
  files: Record<string, UsageIndexedFile>;
}

interface SessionFileRef {
  sessionId: string;
  path: string;
  size: number;
  mtimeMs: number;
}

export interface UsageIndexRefreshResult {
  index: UsageIndexFile;
  changedFiles: number;
  scannedSessionFiles: number;
}

export function getUsageStorageDir(scope: UsageScope, projectPath: string): string {
  return scope === "global"
    ? join(getPiAgentDir(), "usage")
    : join(getProjectUserStateDir(projectPath), "usage");
}

function getIndexPath(scope: UsageScope, projectPath: string): string {
  return join(getUsageStorageDir(scope, projectPath), "index.json");
}

function getSnapshotPath(scope: UsageScope, projectPath: string, range: UsageRangePreset): string {
  return join(getUsageStorageDir(scope, projectPath), `latest-share-stats-${range}.json`);
}

function getLegacySnapshotPath(scope: UsageScope, projectPath: string): string {
  return join(getUsageStorageDir(scope, projectPath), "latest-share-stats.json");
}

function emptyIndex(scope: UsageScope, projectPath: string): UsageIndexFile {
  const now = Date.now();
  return {
    schemaVersion: USAGE_INDEX_VERSION,
    scope,
    projectPath,
    createdAt: now,
    updatedAt: now,
    files: {},
  };
}

function isUsageIndex(value: unknown): value is UsageIndexFile {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    (value as UsageIndexFile).schemaVersion === USAGE_INDEX_VERSION &&
    typeof (value as UsageIndexFile).files === "object"
  );
}

async function readUsageIndex(scope: UsageScope, projectPath: string): Promise<UsageIndexFile> {
  const path = getIndexPath(scope, projectPath);
  if (!existsSync(path)) return emptyIndex(scope, projectPath);
  try {
    const parsed = JSON.parse(await readFile(path, "utf-8")) as unknown;
    if (isUsageIndex(parsed)) return parsed;
  } catch (err) {
    log.warn("failed to read usage index, rebuilding", { path, error: String(err) });
  }
  return emptyIndex(scope, projectPath);
}

async function writeUsageIndex(index: UsageIndexFile): Promise<void> {
  const dir = getUsageStorageDir(index.scope, index.projectPath);
  await mkdir(dir, { recursive: true });
  await writeFile(getIndexPath(index.scope, index.projectPath), JSON.stringify(index));
}

async function collectSessionFilesInDir(sessionDir: string): Promise<SessionFileRef[]> {
  if (!existsSync(sessionDir)) return [];
  const files = (await readdir(sessionDir)).filter((name) => name.endsWith(".jsonl")).sort();
  const refs: SessionFileRef[] = [];
  for (const filename of files) {
    const path = join(sessionDir, filename);
    try {
      const fileStat = await stat(path);
      refs.push({
        sessionId: filename.replace(/\.jsonl$/, ""),
        path,
        size: fileStat.size,
        mtimeMs: fileStat.mtimeMs,
      });
    } catch (err) {
      log.warn("failed to stat usage session file", { path, error: String(err) });
    }
  }
  return refs;
}

async function collectSessionFiles(
  scope: UsageScope,
  projectPath: string,
): Promise<SessionFileRef[]> {
  if (scope === "project") return collectSessionFilesInDir(getProjectSessionDir(projectPath));

  const sessionsRoot = getSessionsRoot();
  if (!existsSync(sessionsRoot)) return [];
  const buckets = await readdir(sessionsRoot, { withFileTypes: true });
  const refs: SessionFileRef[] = [];
  for (const bucket of buckets) {
    if (!bucket.isDirectory()) continue;
    refs.push(...(await collectSessionFilesInDir(join(sessionsRoot, bucket.name))));
  }
  return refs;
}

async function extractRollupsFromSessionFile(ref: SessionFileRef): Promise<UsageIndexedFile> {
  const days: Record<string, UsageDailyRollup> = {};
  let skippedEntries = 0;
  let parsedEntries = 0;

  let content = "";
  try {
    content = await readFile(ref.path, "utf-8");
  } catch (err) {
    log.warn("failed to read usage session file", { path: ref.path, error: String(err) });
    return { ...ref, parsedEntries: 0, skippedEntries: 1, days: {} };
  }

  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let value: unknown;
    try {
      value = JSON.parse(trimmed);
    } catch {
      skippedEntries += 1;
      continue;
    }

    const fact = usageFactFromEntry({ sessionId: ref.sessionId, value } satisfies UsageSourceEntry);
    if (!fact) continue;
    parsedEntries += 1;
    const date = localDateKey(fact.timestamp);
    const rollup = days[date] ?? createUsageDailyRollup(ref.sessionId, fact.timestamp);
    addUsageFactToDailyRollup(rollup, fact);
    days[date] = rollup;
  }

  return { ...ref, parsedEntries, skippedEntries, days };
}

export async function refreshUsageIndex(
  scope: UsageScope,
  projectPath: string,
): Promise<UsageIndexRefreshResult> {
  const index = await readUsageIndex(scope, projectPath);
  const refs = await collectSessionFiles(scope, projectPath);
  const livePaths = new Set(refs.map((ref) => ref.path));
  let changedFiles = 0;

  for (const existingPath of Object.keys(index.files)) {
    if (!livePaths.has(existingPath)) {
      delete index.files[existingPath];
      changedFiles += 1;
    }
  }

  for (const ref of refs) {
    const existing = index.files[ref.path];
    if (existing && existing.size === ref.size && existing.mtimeMs === ref.mtimeMs) continue;
    index.files[ref.path] = await extractRollupsFromSessionFile(ref);
    changedFiles += 1;
  }

  index.updatedAt = Date.now();
  await writeUsageIndex(index);
  return { index, changedFiles, scannedSessionFiles: refs.length };
}

function rollupsFromIndex(index: UsageIndexFile): UsageDailyRollup[] {
  return Object.values(index.files).flatMap((file) => Object.values(file.days));
}

function dataQualityFromIndex(
  index: UsageIndexFile,
  patch?: Pick<AggregateOptions, "scannedSessionFiles" | "skippedEntries">,
): Partial<AggregateOptions> {
  const files = Object.values(index.files);
  const scannedSessionFiles = patch?.scannedSessionFiles ?? files.length;
  const skippedEntries =
    patch?.skippedEntries ?? files.reduce((sum, file) => sum + file.skippedEntries, 0);
  return {
    scannedSessionFiles,
    skippedEntries,
  };
}

export function buildUsageStatsFromIndex(
  index: UsageIndexFile,
  options: Omit<AggregateOptions, "scannedSessionFiles" | "skippedEntries"> &
    Partial<Pick<AggregateOptions, "scannedSessionFiles" | "skippedEntries">>,
): UsageShareStats {
  const stats = aggregateUsageDailyRollups(rollupsFromIndex(index), {
    ...options,
    ...dataQualityFromIndex(index, {
      scannedSessionFiles: options.scannedSessionFiles,
      skippedEntries: options.skippedEntries,
    }),
  });
  return {
    ...stats,
    dataQuality: {
      ...stats.dataQuality,
      indexUpdatedAt: index.updatedAt,
    },
  };
}

export async function readUsageSnapshot(
  scope: UsageScope,
  projectPath: string,
  range: UsageRangePreset,
): Promise<UsageShareStats | null> {
  const paths = [
    getSnapshotPath(scope, projectPath, range),
    getLegacySnapshotPath(scope, projectPath),
  ];
  for (const path of paths) {
    if (!existsSync(path)) continue;
    try {
      const parsed = JSON.parse(await readFile(path, "utf-8")) as UsageShareStats;
      if (parsed?.range?.preset !== range) continue;
      return {
        ...parsed,
        dataQuality: {
          ...parsed.dataQuality,
          cacheStatus: "hit",
          indexReadAt: Date.now(),
        },
      };
    } catch (err) {
      log.warn("failed to read usage snapshot", { path, error: String(err) });
    }
  }
  return null;
}

export async function writeUsageSnapshot(stats: UsageShareStats): Promise<number | null> {
  const now = Date.now();
  const dir = getUsageStorageDir(stats.scope, stats.projectPath);
  try {
    await mkdir(dir, { recursive: true });
    const payload = JSON.stringify(
      {
        ...stats,
        dataQuality: {
          ...stats.dataQuality,
          lastCacheWriteAt: now,
        },
      },
      null,
      2,
    );
    await writeFile(getSnapshotPath(stats.scope, stats.projectPath, stats.range.preset), payload);
    await writeFile(getLegacySnapshotPath(stats.scope, stats.projectPath), payload);
    return now;
  } catch (err) {
    log.warn("failed to write usage snapshot", {
      scope: stats.scope,
      projectPath: stats.projectPath,
      error: String(err),
    });
    return null;
  }
}
