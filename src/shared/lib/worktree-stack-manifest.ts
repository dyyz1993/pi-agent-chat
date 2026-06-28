import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { basename, dirname, join } from "path";
import { PI_WORKTREE_REGISTRY_DIR, PI_WORKTREE_STATE_DIR } from "./app-paths";

export type WorktreeStackRepoRole = "app" | "runtime-fork";
export type WorktreeStackServiceRole = "api" | "web";
export type WorktreeIssueStatus = "planned" | "ready" | "in_progress" | "blocked" | "done";
export type WorktreeWorkerStatus = "idle" | "assigned" | "running" | "blocked" | "done";
export type WorktreeIssuePriority = "low" | "medium" | "high";
export type WorktreeBatchStatus = "planned" | "active" | "blocked" | "done";

export interface WorktreeStackRepoEntry {
  name: string;
  role: WorktreeStackRepoRole;
  repoPath: string;
  worktreePath: string;
  branch: string;
}

export interface WorktreeStackServiceEntry {
  name: string;
  role: WorktreeStackServiceRole;
  cwd: string;
  command: string;
  port: number;
  healthUrl: string;
}

export interface WorktreeStackIssueEntry {
  id: string;
  title: string;
  status: WorktreeIssueStatus;
  priority: WorktreeIssuePriority;
  repo?: "app" | "fork" | "both";
  batchId?: string | null;
  dependsOnIssueIds: string[];
  assigneeWorkerId?: string | null;
  branch?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeStackBatchEntry {
  id: string;
  title: string;
  status: WorktreeBatchStatus;
  issueIds: string[];
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeStackWorkerEntry {
  id: string;
  agent: string;
  status: WorktreeWorkerStatus;
  issueId?: string | null;
  sessionId?: string | null;
  repo?: "app" | "fork" | "both";
  branch?: string | null;
  worktreePath?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeStackCleanupPlan {
  removeWorktrees: boolean;
  removeRegistry: boolean;
}

export interface WorktreeStackOrchestration {
  leaderSessionId: string | null;
  batches: WorktreeStackBatchEntry[];
  issues: WorktreeStackIssueEntry[];
  workers: WorktreeStackWorkerEntry[];
  cleanup: WorktreeStackCleanupPlan;
}

export interface WorktreeStackRuntimeConfig {
  piCliPath: string;
}

export interface WorktreeStackManifest {
  version: 1;
  id: string;
  kind: "paired-worktree-stack";
  name: string;
  createdAt: string;
  updatedAt: string;
  repos: WorktreeStackRepoEntry[];
  services: WorktreeStackServiceEntry[];
  appConfigDir: string;
  agentDir: string;
  runtime: WorktreeStackRuntimeConfig;
  orchestration: WorktreeStackOrchestration;
}

export interface WorktreeStackIssuePatch {
  id: string;
  title?: string;
  status?: WorktreeIssueStatus;
  priority?: WorktreeIssuePriority;
  repo?: "app" | "fork" | "both";
  batchId?: string | null;
  dependsOnIssueIds?: string[];
  assigneeWorkerId?: string | null;
  branch?: string | null;
  note?: string | null;
}

export interface WorktreeStackBatchPatch {
  id: string;
  title?: string;
  status?: WorktreeBatchStatus;
  issueIds?: string[];
  note?: string | null;
}

export interface WorktreeStackWorkerPatch {
  id: string;
  agent?: string;
  status?: WorktreeWorkerStatus;
  issueId?: string | null;
  sessionId?: string | null;
  repo?: "app" | "fork" | "both";
  branch?: string | null;
  worktreePath?: string | null;
  note?: string | null;
}

export interface UpdateWorktreeStackOrchestrationInput {
  leaderSessionId?: string | null;
  cleanup?: Partial<WorktreeStackCleanupPlan>;
  upsertBatches?: WorktreeStackBatchPatch[];
  removeBatchIds?: string[];
  upsertIssues?: WorktreeStackIssuePatch[];
  removeIssueIds?: string[];
  upsertWorkers?: WorktreeStackWorkerPatch[];
  removeWorkerIds?: string[];
}

export interface WorktreeStackManifestResult {
  manifestPath: string;
  manifest: WorktreeStackManifest | null;
}

export interface WorktreeStackExecutionContext {
  manifestPath: string;
  manifest: WorktreeStackManifest;
  appRepo: WorktreeStackRepoEntry | null;
  runtimeForkRepo: WorktreeStackRepoEntry | null;
  apiService: WorktreeStackServiceEntry | null;
  webService: WorktreeStackServiceEntry | null;
  batch: WorktreeStackBatchEntry | null;
  issue: WorktreeStackIssueEntry | null;
  worker: WorktreeStackWorkerEntry | null;
  targetRepoRoles: WorktreeStackRepoRole[];
  targetAppWorktreePath: string | null;
  targetRuntimeForkWorktreePath: string | null;
}

const ISSUE_STATUS_TRANSITIONS: Record<WorktreeIssueStatus, WorktreeIssueStatus[]> = {
  planned: ["ready", "blocked"],
  ready: ["planned", "in_progress", "blocked", "done"],
  in_progress: ["ready", "blocked", "done"],
  blocked: ["ready", "in_progress"],
  done: ["ready", "in_progress"],
};

const WORKER_STATUS_TRANSITIONS: Record<WorktreeWorkerStatus, WorktreeWorkerStatus[]> = {
  idle: ["assigned", "running"],
  assigned: ["idle", "running", "blocked", "done"],
  running: ["idle", "assigned", "blocked", "done"],
  blocked: ["idle", "assigned", "running"],
  done: ["idle", "assigned", "running"],
};

const BATCH_STATUS_TRANSITIONS: Record<WorktreeBatchStatus, WorktreeBatchStatus[]> = {
  planned: ["active", "blocked"],
  active: ["planned", "blocked", "done"],
  blocked: ["planned", "active"],
  done: ["active"],
};

function sanitizeSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]+/g, "_");
}

export function getWorktreeStackId(projectPath: string): string {
  const name = sanitizeSegment(basename(projectPath));
  const hash = createHash("sha1").update(projectPath).digest("hex").slice(0, 12);
  return `${name}-${hash}`;
}

function registryFilePath(stackId: string): string {
  return join(PI_WORKTREE_REGISTRY_DIR, `${stackId}.env`);
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const index = line.indexOf("=");
    if (index <= 0) continue;
    result[line.slice(0, index)] = line.slice(index + 1);
  }
  return result;
}

async function resolveManifestPath(projectPath: string): Promise<string> {
  const stackId = getWorktreeStackId(projectPath);
  const directPath = join(PI_WORKTREE_STATE_DIR, stackId, "manifest.json");
  if (existsSync(directPath)) return directPath;

  const registryPath = registryFilePath(stackId);
  if (!existsSync(registryPath)) return directPath;

  try {
    const env = parseEnvFile(await readFile(registryPath, "utf8"));
    if (env.CONFIG_DIR) return join(env.CONFIG_DIR, "manifest.json");
  } catch {
    return directPath;
  }

  return directPath;
}

function normalizeIssueEntry(
  raw: Partial<WorktreeStackIssueEntry>,
  now: string,
): WorktreeStackIssueEntry {
  return {
    id: raw.id ?? "",
    title: raw.title ?? raw.id ?? "",
    status: raw.status ?? "planned",
    priority: raw.priority ?? "medium",
    repo: raw.repo,
    batchId: raw.batchId ?? null,
    dependsOnIssueIds: [...(raw.dependsOnIssueIds ?? [])],
    assigneeWorkerId: raw.assigneeWorkerId ?? null,
    branch: raw.branch ?? null,
    note: raw.note ?? null,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? now,
  };
}

function normalizeBatchEntry(
  raw: Partial<WorktreeStackBatchEntry>,
  now: string,
): WorktreeStackBatchEntry {
  return {
    id: raw.id ?? "",
    title: raw.title ?? raw.id ?? "",
    status: raw.status ?? "planned",
    issueIds: [...(raw.issueIds ?? [])],
    note: raw.note ?? null,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? now,
  };
}

function normalizeWorkerEntry(
  raw: Partial<WorktreeStackWorkerEntry>,
  now: string,
): WorktreeStackWorkerEntry {
  return {
    id: raw.id ?? "",
    agent: raw.agent ?? "pi-worktree-dev",
    status: raw.status ?? "idle",
    issueId: raw.issueId ?? null,
    sessionId: raw.sessionId ?? null,
    repo: raw.repo,
    branch: raw.branch ?? null,
    worktreePath: raw.worktreePath ?? null,
    note: raw.note ?? null,
    createdAt: raw.createdAt ?? now,
    updatedAt: raw.updatedAt ?? raw.createdAt ?? now,
  };
}

function normalizeManifest(raw: WorktreeStackManifest): WorktreeStackManifest {
  const now = new Date().toISOString();
  return {
    ...raw,
    version: 1,
    kind: "paired-worktree-stack",
    runtime: {
      piCliPath: raw.runtime?.piCliPath ?? "",
    },
    orchestration: {
      leaderSessionId: raw.orchestration?.leaderSessionId ?? null,
      batches: Array.isArray(raw.orchestration?.batches)
        ? raw.orchestration.batches
            .map((batch) => normalizeBatchEntry(batch, now))
            .filter((batch) => batch.id)
        : [],
      issues: Array.isArray(raw.orchestration?.issues)
        ? raw.orchestration.issues
            .map((issue) => normalizeIssueEntry(issue, now))
            .filter((issue) => issue.id)
        : [],
      workers: Array.isArray(raw.orchestration?.workers)
        ? raw.orchestration.workers
            .map((worker) => normalizeWorkerEntry(worker, now))
            .filter((worker) => worker.id)
        : [],
      cleanup: {
        removeWorktrees: raw.orchestration?.cleanup?.removeWorktrees ?? false,
        removeRegistry: raw.orchestration?.cleanup?.removeRegistry ?? false,
      },
    },
  };
}

export async function readWorktreeStackManifest(
  projectPath: string,
): Promise<WorktreeStackManifestResult> {
  const manifestPath = await resolveManifestPath(projectPath);
  if (!existsSync(manifestPath)) {
    return { manifestPath, manifest: null };
  }
  const parsed = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as unknown as WorktreeStackManifest;
  const manifest = normalizeManifest(parsed);
  return { manifestPath, manifest };
}

function assertTransition<T extends string>(
  kind: "issue" | "worker" | "batch",
  id: string,
  from: T,
  to: T,
  allowed: Record<T, T[]>,
): void {
  if (from === to) return;
  if (!allowed[from]?.includes(to)) {
    throw new Error(`Invalid ${kind} status transition for ${id}: ${from} -> ${to}`);
  }
}

function mergeIssueEntry(
  existing: WorktreeStackIssueEntry | undefined,
  patch: WorktreeStackIssuePatch,
  now: string,
): WorktreeStackIssueEntry {
  const nextStatus = patch.status ?? existing?.status ?? "planned";
  if (existing?.status) {
    assertTransition("issue", patch.id, existing.status, nextStatus, ISSUE_STATUS_TRANSITIONS);
  }
  return {
    ...normalizeIssueEntry(existing ?? { id: patch.id, title: patch.title ?? patch.id }, now),
    ...patch,
    id: patch.id,
    title: patch.title ?? existing?.title ?? patch.id,
    priority: patch.priority ?? existing?.priority ?? "medium",
    batchId: patch.batchId ?? existing?.batchId ?? null,
    dependsOnIssueIds: [...(patch.dependsOnIssueIds ?? existing?.dependsOnIssueIds ?? [])],
    status: nextStatus,
    updatedAt: now,
  };
}

function mergeBatchEntry(
  existing: WorktreeStackBatchEntry | undefined,
  patch: WorktreeStackBatchPatch,
  now: string,
): WorktreeStackBatchEntry {
  const nextStatus = patch.status ?? existing?.status ?? "planned";
  if (existing?.status) {
    assertTransition("batch", patch.id, existing.status, nextStatus, BATCH_STATUS_TRANSITIONS);
  }
  return {
    ...normalizeBatchEntry(existing ?? { id: patch.id, title: patch.title ?? patch.id }, now),
    ...patch,
    id: patch.id,
    title: patch.title ?? existing?.title ?? patch.id,
    status: nextStatus,
    issueIds: [...(patch.issueIds ?? existing?.issueIds ?? [])],
    updatedAt: now,
  };
}

function mergeWorkerEntry(
  existing: WorktreeStackWorkerEntry | undefined,
  patch: WorktreeStackWorkerPatch,
  now: string,
): WorktreeStackWorkerEntry {
  const nextStatus = patch.status ?? existing?.status ?? "idle";
  if (existing?.status) {
    assertTransition("worker", patch.id, existing.status, nextStatus, WORKER_STATUS_TRANSITIONS);
  }
  return {
    ...normalizeWorkerEntry(
      existing ?? { id: patch.id, agent: patch.agent ?? "pi-worktree-dev" },
      now,
    ),
    ...patch,
    id: patch.id,
    agent: patch.agent ?? existing?.agent ?? "pi-worktree-dev",
    status: nextStatus,
    updatedAt: now,
  };
}

function reconcileIssueWorkerState(
  batches: Map<string, WorktreeStackBatchEntry>,
  issues: Map<string, WorktreeStackIssueEntry>,
  workers: Map<string, WorktreeStackWorkerEntry>,
): void {
  for (const batch of batches.values()) {
    for (const issueId of batch.issueIds) {
      if (!issues.has(issueId)) {
        throw new Error(`Batch ${batch.id} references missing issue ${issueId}`);
      }
    }
  }

  for (const issue of issues.values()) {
    if (issue.dependsOnIssueIds.includes(issue.id)) {
      throw new Error(`Issue ${issue.id} cannot depend on itself`);
    }
    if (issue.batchId && !batches.has(issue.batchId)) {
      throw new Error(`Issue ${issue.id} references missing batch ${issue.batchId}`);
    }
    for (const dependencyId of issue.dependsOnIssueIds) {
      if (!issues.has(dependencyId)) {
        throw new Error(`Issue ${issue.id} depends on missing issue ${dependencyId}`);
      }
    }
    if (issue.assigneeWorkerId) {
      const worker = workers.get(issue.assigneeWorkerId);
      if (!worker) {
        throw new Error(`Issue ${issue.id} references missing worker ${issue.assigneeWorkerId}`);
      }
      if (worker.issueId !== issue.id) {
        worker.issueId = issue.id;
      }
      if (issue.repo && !worker.repo) {
        worker.repo = issue.repo;
      }
      if (worker.status === "idle") {
        worker.status = issue.status === "in_progress" ? "running" : "assigned";
      }
      if (issue.status === "planned") {
        issue.status = worker.status === "running" ? "in_progress" : "ready";
      }
    }
  }

  for (const worker of workers.values()) {
    if (!worker.issueId) {
      if (worker.status !== "idle" && worker.status !== "done") {
        worker.status = "idle";
      }
      continue;
    }
    const issue = issues.get(worker.issueId);
    if (!issue) {
      throw new Error(`Worker ${worker.id} references missing issue ${worker.issueId}`);
    }
    if (!issue.assigneeWorkerId) {
      issue.assigneeWorkerId = worker.id;
    } else if (issue.assigneeWorkerId !== worker.id) {
      throw new Error(
        `Worker ${worker.id} references issue ${worker.issueId} owned by ${issue.assigneeWorkerId}`,
      );
    }
    if (issue.repo && !worker.repo) {
      worker.repo = issue.repo;
    }
    worker.worktreePath ??= null;
    if (worker.status === "running" && issue.status !== "in_progress") {
      issue.status = "in_progress";
    }
    if (worker.status === "assigned" && issue.status === "planned") {
      issue.status = "ready";
    }
    if (worker.status === "done" && issue.status === "in_progress") {
      issue.status = "done";
    }
    if (worker.status === "blocked" && issue.status === "planned") {
      issue.status = "blocked";
    }
  }

  for (const batch of batches.values()) {
    const batchIssues = batch.issueIds
      .map((issueId) => issues.get(issueId))
      .filter((issue): issue is WorktreeStackIssueEntry => Boolean(issue));
    if (batchIssues.length === 0) continue;
    if (batchIssues.some((issue) => issue.status === "in_progress")) {
      batch.status = "active";
      continue;
    }
    if (batchIssues.some((issue) => issue.status === "blocked")) {
      batch.status = "blocked";
      continue;
    }
    if (batchIssues.every((issue) => issue.status === "done")) {
      batch.status = "done";
      continue;
    }
    if (batchIssues.some((issue) => issue.status === "ready")) {
      batch.status = "active";
    }
  }
}

export async function updateWorktreeStackOrchestration(
  projectPath: string,
  input: UpdateWorktreeStackOrchestrationInput,
): Promise<WorktreeStackManifestResult> {
  const { manifestPath, manifest } = await readWorktreeStackManifest(projectPath);
  if (!manifest) {
    throw new Error(`Worktree stack manifest not found for ${projectPath}`);
  }

  const now = new Date().toISOString();
  const batches = new Map(manifest.orchestration.batches.map((batch) => [batch.id, batch]));
  const issues = new Map(manifest.orchestration.issues.map((issue) => [issue.id, issue]));
  const workers = new Map(manifest.orchestration.workers.map((worker) => [worker.id, worker]));

  for (const batchPatch of input.upsertBatches ?? []) {
    batches.set(batchPatch.id, mergeBatchEntry(batches.get(batchPatch.id), batchPatch, now));
  }
  for (const batchId of input.removeBatchIds ?? []) {
    batches.delete(batchId);
  }

  for (const issuePatch of input.upsertIssues ?? []) {
    issues.set(issuePatch.id, mergeIssueEntry(issues.get(issuePatch.id), issuePatch, now));
  }
  for (const issueId of input.removeIssueIds ?? []) {
    issues.delete(issueId);
  }

  for (const workerPatch of input.upsertWorkers ?? []) {
    workers.set(workerPatch.id, mergeWorkerEntry(workers.get(workerPatch.id), workerPatch, now));
  }
  for (const workerId of input.removeWorkerIds ?? []) {
    workers.delete(workerId);
  }

  const nextManifest: WorktreeStackManifest = normalizeManifest({
    ...manifest,
    updatedAt: now,
    orchestration: {
      leaderSessionId:
        input.leaderSessionId !== undefined
          ? input.leaderSessionId
          : manifest.orchestration.leaderSessionId,
      batches: Array.from(batches.values()),
      issues: Array.from(issues.values()),
      workers: Array.from(workers.values()),
      cleanup: {
        ...manifest.orchestration.cleanup,
        ...(input.cleanup ?? {}),
      },
    },
  });

  reconcileIssueWorkerState(
    new Map(nextManifest.orchestration.batches.map((batch) => [batch.id, batch])),
    new Map(nextManifest.orchestration.issues.map((issue) => [issue.id, issue])),
    new Map(nextManifest.orchestration.workers.map((worker) => [worker.id, worker])),
  );

  nextManifest.orchestration.batches = Array.from(
    new Map(nextManifest.orchestration.batches.map((batch) => [batch.id, batch])).values(),
  );
  nextManifest.orchestration.issues = Array.from(
    new Map(nextManifest.orchestration.issues.map((issue) => [issue.id, issue])).values(),
  );
  nextManifest.orchestration.workers = Array.from(
    new Map(nextManifest.orchestration.workers.map((worker) => [worker.id, worker])).values(),
  );

  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(nextManifest, null, 2)}\n`, "utf8");
  return { manifestPath, manifest: nextManifest };
}

export async function getWorktreeStackExecutionContext(input: {
  projectPath: string;
  issueId?: string;
  workerId?: string;
}): Promise<WorktreeStackExecutionContext> {
  const { manifestPath, manifest } = await readWorktreeStackManifest(input.projectPath);
  if (!manifest) {
    throw new Error(`Worktree stack manifest not found for ${input.projectPath}`);
  }

  const appRepo = manifest.repos.find((repo) => repo.role === "app") ?? null;
  const runtimeForkRepo = manifest.repos.find((repo) => repo.role === "runtime-fork") ?? null;
  const apiService = manifest.services.find((service) => service.role === "api") ?? null;
  const webService = manifest.services.find((service) => service.role === "web") ?? null;

  const issue = input.issueId
    ? (manifest.orchestration.issues.find((entry) => entry.id === input.issueId) ?? null)
    : null;
  const workerFromId = input.workerId
    ? (manifest.orchestration.workers.find((entry) => entry.id === input.workerId) ?? null)
    : null;
  const worker =
    workerFromId ??
    (issue?.assigneeWorkerId
      ? (manifest.orchestration.workers.find((entry) => entry.id === issue.assigneeWorkerId) ??
        null)
      : null);

  const resolvedIssue =
    issue ??
    (worker?.issueId
      ? (manifest.orchestration.issues.find((entry) => entry.id === worker.issueId) ?? null)
      : null);
  const batch = resolvedIssue?.batchId
    ? (manifest.orchestration.batches.find((entry) => entry.id === resolvedIssue.batchId) ?? null)
    : null;

  if (input.issueId && !resolvedIssue) {
    throw new Error(`Issue ${input.issueId} not found in worktree stack manifest`);
  }
  if (input.workerId && !worker) {
    throw new Error(`Worker ${input.workerId} not found in worktree stack manifest`);
  }
  if (input.issueId && worker && worker.issueId && worker.issueId !== input.issueId) {
    throw new Error(
      `Worker ${worker.id} is bound to issue ${worker.issueId}, not requested issue ${input.issueId}`,
    );
  }

  const repoHint = resolvedIssue?.repo ?? worker?.repo;
  const targetRepoRoles: WorktreeStackRepoRole[] =
    repoHint === "fork"
      ? ["runtime-fork"]
      : repoHint === "both"
        ? ["app", "runtime-fork"]
        : ["app"];

  return {
    manifestPath,
    manifest,
    appRepo,
    runtimeForkRepo,
    apiService,
    webService,
    batch,
    issue: resolvedIssue,
    worker,
    targetRepoRoles,
    targetAppWorktreePath: targetRepoRoles.includes("app") ? (appRepo?.worktreePath ?? null) : null,
    targetRuntimeForkWorktreePath: targetRepoRoles.includes("runtime-fork")
      ? (runtimeForkRepo?.worktreePath ?? null)
      : null,
  };
}
