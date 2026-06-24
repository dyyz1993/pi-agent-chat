import type { RPCServer } from "@dyyz1993/rpc-core";
import { existsSync } from "fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  stat,
  writeFile,
} from "fs/promises";
import { basename, dirname, join, normalize, relative, resolve, sep } from "path";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import type {
  LearningCandidate,
  LearningConfig,
  LearningCuratorMode,
  LearningFileKind,
  LearningFileRef,
  LearningMemoryCandidatePayload,
  LearningMemorySummary,
  LearningRun,
  LearningSkillCandidatePayload,
  LearningSkillSummary,
  LearningSnapshot,
} from "../modules/learning";
import { getProjectUserStateDir, normalizeProjectPath } from "../lib/pi-agent-paths";
import { getProcessManager } from "./agent";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";

const log = createLogger("learning");
const CHANNEL_TIMEOUT_MS = 1_200;

const DEFAULT_LEARNING_CONFIG: LearningConfig = {
  version: 1,
  enabled: true,
  memory: {
    recallEnabled: true,
    extractMode: "pending",
    curatorMode: "dry-run",
    curatorSchedule: {
      enabled: false,
      intervalMinutes: 1440,
    },
  },
  skills: {
    distillMode: "pending",
    curatorMode: "dry-run",
    curatorSchedule: {
      enabled: false,
      intervalMinutes: 1440,
    },
  },
};

interface LearningPaths {
  projectRoot: string;
  projectUserStateDir: string;
  learningDir: string;
  memoryDir: string;
  skillsDir: string;
  candidatesDir: string;
  runsDir: string;
  snapshotsDir: string;
  archiveMemoryDir: string;
  archiveSkillsDir: string;
}

type UsageFile = {
  version: 1;
  skills: Record<
    string,
    {
      usageCount?: number;
      lastUsedAt?: number | null;
      patchCount?: number;
      state?: "active" | "disabled" | "archived";
      pinned?: boolean;
    }
  >;
};

type CuratorAction = LearningRun["actions"][number];

function getLearningPaths(projectPath: string): LearningPaths {
  const projectRoot = normalizeProjectPath(projectPath);
  const projectUserStateDir = getProjectUserStateDir(projectRoot);
  const learningDir = join(projectUserStateDir, "learning");
  const memoryDir = join(projectUserStateDir, "memory");
  const skillsDir = join(projectUserStateDir, "skills");
  return {
    projectRoot,
    projectUserStateDir,
    learningDir,
    memoryDir,
    skillsDir,
    candidatesDir: join(learningDir, "candidates"),
    runsDir: join(learningDir, "runs"),
    snapshotsDir: join(learningDir, "snapshots"),
    archiveMemoryDir: join(memoryDir, ".archive"),
    archiveSkillsDir: join(skillsDir, ".archive"),
  };
}

async function ensureDirs(paths: LearningPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.learningDir, { recursive: true }),
    mkdir(paths.memoryDir, { recursive: true }),
    mkdir(paths.skillsDir, { recursive: true }),
    mkdir(paths.candidatesDir, { recursive: true }),
    mkdir(paths.runsDir, { recursive: true }),
    mkdir(paths.snapshotsDir, { recursive: true }),
    mkdir(paths.archiveMemoryDir, { recursive: true }),
    mkdir(paths.archiveSkillsDir, { recursive: true }),
  ]);
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(path, "utf-8")) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function nowId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function slugify(input: string, fallback: string): string {
  const slug = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/--+/g, "-")
    .slice(0, 64);
  return slug || fallback;
}

function safeJoin(baseDir: string, ...parts: string[]): string {
  const target = resolve(baseDir, ...parts);
  const base = resolve(baseDir);
  if (target !== base && !target.startsWith(`${base}/`) && !target.startsWith(`${base}\\`)) {
    throw new Error(`Path escapes learning data directory: ${target}`);
  }
  return target;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function fileRef(path: string, label: string, kind: LearningFileKind): Promise<LearningFileRef> {
  try {
    const s = await stat(path);
    return { path, label, kind, exists: true, size: s.size, mtimeMs: s.mtimeMs };
  } catch {
    return { path, label, kind, exists: false };
  }
}

function parseFrontmatter(content: string): Record<string, string> {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  if (!normalized.startsWith("---")) return {};
  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) return {};
  const frontmatter: Record<string, string> = {};
  for (const line of normalized.slice(4, endIndex).split("\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;
    const key = line.slice(0, colonIndex).trim();
    const value = line.slice(colonIndex + 1).trim();
    if (key) frontmatter[key] = value;
  }
  return frontmatter;
}

function mergeConfig(base: LearningConfig, patch: Partial<LearningConfig>): LearningConfig {
  return {
    version: 1,
    enabled: patch.enabled ?? base.enabled,
    memory: {
      ...base.memory,
      ...(patch.memory ?? {}),
    },
    skills: {
      ...base.skills,
      ...(patch.skills ?? {}),
    },
  };
}

async function getConfig(paths: LearningPaths): Promise<LearningConfig> {
  return mergeConfig(
    DEFAULT_LEARNING_CONFIG,
    await readJson<LearningConfig>(join(paths.learningDir, "config.json"), DEFAULT_LEARNING_CONFIG),
  );
}

async function setConfig(paths: LearningPaths, patch: Partial<LearningConfig>): Promise<LearningConfig> {
  await ensureDirs(paths);
  const next = mergeConfig(await getConfig(paths), patch);
  await writeJson(join(paths.learningDir, "config.json"), next);
  return next;
}

async function listCandidates(paths: LearningPaths, includeDecided = false): Promise<LearningCandidate[]> {
  if (!(await pathExists(paths.candidatesDir))) return [];
  const candidates: LearningCandidate[] = [];
  for (const entry of await readdir(paths.candidatesDir)) {
    if (!entry.endsWith(".json")) continue;
    const candidate = await readJson<LearningCandidate | null>(join(paths.candidatesDir, entry), null);
    if (!candidate) continue;
    if (!includeDecided && candidate.status !== "pending") continue;
    candidates.push(candidate);
  }
  return candidates.sort((a, b) => b.createdAt - a.createdAt);
}

async function listRuns(paths: LearningPaths): Promise<LearningRun[]> {
  if (!(await pathExists(paths.runsDir))) return [];
  const runs: LearningRun[] = [];
  for (const entry of await readdir(paths.runsDir)) {
    if (!entry.endsWith(".json")) continue;
    const run = await readJson<LearningRun | null>(join(paths.runsDir, entry), null);
    if (run) runs.push(run);
  }
  return runs
    .sort((a, b) => (b.completedAt ?? b.startedAt) - (a.completedAt ?? a.startedAt))
    .slice(0, 30);
}

async function collectMemoryFiles(
  dir: string,
  state: "active" | "archived",
  target: LearningMemorySummary[],
): Promise<void> {
  if (!(await pathExists(dir))) return;
  for (const entry of await readdir(dir)) {
    if (entry.startsWith(".") || entry === "MEMORY.md" || !entry.endsWith(".md")) continue;
    const filePath = join(dir, entry);
    try {
      const s = await stat(filePath);
      if (!s.isFile()) continue;
      const frontmatter = parseFrontmatter(await readFile(filePath, "utf-8"));
      target.push({
        filename: entry,
        filePath,
        description: frontmatter.description ?? frontmatter.name ?? null,
        type: frontmatter.type ?? null,
        mtimeMs: s.mtimeMs,
        size: s.size,
        state,
      });
    } catch {
      // Ignore malformed or disappearing files.
    }
  }
}

async function listMemoryFiles(paths: LearningPaths): Promise<LearningMemorySummary[]> {
  const files: LearningMemorySummary[] = [];
  await collectMemoryFiles(paths.memoryDir, "active", files);
  await collectMemoryFiles(paths.archiveMemoryDir, "archived", files);
  return files.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

async function loadUsage(paths: LearningPaths): Promise<UsageFile> {
  return readJson<UsageFile>(join(paths.skillsDir, ".usage.json"), { version: 1, skills: {} });
}

async function saveUsage(paths: LearningPaths, usage: UsageFile): Promise<void> {
  await writeJson(join(paths.skillsDir, ".usage.json"), usage);
}

function kindForSkillFile(relativePath: string): LearningFileKind {
  if (basename(relativePath) === "SKILL.md") return "skill-entrypoint";
  const first = relativePath.split(/[\\/]/)[0] ?? "";
  if (first === "references") return "skill-reference";
  if (first === "scripts") return "skill-script";
  if (first === "templates") return "skill-template";
  if (first === "assets") return "skill-asset";
  return "skill";
}

async function listSkillFileRefs(skillDir: string): Promise<LearningFileRef[]> {
  const refs: LearningFileRef[] = [];
  async function walk(dir: string) {
    if (!(await pathExists(dir))) return;
    for (const entry of await readdir(dir)) {
      if (entry.startsWith(".")) continue;
      const fullPath = join(dir, entry);
      const s = await stat(fullPath);
      const rel = relative(skillDir, fullPath).split(sep).join("/");
      if (s.isDirectory()) {
        await walk(fullPath);
      } else {
        refs.push(await fileRef(fullPath, rel, kindForSkillFile(rel)));
      }
    }
  }
  await walk(skillDir);
  return refs;
}

async function collectSkillSummaries(
  dir: string,
  defaultState: "active" | "archived",
  usage: UsageFile,
  target: LearningSkillSummary[],
): Promise<void> {
  if (!(await pathExists(dir))) return;
  for (const entry of await readdir(dir)) {
    if (entry.startsWith(".")) continue;
    const baseDir = join(dir, entry);
    const s = await stat(baseDir).catch(() => null);
    if (!s?.isDirectory()) continue;
    const filePath = join(baseDir, "SKILL.md");
    if (!(await pathExists(filePath))) continue;
    const frontmatter = parseFrontmatter(await readFile(filePath, "utf-8"));
    const name = frontmatter.name ?? entry;
    const usageEntry = usage.skills[name] ?? usage.skills[entry] ?? {};
    target.push({
      name,
      description: frontmatter.description ?? "",
      scope: "project-private",
      source: "generated",
      state: usageEntry.state ?? defaultState,
      usageCount: usageEntry.usageCount ?? 0,
      lastUsedAt: usageEntry.lastUsedAt ?? null,
      patchCount: usageEntry.patchCount ?? 0,
      filePath,
      baseDir,
      pinned: usageEntry.pinned ?? false,
      files: await listSkillFileRefs(baseDir),
    });
  }
}

async function listSkills(paths: LearningPaths): Promise<LearningSkillSummary[]> {
  const usage = await loadUsage(paths);
  const skills: LearningSkillSummary[] = [];
  await collectSkillSummaries(paths.skillsDir, "active", usage, skills);
  await collectSkillSummaries(paths.archiveSkillsDir, "archived", usage, skills);
  return skills.sort((a, b) => a.name.localeCompare(b.name));
}

async function getSnapshot(projectPath: string): Promise<LearningSnapshot> {
  const paths = getLearningPaths(projectPath);
  await ensureDirs(paths);
  const config = await getConfig(paths);
  await ensureMemoryEntrypoint(paths);
  const memoryFiles = await listMemoryFiles(paths);
  const skills = await listSkills(paths);
  const candidates = await listCandidates(paths, false);
  const runs = await listRuns(paths);
  const lastRunAt = runs.reduce<number | null>((latest, run) => {
    const t = run.completedAt ?? run.startedAt;
    return latest === null || t > latest ? t : latest;
  }, null);
  const snapshot: LearningSnapshot = {
    version: 1,
    projectRoot: paths.projectRoot,
    dirs: {
      learningDir: paths.learningDir,
      memoryDir: paths.memoryDir,
      skillsDir: paths.skillsDir,
    },
    config,
    overview: {
      memoryFiles: memoryFiles.length,
      activeSkills: skills.filter((skill) => skill.state === "active").length,
      disabledSkills: skills.filter((skill) => skill.state === "disabled").length,
      archivedSkills: skills.filter((skill) => skill.state === "archived").length,
      pendingCandidates: candidates.length,
      warnings: runs.filter((run) => run.status === "failed").length,
      lastRunAt,
    },
    memory: {
      files: memoryFiles,
      entrypoint: existsSync(join(paths.memoryDir, "MEMORY.md"))
        ? await fileRef(join(paths.memoryDir, "MEMORY.md"), "MEMORY.md", "memory-index")
        : null,
      diagnostics: [],
    },
    skills: {
      items: skills,
      diagnostics: [],
    },
    candidates,
    runs,
  };
  await writeJson(join(paths.snapshotsDir, "latest.json"), snapshot);
  return snapshot;
}

async function updateCandidate(paths: LearningPaths, candidate: LearningCandidate): Promise<void> {
  await writeJson(safeJoin(paths.candidatesDir, `${slugify(candidate.id, "candidate")}.json`), candidate);
}

async function getCandidate(paths: LearningPaths, candidateId: string): Promise<LearningCandidate> {
  const candidate = await readJson<LearningCandidate | null>(
    safeJoin(paths.candidatesDir, `${slugify(candidateId, "candidate")}.json`),
    null,
  );
  if (!candidate) throw new Error(`Learning candidate not found: ${candidateId}`);
  return candidate;
}

function serializeMemory(payload: LearningMemoryCandidatePayload, sourceSessionId?: string): string {
  const source = sourceSessionId ? `sourceSession: ${sourceSessionId}\n` : "";
  return `---\nname: ${payload.description}\ndescription: ${payload.description}\ntype: ${payload.memoryType}\n${source}createdAt: ${new Date().toISOString()}\n---\n\n${payload.content.trim()}\n`;
}

function serializeSkill(payload: LearningSkillCandidatePayload): string {
  return `---\nname: ${payload.name}\ndescription: ${payload.description}\n---\n\n${payload.body.trim()}\n`;
}

async function ensureMemoryEntrypoint(paths: LearningPaths): Promise<void> {
  const memoryFiles = await listMemoryFiles(paths);
  const lines = [
    "# Project Memory",
    "",
    ...memoryFiles
      .filter((file) => file.state === "active")
      .map((file) => `- [${file.description ?? file.filename}](${file.filename})`),
    "",
  ];
  await writeFile(join(paths.memoryDir, "MEMORY.md"), lines.join("\n"), "utf-8");
}

async function applyMemoryCandidate(
  paths: LearningPaths,
  payload: LearningMemoryCandidatePayload,
  sourceSessionId?: string,
): Promise<LearningFileRef[]> {
  const filename = payload.filename.endsWith(".md")
    ? `${slugify(payload.filename.slice(0, -3), "memory")}.md`
    : `${slugify(payload.filename, "memory")}.md`;
  const target = safeJoin(paths.memoryDir, filename);
  await writeFile(target, serializeMemory(payload, sourceSessionId), "utf-8");
  await ensureMemoryEntrypoint(paths);
  return [
    await fileRef(target, filename, "memory"),
    await fileRef(join(paths.memoryDir, "MEMORY.md"), "MEMORY.md", "memory-index"),
  ];
}

async function writeSkillExtras(
  skillDir: string,
  extras: LearningSkillCandidatePayload["files"],
): Promise<LearningFileRef[]> {
  const refs: LearningFileRef[] = [];
  for (const extra of extras ?? []) {
    const relativePath = normalize(extra.relativePath).replace(/^(\.\.[/\\])+/, "");
    const target = safeJoin(skillDir, relativePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, extra.content, "utf-8");
    refs.push(await fileRef(target, relativePath, kindForSkillFile(relativePath)));
  }
  return refs;
}

async function createSkillPackage(
  paths: LearningPaths,
  payload: LearningSkillCandidatePayload,
): Promise<LearningFileRef[]> {
  const skillName = slugify(payload.name, "generated-skill");
  const skillDir = safeJoin(paths.skillsDir, skillName);
  await mkdir(skillDir, { recursive: true });
  const skillPath = safeJoin(skillDir, "SKILL.md");
  await writeFile(skillPath, serializeSkill({ ...payload, name: skillName }), "utf-8");
  const refs = [await fileRef(skillPath, "SKILL.md", "skill-entrypoint")];
  refs.push(...(await writeSkillExtras(skillDir, payload.files)));
  const usage = await loadUsage(paths);
  usage.skills[skillName] = {
    ...(usage.skills[skillName] ?? {}),
    state: "active",
    pinned: payload.pinned ?? false,
  };
  await saveUsage(paths, usage);
  return refs;
}

async function mergeSkill(
  paths: LearningPaths,
  targetName: string,
  payload: LearningSkillCandidatePayload,
): Promise<LearningFileRef[]> {
  const skillName = slugify(targetName, "generated-skill");
  const skillDir = safeJoin(paths.skillsDir, skillName);
  const skillPath = safeJoin(skillDir, "SKILL.md");
  if (!(await pathExists(skillPath))) {
    return createSkillPackage(paths, { ...payload, name: skillName });
  }
  const original = await readFile(skillPath, "utf-8");
  await writeFile(skillPath, `${original.trim()}\n\n## Learned Update\n\n${payload.body.trim()}\n`, "utf-8");
  const refs = [await fileRef(skillPath, "SKILL.md", "skill-entrypoint")];
  refs.push(...(await writeSkillExtras(skillDir, payload.files)));
  const usage = await loadUsage(paths);
  const current = usage.skills[skillName] ?? {};
  usage.skills[skillName] = {
    ...current,
    state: current.state ?? "active",
    patchCount: (current.patchCount ?? 0) + 1,
    pinned: payload.pinned ?? current.pinned ?? false,
  };
  await saveUsage(paths, usage);
  return refs;
}

async function archiveSkill(paths: LearningPaths, skillName: string): Promise<LearningFileRef[]> {
  const safeName = slugify(skillName, "generated-skill");
  const source = safeJoin(paths.skillsDir, safeName);
  const target = safeJoin(paths.archiveSkillsDir, safeName);
  if (!(await pathExists(source))) throw new Error(`Skill not found: ${skillName}`);
  await mkdir(dirname(target), { recursive: true });
  await rename(source, target);
  const usage = await loadUsage(paths);
  usage.skills[safeName] = { ...(usage.skills[safeName] ?? {}), state: "archived" };
  await saveUsage(paths, usage);
  return [await fileRef(target, safeName, "skill")];
}

async function recordRun(paths: LearningPaths, run: LearningRun): Promise<LearningRun> {
  await writeJson(join(paths.runsDir, `${run.id}.json`), run);
  return run;
}

async function approveCandidateFallback(
  projectPath: string,
  candidateId: string,
  mergeTargetSkillName?: string,
): Promise<LearningSnapshot> {
  const paths = getLearningPaths(projectPath);
  await ensureDirs(paths);
  const candidate = await getCandidate(paths, candidateId);
  if (candidate.status !== "pending") return getSnapshot(projectPath);
  let fileRefs: LearningFileRef[] = candidate.fileRefs;
  if (candidate.payload.type === "memory") {
    fileRefs = await applyMemoryCandidate(paths, candidate.payload, candidate.sourceSessionId);
  } else if (candidate.payload.type === "skill") {
    if (candidate.action === "archive-skill") {
      fileRefs = await archiveSkill(paths, candidate.targetId ?? candidate.payload.name);
    } else if (candidate.action === "merge-skill" || mergeTargetSkillName || candidate.payload.targetSkillName) {
      fileRefs = await mergeSkill(
        paths,
        mergeTargetSkillName ?? candidate.payload.targetSkillName ?? candidate.payload.name,
        candidate.payload,
      );
    } else {
      fileRefs = await createSkillPackage(paths, candidate.payload);
    }
  }
  const decided: LearningCandidate = {
    ...candidate,
    status: "approved",
    decision: "approved",
    decidedAt: Date.now(),
    fileRefs,
  };
  await updateCandidate(paths, decided);
  await recordRun(paths, {
    version: 1,
    id: nowId("learning-run"),
    domain: candidate.domain,
    type: "candidate-decision",
    mode: "manual",
    status: "completed",
    startedAt: Date.now(),
    completedAt: Date.now(),
    summary: `Approved ${candidate.title}`,
    actions: [
      {
        action: candidate.action,
        targetId: candidate.id,
        targetPath: fileRefs[0]?.path,
        summary: candidate.summary,
        fileRefs,
      },
    ],
  });
  return getSnapshot(projectPath);
}

async function rejectCandidateFallback(projectPath: string, candidateId: string): Promise<LearningSnapshot> {
  const paths = getLearningPaths(projectPath);
  await ensureDirs(paths);
  const candidate = await getCandidate(paths, candidateId);
  if (candidate.status === "pending") {
    await updateCandidate(paths, {
      ...candidate,
      status: "rejected",
      decision: "rejected",
      decidedAt: Date.now(),
    });
    await recordRun(paths, {
      version: 1,
      id: nowId("learning-run"),
      domain: candidate.domain,
      type: "candidate-decision",
      mode: "manual",
      status: "completed",
      startedAt: Date.now(),
      completedAt: Date.now(),
      summary: `Rejected ${candidate.title}`,
      actions: [
        {
          action: candidate.action,
          targetId: candidate.id,
          summary: candidate.summary,
          fileRefs: candidate.fileRefs,
        },
      ],
    });
  }
  return getSnapshot(projectPath);
}

async function createArchiveCandidate(
  paths: LearningPaths,
  skill: LearningSkillSummary,
): Promise<LearningCandidate> {
  const candidate: LearningCandidate = {
    version: 1,
    id: nowId("skill-candidate"),
    domain: "skill",
    action: "archive-skill",
    status: "pending",
    title: `Archive unused generated skill ${skill.name}`,
    summary: `Archive unused generated skill ${skill.name}`,
    confidence: "medium",
    targetId: skill.name,
    targetPath: skill.baseDir,
    createdAt: Date.now(),
    payload: {
      type: "skill",
      name: skill.name,
      description: `Archive unused generated skill ${skill.name}`,
      body: "",
    },
    fileRefs: skill.files,
  };
  await updateCandidate(paths, candidate);
  return candidate;
}

async function runCuratorFallback(
  projectPath: string,
  domain: "memory" | "skill",
  mode?: LearningCuratorMode,
): Promise<LearningRun> {
  const paths = getLearningPaths(projectPath);
  await ensureDirs(paths);
  const config = await getConfig(paths);
  const resolvedMode = mode ?? (domain === "memory" ? config.memory.curatorMode : config.skills.curatorMode);
  let actions: CuratorAction[] = [];
  if (domain === "memory") {
    const memoryFiles = await listMemoryFiles(paths);
    actions = [
      {
        action: "none",
        summary:
          resolvedMode === "dry-run"
            ? "Dry-run only; no memory files changed."
            : "No memory changes proposed.",
        fileRefs: await Promise.all(
          memoryFiles.map((file) => fileRef(file.filePath, file.filename, "memory")),
        ),
      },
    ];
  } else {
    const skills = await listSkills(paths);
    const stale = skills.filter((skill) => !skill.pinned && skill.state === "active" && skill.usageCount === 0);
    actions = stale.map((skill) => ({
      action: "archive-skill" as const,
      targetId: skill.name,
      targetPath: skill.baseDir,
      summary: `Archive unused generated skill ${skill.name}`,
      fileRefs: skill.files,
    }));
    if (resolvedMode === "pending") {
      for (const skill of stale) {
        await createArchiveCandidate(paths, skill);
      }
    } else if (resolvedMode === "auto") {
      for (const skill of stale) {
        await archiveSkill(paths, skill.name);
      }
    }
    if (actions.length === 0) actions = [{ action: "none", summary: "No skill curator actions proposed." }];
  }
  const run: LearningRun = {
    version: 1,
    id: nowId(`${domain}-curator`),
    domain,
    type: domain === "memory" ? "memory-curator" : "skill-curator",
    mode: resolvedMode,
    status: "completed",
    startedAt: Date.now(),
    completedAt: Date.now(),
    summary: domain === "memory" ? "Reviewed memory files." : "Reviewed generated skills.",
    actions,
  };
  return recordRun(paths, run);
}

async function callLearningChannel<T>(
  sessionId: string | undefined,
  method: string,
  params: Record<string, unknown>,
): Promise<T | null> {
  const manager = getProcessManager();
  if (!manager || !sessionId || !manager.hasSession(sessionId)) return null;
  try {
    return (await withTimeout(
      manager.callChannel(sessionId, "learning", method, params),
      CHANNEL_TIMEOUT_MS,
    )) as T;
  } catch (err) {
    log.warn("learning channel call failed", { method, sessionId, error: String(err) });
    return null;
  }
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("learning.getSnapshot", async (params) => {
    const result = await callLearningChannel<R<"learning.getSnapshot">>(
      params.sessionId,
      "learning.getSnapshot",
      { projectPath: params.projectPath },
    );
    return result ?? getSnapshot(params.projectPath);
  });

  r("learning.setConfig", async (params) => {
    const result = await callLearningChannel<R<"learning.setConfig">>(
      params.sessionId,
      "learning.setConfig",
      { config: params.config },
    );
    if (result) return result;
    const paths = getLearningPaths(params.projectPath);
    await setConfig(paths, params.config);
    return getSnapshot(params.projectPath);
  });

  r("learning.approveCandidate", async (params) => {
    const result = await callLearningChannel<R<"learning.approveCandidate">>(
      params.sessionId,
      "learning.approveCandidate",
      {
        candidateId: params.candidateId,
        mergeTargetSkillName: params.mergeTargetSkillName,
      },
    );
    return result ?? approveCandidateFallback(params.projectPath, params.candidateId, params.mergeTargetSkillName);
  });

  r("learning.rejectCandidate", async (params) => {
    const result = await callLearningChannel<R<"learning.rejectCandidate">>(
      params.sessionId,
      "learning.rejectCandidate",
      { candidateId: params.candidateId },
    );
    return result ?? rejectCandidateFallback(params.projectPath, params.candidateId);
  });

  r("learning.runCurator", async (params) => {
    const result = await callLearningChannel<R<"learning.runCurator">>(
      params.sessionId,
      "learning.runCurator",
      { domain: params.domain, mode: params.mode },
    );
    return result ?? runCuratorFallback(params.projectPath, params.domain, params.mode);
  });
}
