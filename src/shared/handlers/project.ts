import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { execFile, spawn } from "child_process";
import { basename, join } from "path";
import { homedir } from "os";
import { promisify } from "util";
import { createLogger } from "../lib/logger";
import {
  addRecentProject,
  listRecentProjects,
  removeRecentProject,
  listConfiguredPaths,
  addConfiguredPath,
  removeConfiguredPath,
  syncOpenTabs,
  restoreOpenTabs,
  listDirectory,
  removeFavoriteFolder,
  listFavoriteFolders,
  toggleProjectPin,
  toggleFavoriteFolder,
  getAgentFavorites,
  toggleAgentFavorite,
  getModelFavorites,
  toggleModelFavorite,
  createDirectory,
  listSshProfiles,
  getSshProfile,
  upsertSshProfile,
  removeSshProfile,
  openRemoteProject,
  listRemoteProjects,
  getDefaultProjectDir,
  setDefaultProjectDir,
} from "../lib/project-config";
import {
  scanSessionsForProject,
  scanAllProjects,
  listPiProjects,
  listMergedProjects,
  findSessionById,
} from "../lib/session-scanner";
import { openFolder } from "../lib/native-dialog";
import { linkProject, unlinkProject, getLinkedProjects } from "../lib/linked-projects-config";
import { getPiAgentDir } from "../lib/pi-agent-paths";
import { getProcessManager } from "./agent";
import { config } from "../../server-config";
import {
  getRemoteProjectSshRuntimeKind,
  splitSshArgsForRemoteChild,
} from "../agent/remote-runtime-selection";
import {
  collectRemoteSyncSources,
  resolveRemoteSyncedAgentDir,
  stageRemoteResourceSync,
  syncRemoteAgentResources,
} from "../../sandbox/remote-resource-sync";
import type { RemoteResourceSyncSource } from "../../sandbox/remote-resource-sync";
import type {
  SessionStatus,
  RemoteSyncResourceType,
  SshCommandResult,
  SshConnectionErrorCode,
  SshDirectoryEntry,
  RemoteResourceSyncPreview,
  QuickCreatePlan,
} from "../modules/project";
import { listDetectedSshHosts } from "../lib/ssh-config";
import { classifySshErrorMessage } from "../lib/ssh-error-classification";
import { getProjectUserStateDir } from "../lib/pi-agent-paths";
import {
  getWorktreeStackExecutionContext,
  readWorktreeStackManifest,
  updateWorktreeStackOrchestration,
} from "../lib/worktree-stack-manifest";

const log = createLogger("config");
const execFileAsync = promisify(execFile);
const REMOTE_RESOURCE_TYPES = new Set<RemoteSyncResourceType>(["skills", "agents", "rules"]);

function runPiCli(
  cliPath: string,
  args: string[],
  options: { env: NodeJS.ProcessEnv; timeoutMs: number },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cliPath, args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`pi CLI timed out after ${options.timeoutMs}ms`));
    }, options.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const err = new Error(
        `pi CLI exited with code ${code}${signal ? ` (signal ${signal})` : ""}`,
      ) as Error & {
        stdout?: string;
        stderr?: string;
        code?: number | null;
        signal?: NodeJS.Signals | null;
      };
      err.stdout = stdout;
      err.stderr = stderr;
      err.code = code;
      err.signal = signal;
      reject(err);
    });
  });
}

function createIsolatedPiConfigDir(): string {
  const baseDir = join(homedir(), ".pi", "chat", ".quick-create");
  mkdirSync(baseDir, { recursive: true });
  const tmpDir = mkdtempSync(join(baseDir, "run-"));

  const realAgentDir = getPiAgentDir();

  // Symlink the user's auth, settings and models so the isolated pi CLI run
  // can resolve tier aliases ("fast"/"pro"/"max") to the models the user has
  // actually configured, and pick up auth/credentials without prompting.
  // If a symlink fails we leave the file absent; pi CLI surfaces the
  // missing-auth / missing-model error itself, so there is nothing to do here.
  for (const fileName of ["auth.json", "settings.json", "models.json"]) {
    const realFile = join(realAgentDir, fileName);
    if (existsSync(realFile)) {
      try {
        symlinkSync(realFile, join(tmpDir, fileName));
      } catch {
        // ignore: file may already exist or fs is read-only
      }
    }
  }

  writeFileSync(join(tmpDir, "mcp.json"), '{"mcp":{"servers":{}}}', "utf8");
  return tmpDir;
}

function stripBenignPiCliStderr(stderr: string): string {
  return stderr
    .split(/\r?\n/)
    .filter(
      (line) =>
        !/^\[agent\] ".+" is missing recommended field\(s\): .+ These affect the Agent panel display\.$/.test(
          line.trim(),
        ),
    )
    .join("\n")
    .trim();
}

function getPiCliFailureMessage(params: {
  stderr: string;
  fallback?: string;
  limit?: number;
}): string {
  const filtered = stripBenignPiCliStderr(params.stderr);
  const message = filtered || params.fallback?.trim() || "pi CLI error";
  return message.slice(0, params.limit ?? 300);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * 把任意字符串清洗为文件系统安全的 kebab-case 文件夹名。
 * 用于快速创建项目时对 LLM 生成名做兜底处理。
 */
function sanitizeFolderName(input: string): string {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return "";
  // 非 [a-z0-9-] 字符统一替换为 -
  const replaced = trimmed.replace(/[^a-z0-9-]+/g, "-");
  // 合并连续的 -
  const collapsed = replaced.replace(/-+/g, "-");
  // 去掉首尾 -
  const trimmed2 = collapsed.replace(/^-+|-+$/g, "");
  return trimmed2.slice(0, 40);
}

function sanitizeQuickCreatePlan(input: unknown): QuickCreatePlan | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) return undefined;
  const plan = input as Partial<QuickCreatePlan>;
  if (
    typeof plan.goal !== "string" ||
    !Array.isArray(plan.techStack) ||
    !Array.isArray(plan.steps) ||
    typeof plan.testing !== "string"
  ) {
    return undefined;
  }

  return {
    goal: plan.goal.trim().slice(0, 300),
    techStack: plan.techStack
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 8),
    steps: plan.steps
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 10),
    testing: plan.testing.trim().slice(0, 500),
  };
}

function hasCjkText(input: string): boolean {
  return /[\u3400-\u9fff]/.test(input);
}

function deriveFallbackFolderName(requirement: string): string {
  const words = requirement
    .toLowerCase()
    .match(/[a-z0-9]+/g)
    ?.filter(
      (word) =>
        !new Set([
          "a",
          "an",
          "and",
          "app",
          "application",
          "build",
          "create",
          "for",
          "of",
          "small",
          "the",
          "to",
          "with",
        ]).has(word),
    )
    .slice(0, 5);

  const fromWords = sanitizeFolderName(words?.join("-") ?? "");
  if (fromWords) return fromWords;

  return sanitizeFolderName(requirement) || "quick-project";
}

function createFallbackQuickCreatePlan(requirement: string): QuickCreatePlan {
  if (hasCjkText(requirement)) {
    return {
      goal: `根据需求完成一个可运行的项目：${requirement}`.slice(0, 300),
      techStack: ["TypeScript", "React", "Vitest"],
      steps: ["确认核心功能范围", "搭建项目结构", "实现主要交互流程", "补充基础测试"],
      testing: "运行单元测试和构建检查，并手动验证主要创建、编辑和错误状态流程。",
    };
  }

  return {
    goal: `Build a working project for: ${requirement}`.slice(0, 300),
    techStack: ["TypeScript", "React", "Vitest"],
    steps: [
      "Confirm the core user workflow.",
      "Set up the project structure.",
      "Implement the primary UI and state flow.",
      "Add focused tests for the main behavior.",
    ],
    testing: "Run unit tests and a production build, then manually verify the main happy path and error states.",
  };
}

function createFallbackQuickCreateResult(requirement: string): {
  name: string;
  description: string;
  plan: QuickCreatePlan;
} {
  const cjk = hasCjkText(requirement);
  return {
    name: deriveFallbackFolderName(requirement),
    description: (
      cjk ? `根据需求创建的项目：${requirement}` : `A project generated from: ${requirement}`
    ).slice(0, 200),
    plan: createFallbackQuickCreatePlan(requirement),
  };
}

function isStructuredOutputFailure(message: string): boolean {
  return (
    /structured output validation failed/i.test(message) ||
    /json parse failed/i.test(message) ||
    /unexpected end of json input/i.test(message)
  );
}

function renderProjectReadme(
  folderName: string,
  description: string,
  plan: QuickCreatePlan | undefined,
): string {
  const title = folderName.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const lines: string[] = [`# ${title}`, ""];

  if (description) {
    lines.push(`> ${description}`, "");
  }
  if (plan?.goal) {
    lines.push("## 目标", "", plan.goal, "");
  }
  if (plan && plan.techStack.length > 0) {
    lines.push("## 技术栈", "", ...plan.techStack.map((tech) => `- ${tech}`), "");
  }
  if (plan && plan.steps.length > 0) {
    lines.push("## 实施步骤", "");
    plan.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
    lines.push("");
  }
  if (plan?.testing) {
    lines.push("## 测试与校验", "", plan.testing, "");
  }
  lines.push(
    "## 交付协议",
    "",
    "本项目由快速创建流程生成。开发 Agent 必须先阅读并遵循 [`QUICK_CREATE_DELIVERY.md`](./QUICK_CREATE_DELIVERY.md)，完成其中的安全安装、自动测试、构建、浏览器验收、负向/边界场景和未测风险记录后，才能声明交付完成。",
    "",
  );

  return lines.join("\n");
}

function renderQuickCreateDeliveryProtocol(
  folderName: string,
  description: string,
  plan: QuickCreatePlan | undefined,
): string {
  const lines: string[] = [
    "# Quick Create Delivery Protocol",
    "",
    "This project was created by pi-agent-chat quick create. Treat this file as the delivery contract for the first development session.",
    "",
    "## Source Request",
    "",
    `- Project: ${folderName}`,
  ];

  if (description) {
    lines.push(`- Description: ${description}`);
  }
  if (plan?.goal) {
    lines.push(`- Goal: ${plan.goal}`);
  }
  if (plan && plan.techStack.length > 0) {
    lines.push(`- Suggested stack: ${plan.techStack.join(", ")}`);
  }
  lines.push("");

  if (plan && plan.steps.length > 0) {
    lines.push("## Implementation Scope", "");
    plan.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step}`);
    });
    lines.push("");
  }

  lines.push(
    "## Safety Rules",
    "",
    "- Do not run recursive destructive cleanup commands such as `rm -rf node_modules`, `rm -rf .`, or lockfile deletion as the first recovery step.",
    "- If dependency installation fails or times out, inspect the error and retry with a non-destructive command first, for example `npm install --no-fund --no-audit`.",
    "- Ask for explicit user approval before deleting generated files, dependency directories, lockfiles, git history, or anything outside this project.",
    "- Keep build artifacts and cache files out of git unless they are intentionally part of the project.",
    "",
    "## Required Validation Packet",
    "",
    "Before saying the project is ready, provide a validation packet with:",
    "",
    "- Automated checks: exact install, test, typecheck, and build commands with pass/fail results.",
    "- Manual acceptance checks: setup, steps, expected result, evidence, and status.",
    "- Browser/UI checks for web projects: open URL, happy path, negative/edge cases, refresh or persistence behavior when relevant, and mobile viewport behavior.",
    "- Safety evidence: any permission prompts, denied destructive commands, and why the final commands were safe.",
    "- Residual risk: what was not tested and why.",
    "",
    "## Minimum Web App Acceptance Cases",
    "",
    "- Happy path: create the primary object, edit/update it, move or complete it if applicable, then delete/reset it.",
    "- Negative path: empty input, invalid input, missing dependency, corrupt persisted data, or unavailable storage when applicable.",
    "- Runtime path: start the local dev/preview server on a clearly marked temporary port and state that it is a preview URL, not a product feature.",
    "- Responsive path: verify desktop and mobile viewport layout, with no incoherent overlap or horizontal overflow.",
    "",
  );

  if (plan?.testing) {
    lines.push("## Generated Testing Hint", "", plan.testing, "");
  }

  lines.push(
    "## Completion Gate",
    "",
    "The project is not deliverable until the validation packet is complete. If any required check fails, report the failure and continue fixing or ask the user for direction.",
    "",
  );

  return lines.join("\n");
}

function normalizeRemoteDirectoryPath(path?: string): string {
  const trimmed = path?.trim();
  if (!trimmed) return "";
  if (trimmed === "~") return "~";
  if (trimmed.startsWith("~/")) return `~/${trimmed.slice(2).replace(/\/+$/, "")}`;
  if (trimmed === "/") return "/";
  const withoutTrailingSlash = trimmed.replace(/\/+$/, "");
  if (withoutTrailingSlash.startsWith("/")) return withoutTrailingSlash;
  return `/${withoutTrailingSlash.replace(/^\/+/, "")}`;
}

function joinRemotePath(base: string, name: string): string {
  const cleanBase = normalizeRemoteDirectoryPath(base);
  const cleanName = name.replace(/^\/+/, "");
  if (!cleanBase || cleanBase === ".") return cleanName || ".";
  if (cleanBase === "/") return `/${cleanName}`;
  return `${cleanBase}/${cleanName}`;
}

function directoryTarget(path?: string): string {
  const normalized = normalizeRemoteDirectoryPath(path);
  if (!normalized || normalized === "~") return '"$HOME"';
  if (normalized.startsWith("~/")) {
    const suffix = normalized.slice(2);
    return suffix ? `"$HOME"/${shellQuote(suffix)}` : '"$HOME"';
  }
  return shellQuote(normalized);
}

function classifySshError(message: string): SshConnectionErrorCode {
  return classifySshErrorMessage(message);
}

function normalizeRemoteResourceTypes(input?: RemoteSyncResourceType[]): RemoteSyncResourceType[] {
  return (input ?? []).filter((type): type is RemoteSyncResourceType =>
    REMOTE_RESOURCE_TYPES.has(type),
  );
}

function getProjectRemoteResourceExtraSources(
  projectPath: string,
  resourceTypes?: RemoteSyncResourceType[],
): RemoteResourceSyncSource[] {
  const effectiveTypes = resourceTypes ?? ["skills", "agents", "rules"];
  if (!effectiveTypes.includes("skills")) return [];
  const projectSkillsDir = join(getProjectUserStateDir(projectPath), "skills");
  return existsSync(projectSkillsDir) ? [{ type: "skills", localPath: projectSkillsDir }] : [];
}

async function findRemoteProjectLocalPath(input: {
  host?: string;
  remotePath?: string;
}): Promise<string | null> {
  const host = input.host?.trim();
  const remotePath = normalizeRemoteDirectoryPath(input.remotePath);
  if (!host || !remotePath) return null;
  const projects = await listRemoteProjects().catch(() => []);
  return (
    projects.find(
      (project) =>
        project.host === host && normalizeRemoteDirectoryPath(project.remotePath) === remotePath,
    )?.localPath ?? null
  );
}

async function previewRemoteResourceSync(input: {
  host?: string;
  remotePath?: string;
  resourceTypes?: RemoteSyncResourceType[];
}): Promise<RemoteResourceSyncPreview> {
  const resourceTypes = normalizeRemoteResourceTypes(input.resourceTypes);
  if (Array.isArray(input.resourceTypes) && resourceTypes.length === 0) {
    return { resources: [], blocked: [], hash: "" };
  }
  const effectiveResourceTypes =
    resourceTypes.length > 0
      ? resourceTypes
      : (["skills", "agents", "rules"] as RemoteSyncResourceType[]);

  const projectLocalPath = await findRemoteProjectLocalPath(input);
  const extraSources = projectLocalPath
    ? getProjectRemoteResourceExtraSources(projectLocalPath, effectiveResourceTypes)
    : [];
  const options = {
    localAgentDir: config.remoteResourceSyncLocalAgentDir || undefined,
    resourceTypes: effectiveResourceTypes,
    extraSources,
  };
  const sources = collectRemoteSyncSources(options);
  const staged = stageRemoteResourceSync(options);
  try {
    const byType = new Map(staged.manifest.resources.map((resource) => [resource.type, resource]));
    return {
      hash: staged.manifest.hash,
      blocked: staged.manifest.blocked,
      resources: effectiveResourceTypes.map((type) => {
        const resource = byType.get(type);
        return {
          type,
          files: resource?.files ?? 0,
          bytes: resource?.bytes ?? 0,
          sources: sources
            .filter((source) => source.type === type)
            .map((source) => source.localPath),
        };
      }),
    };
  } finally {
    rmSync(staged.stagingDir, { recursive: true, force: true });
  }
}

class SshConnectionError extends Error {
  readonly errorCode: SshConnectionErrorCode;
  readonly stderr?: string;

  constructor(result: SshCommandResult) {
    super(result.error ?? result.stderr ?? "SSH connection failed");
    this.name = "SshConnectionError";
    this.errorCode = result.errorCode ?? classifySshError(this.message);
    this.stderr = result.stderr;
  }
}

async function resolveSshConnection(input: {
  profileId?: string;
  host?: string;
  sshArgs?: string[];
  shell?: string;
}): Promise<{ host: string; sshArgs?: string[]; shell?: string }> {
  const profile = input.profileId ? await getSshProfile(input.profileId) : null;
  return {
    host: input.host ?? profile?.host ?? "",
    sshArgs: input.sshArgs ?? profile?.sshArgs,
    shell: input.shell ?? profile?.shell,
  };
}

async function runSshCommand(input: {
  host: string;
  command: string;
  sshArgs?: string[];
  timeout?: number;
}): Promise<SshCommandResult> {
  const host = input.host.trim();
  if (!host) {
    const error = "SSH host is required";
    return {
      ok: false,
      stdout: "",
      stderr: "",
      error,
      errorCode: classifySshError(error),
    };
  }
  try {
    const result = await execFileAsync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        ...(input.sshArgs ?? []),
        host,
        input.command,
      ],
      { timeout: input.timeout ?? 15_000, maxBuffer: 1024 * 1024 },
    );
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (err) {
    const e = err as Error & { stdout?: string; stderr?: string };
    const stderr = e.stderr ?? "";
    const error = stderr.trim() || e.message;
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr,
      error,
      errorCode: classifySshError(error),
    };
  }
}

async function testSshConnection(input: {
  host: string;
  remotePath?: string;
  sshArgs?: string[];
}): Promise<SshCommandResult> {
  const remotePath = normalizeRemoteDirectoryPath(input.remotePath);
  const command = remotePath
    ? `cd ${directoryTarget(remotePath)} && printf 'pi-agent-chat-ssh-ok\\n' && pwd`
    : "printf 'pi-agent-chat-ssh-ok\\n' && pwd";
  return runSshCommand({ host: input.host, command, sshArgs: input.sshArgs });
}

async function listSshDirectory(input: {
  host: string;
  dirPath?: string;
  sshArgs?: string[];
}): Promise<{
  ok: boolean;
  path: string;
  entries: SshDirectoryEntry[];
  stdout: string;
  stderr: string;
  error?: string;
}> {
  const command = [
    `cd ${directoryTarget(input.dirPath)}`,
    "pwd",
    "find . -maxdepth 1 -mindepth 1 -type d -print | sed 's#^./##' | sort",
  ].join(" && ");
  const result = await runSshCommand({ host: input.host, command, sshArgs: input.sshArgs });
  if (!result.ok) {
    return { ...result, path: normalizeRemoteDirectoryPath(input.dirPath), entries: [] };
  }

  const lines = result.stdout.split(/\r?\n/).filter((line) => line.length > 0);
  const path = lines[0] ?? input.dirPath?.trim() ?? "";
  const entries = lines
    .slice(1)
    .filter((name) => name !== "." && name !== "..")
    .map((name) => ({ name, path: joinRemotePath(path, name), isDirectory: true as const }));
  return { ...result, path, entries };
}

async function createSshDirectory(input: {
  host: string;
  dirPath: string;
  sshArgs?: string[];
}): Promise<{ ok: boolean; path: string; stdout: string; stderr: string; error?: string }> {
  const dirPath = normalizeRemoteDirectoryPath(input.dirPath);
  if (!dirPath) {
    return { ok: false, path: "", stdout: "", stderr: "", error: "Remote path is required" };
  }
  const command = `mkdir -p ${shellQuote(dirPath)} && cd ${shellQuote(dirPath)} && pwd`;
  const result = await runSshCommand({ host: input.host, command, sshArgs: input.sshArgs });
  const path = result.stdout.split(/\r?\n/).find((line) => line.length > 0) ?? dirPath;
  return { ...result, path };
}

export function register(server: RPCServer, options: HandlerOptions): void {
  const r = createRegister(server);

  r("project.open", async (params) => {
    const projectPath = params.path;
    if (!existsSync(projectPath)) {
      return { projectPath, name: "", sessionCount: 0 };
    }

    const name = basename(projectPath);
    const sessions = await scanSessionsForProject(projectPath);
    const sessionCount = sessions.length;

    await addRecentProject(projectPath, name, sessionCount);

    return { projectPath, name, sessionCount };
  });

  r("project.listRecent", async () => {
    const saved = await listRecentProjects();

    if (saved.length > 0) {
      return { projects: saved };
    }

    const allProjects = await scanAllProjects();
    const projects = allProjects.map((p) => ({
      path: p.projectPath,
      name: basename(p.projectPath),
      lastOpened: p.sessions[0]?.updatedAt ?? 0,
      pinned: false,
      sessionCount: p.sessionCount,
    }));

    return { projects };
  });

  r("project.removeRecent", async (params) => {
    await removeRecentProject(params.projectPath);
    return { ok: true };
  });

  r("project.scanSessions", async (params) => {
    const log = createLogger("project");
    const t0 = Date.now();
    log.info("[scanSessions] handler begin", { projectPath: params.projectPath });
    try {
      const sessions = await scanSessionsForProject(params.projectPath);
      // 同一 RPC 顺带把 session 状态带回来，
      // 避免前端在加载完列表后再发一次 agent.batchGetSessionsStatus
      const pm = getProcessManager();
      const sessionIds = sessions.map((s) => s.sessionId);
      // 进程池返回的是内部 status（idle/streaming/stopped）。
      // 在 RPC 边界统一映射成前端 SessionStatus：stopped → idle（前端没有 stopped 概念）。
      // 之后整条链路就是 SessionStatus，前端拿到直接写 store，不需要再做白名单校验。
      const statuses: Array<{ sessionId: string; status: SessionStatus }> = pm
        ? pm.batchGetSessionsStatus(sessionIds).map((s) => ({
            sessionId: s.sessionId,
            status: s.status === "stopped" ? "idle" : s.status,
          }))
        : [];
      log.info("[scanSessions] handler done", {
        count: sessions.length,
        statusCount: statuses.length,
        ms: Date.now() - t0,
      });
      return { sessions, statuses };
    } catch (err) {
      log.error("[scanSessions] handler FAILED", { error: String(err), ms: Date.now() - t0 });
      throw err;
    }
  });

  r("project.findSessionById", async (params) => {
    const session = await findSessionById(params.sessionId);
    return { session };
  });

  r("project.listPiProjects", async () => {
    const projects = await listPiProjects();
    return { projects };
  });

  r("project.listAllProjects", async () => {
    const projects = await listMergedProjects();
    return { projects };
  });

  r("project.listConfiguredPaths", async () => {
    const paths = await listConfiguredPaths();
    return { paths };
  });

  r("project.addConfiguredPath", async (params) => {
    await addConfiguredPath(params.path, params.name);
    return { ok: true };
  });

  r("project.removeConfiguredPath", async (params) => {
    await removeConfiguredPath(params.path);
    return { ok: true };
  });

  r("project.browseFolder", async (params) => {
    if (options.platform !== "desktop") {
      return { cancelled: true } as { path: string } | { cancelled: true };
    }
    try {
      const paths = await openFolder({ startingFolder: params.defaultPath });
      if (paths.length === 0) {
        return { cancelled: true } as { path: string } | { cancelled: true };
      }
      return { path: paths[0] } as { path: string } | { cancelled: true };
    } catch (e) {
      log.debug("project.browseFolder: openFolder failed or cancelled", { error: String(e) });
      return { cancelled: true } as { path: string } | { cancelled: true };
    }
  });

  r("project.syncTabs", async (params) => {
    await syncOpenTabs(params.tabs, params.activeTabId);
    return { ok: true };
  });

  r("project.restoreTabs", async () => {
    return restoreOpenTabs();
  });

  r("project.listDirectory", async (params) => {
    const entries = await listDirectory(params.dirPath, params.searchQuery, params.sortBy);
    return { entries };
  });

  r("project.toggleFavoriteFolder", async (params) => {
    const result = await toggleFavoriteFolder(params.folderPath);
    return { isFavorite: result.added, favorites: result.favorites };
  });

  r("project.removeFavoriteFolder", async (params) => {
    await removeFavoriteFolder(params.folderPath);
    return { ok: true };
  });

  r("project.listFavoriteFolders", async () => {
    const folders = await listFavoriteFolders();
    return { folders };
  });

  r("project.toggleProjectPin", async (params) => {
    const pinned = await toggleProjectPin(params.projectPath);
    return { pinned };
  });

  r("project.linkProject", async (params) => {
    return linkProject(params.projectRoot, params.project);
  });

  r("project.unlinkProject", async (params) => {
    return unlinkProject(params.projectRoot, params.projectId);
  });

  r("project.getLinkedProjects", async (params) => {
    const projects = await getLinkedProjects(params.projectRoot);
    return { projects };
  });

  r("project.getModelFavorites", async () => {
    const favorites = await getModelFavorites();
    return { favorites };
  });

  r("project.getAgentFavorites", async () => {
    const favorites = await getAgentFavorites();
    return { favorites };
  });

  r("project.toggleAgentFavorite", async (params) => {
    const result = await toggleAgentFavorite(params.agentName);
    return result;
  });

  r("project.toggleModelFavorite", async (params) => {
    const result = await toggleModelFavorite(params.modelKey);
    return result;
  });

  r("project.createDirectory", async (params) => {
    return createDirectory(params.parentPath, params.folderName);
  });

  r("project.listSshProfiles", async () => {
    const profiles = await listSshProfiles();
    return { profiles };
  });

  r("project.listDetectedSshHosts", async () => {
    const hosts = await listDetectedSshHosts();
    return { hosts };
  });

  r("project.upsertSshProfile", async (params) => {
    const profile = await upsertSshProfile(params);
    return { profile };
  });

  r("project.removeSshProfile", async (params) => {
    await removeSshProfile(params.profileId);
    return { ok: true };
  });

  r("project.testSshProfile", async (params) => {
    const { host, sshArgs } = await resolveSshConnection(params);
    return testSshConnection({ host, remotePath: params.remotePath, sshArgs });
  });

  r("project.listSshDirectory", async (params) => {
    const { host, sshArgs } = await resolveSshConnection(params);
    return listSshDirectory({ host, dirPath: params.dirPath, sshArgs });
  });

  r("project.createSshDirectory", async (params) => {
    const { host, sshArgs } = await resolveSshConnection(params);
    return createSshDirectory({ host, dirPath: params.dirPath, sshArgs });
  });

  r("project.previewRemoteResourceSync", async (params) => {
    const { host } = await resolveSshConnection(params);
    return previewRemoteResourceSync({
      host,
      remotePath: params.remotePath,
      resourceTypes: params.resourceTypes,
    });
  });

  r("project.getWorktreeStackManifest", async (params) => {
    return readWorktreeStackManifest(params.projectPath);
  });

  r("project.updateWorktreeStackOrchestration", async (params) => {
    const result = await updateWorktreeStackOrchestration(params.projectPath, {
      leaderSessionId: params.leaderSessionId,
      cleanup: params.cleanup,
      upsertBatches: params.upsertBatches,
      removeBatchIds: params.removeBatchIds,
      upsertIssues: params.upsertIssues,
      removeIssueIds: params.removeIssueIds,
      upsertWorkers: params.upsertWorkers,
      removeWorkerIds: params.removeWorkerIds,
    });
    if (!result.manifest) {
      throw new Error(`Worktree stack manifest not found for ${params.projectPath}`);
    }
    return { manifestPath: result.manifestPath, manifest: result.manifest };
  });

  r("project.getWorktreeStackExecutionContext", async (params) => {
    return getWorktreeStackExecutionContext({
      projectPath: params.projectPath,
      issueId: params.issueId,
      workerId: params.workerId,
    });
  });

  r("project.openSshProject", async (params) => {
    const { host, sshArgs, shell } = await resolveSshConnection(params);
    const connection = await testSshConnection({ host, remotePath: params.remotePath, sshArgs });
    if (!connection.ok) {
      throw new SshConnectionError(connection);
    }

    const opened = await openRemoteProject({
      profileId: params.profileId,
      name: params.name,
      projectName: params.projectName,
      profileName: params.profileName,
      host,
      remotePath: params.remotePath,
      sshRuntimeKind: params.sshRuntimeKind,
      remoteResourceSync: params.remoteResourceSync,
      sshArgs,
      shell,
    });
    const selectedResourceTypes = normalizeRemoteResourceTypes(
      params.remoteResourceSync?.resourceTypes,
    );
    const hasExplicitResourceTypes = Array.isArray(params.remoteResourceSync?.resourceTypes);
    const shouldSyncRemoteResources =
      getRemoteProjectSshRuntimeKind(opened.remote) === "remote-agent-child" &&
      (params.remoteResourceSync?.enabled ?? config.remoteResourceSyncEnabled) &&
      (!hasExplicitResourceTypes || selectedResourceTypes.length > 0);
    if (shouldSyncRemoteResources) {
      const remoteConnection = splitSshArgsForRemoteChild({
        target: opened.remote.host,
        sshArgs: opened.remote.sshArgs,
      });
      try {
        const syncResult = await syncRemoteAgentResources({
          target: remoteConnection.target,
          port: remoteConnection.port,
          keyPath: remoteConnection.keyPath,
          remoteShell: opened.remote.shell ?? config.remoteChildShell,
          remoteAgentDir: resolveRemoteSyncedAgentDir({
            remoteResourceAgentDir: config.remoteResourceSyncRemoteAgentDir || undefined,
            remoteChildRemoteRuntimeDir: config.remoteChildRemoteRuntimeDir,
          }),
          localAgentDir: config.remoteResourceSyncLocalAgentDir || undefined,
          resourceTypes: selectedResourceTypes.length > 0 ? selectedResourceTypes : undefined,
          extraSources: getProjectRemoteResourceExtraSources(
            opened.remote.localPath,
            selectedResourceTypes.length > 0 ? selectedResourceTypes : undefined,
          ),
        });
        log.info("synced local resources for SSH remote project", {
          host: opened.remote.host,
          remotePath: opened.remote.remotePath,
          remoteAgentDir: syncResult.remoteAgentDir,
          uploaded: syncResult.uploaded,
          hash: syncResult.hash.slice(0, 12),
          resources: syncResult.resources.map((resource) => ({
            type: resource.type,
            files: resource.files,
          })),
          blocked: syncResult.blocked.length,
        });
      } catch (err) {
        log.warn("skipping optional SSH remote resource sync after failure", {
          host: opened.remote.host,
          remotePath: opened.remote.remotePath,
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }
    const sessions = await scanSessionsForProject(opened.remote.localPath);
    const sessionCount = sessions.length;
    await addRecentProject(opened.remote.localPath, opened.remote.name, sessionCount, {
      runtime: "ssh",
      remote: opened.remote,
    });
    return {
      projectPath: opened.remote.localPath,
      name: opened.remote.name,
      sessionCount,
      tab: opened.tab,
      profile: opened.profile,
      remote: opened.remote,
    };
  });

  // ------------------------------------------------------------------
  // 快速创建项目相关 RPC
  // ------------------------------------------------------------------

  /**
   * 读取已配置的默认项目目录。
   * 首次使用快速创建时若返回 null，前端会引导用户选择并写入。
   */
  r("project.getDefaultProjectDir", async () => {
    const dir = await getDefaultProjectDir();
    return { dir };
  });

  /**
   * 持久化默认项目目录（写入 ~/.pi/chat/config.json）。
   */
  r("project.setDefaultProjectDir", async (params) => {
    await setDefaultProjectDir(params.dir);
    return { ok: true };
  });

  /**
   * 调用 pi CLI 的 print 模式 + output-schema，用轻量模型根据需求文本
   * 生成一个项目名 + 一句话描述。
   *
   * 关键点：
   * - `--output-schema` 会强制开启 print 模式，stdout 只输出 JSON 一行
   *   （takeOverStdout 把其他日志都重定向到 stderr），可直接 JSON.parse
   * - `--model <tier>` 走 tier 别名，pi CLI 通过 settings.json 的
   *   tierModels 解析为用户配置的具体模型；未配置时回退到 pi CLI 默认
   * - `--no-session` 避免在 ~/.pi 下留下一次性 session 痕迹
   * - 失败（如模型输出无法通过 schema 校验）时 exit code=1，stdout 为空，
   *   错误信息在 stderr，因此必须先看 exit code 再 parse
   */
  r("project.generateName", async (params) => {
    const requirement = params.requirement?.trim() ?? "";
    if (!requirement) {
      throw new Error("requirement must not be empty");
    }
    const tier = params.tier ?? "fast";
    const cliPath = config.piCliPath;
    if (!cliPath) {
      throw new Error("pi CLI path is not configured (PI_CLI_PATH unset)");
    }

    // Resolve the --model to pass to pi CLI. Priority:
    //   1. PI_QUICK_CREATE_MODEL (ops override; accepts "provider/id" or raw id)
    //   2. frontend `tier` ("fast"/"pro"/"max") — pi CLI resolves it through
    //      settings.json tierModels, so the user's configured model is used.
    // When both are empty we omit --model and pi CLI uses its own default.
    const quickCreateModel = process.env.PI_QUICK_CREATE_MODEL?.trim() ?? "";
    const modelArg = quickCreateModel || tier;

    const systemPrompt =
      "You are a senior software architect. Given a project requirement, " +
      "produce: (1) a concise filesystem-safe project folder name (lowercase, " +
      "kebab-case, no spaces, ASCII letters/digits/dashes only, max 40 chars, " +
      "no leading/trailing dash; must reflect the project's core purpose, not " +
      "a generic word like 'project' or 'app'); (2) a one-sentence description " +
      "in the same language as the requirement; (3) a concrete project plan " +
      "consisting of: goal (1-2 sentences on what success looks like), " +
      "techStack (3-6 concrete technologies/libraries, each as a short label " +
      "like 'React 18' or 'Vitest'), steps (4-7 ordered implementation " +
      "milestones, each one short actionable sentence), and testing (a short " +
      "paragraph describing what to test and how — unit/integration/manual). " +
      "All plan text must be in the SAME language as the requirement.";

    const schema = JSON.stringify({
      type: "object",
      properties: {
        name: {
          type: "string",
          pattern: "^[a-z0-9][a-z0-9-]*[a-z0-9]$|^[a-z0-9]$",
          maxLength: 40,
        },
        description: { type: "string", maxLength: 200 },
        plan: {
          type: "object",
          properties: {
            goal: { type: "string", maxLength: 300 },
            techStack: {
              type: "array",
              items: { type: "string", maxLength: 40 },
              minItems: 2,
              maxItems: 8,
            },
            steps: {
              type: "array",
              items: { type: "string", maxLength: 200 },
              minItems: 3,
              maxItems: 10,
            },
            testing: { type: "string", maxLength: 500 },
          },
          required: ["goal", "techStack", "steps", "testing"],
          additionalProperties: false,
        },
      },
      required: ["name", "description", "plan"],
      additionalProperties: false,
    });

    const args = [
      "-p",
      ...(modelArg ? ["--model", modelArg] : []),
      "--no-tools",
      "--no-extensions",
      "--system-prompt",
      systemPrompt,
      "--no-session",
      "--output-schema",
      schema,
      requirement,
    ];

    log.info("project.generateName: invoking pi CLI", {
      tier,
      model: modelArg || "(pi default)",
    });

    const tmpAgentDir = createIsolatedPiConfigDir();
    let stdout = "";
    let stderr = "";
    try {
      const result = await runPiCli(cliPath, args, {
        env: { ...process.env, PI_CODING_AGENT_DIR: tmpAgentDir },
        timeoutMs: 45_000,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err) {
      const e = err as {
        stdout?: string;
        stderr?: string;
        message?: string;
        code?: string | number | null;
        signal?: string | null;
      };
      stdout = e.stdout ?? "";
      stderr = e.stderr ?? e.message ?? String(err);
      log.warn("project.generateName: pi CLI failed", {
        tier,
        stderr: stderr.slice(0, 500),
        stdout: stdout.slice(0, 200),
        exitCode: e.code,
        signal: e.signal,
      });
      const failureMessage = getPiCliFailureMessage({
        stderr,
        fallback: e.message,
      });
      if (isStructuredOutputFailure(`${failureMessage}\n${stderr}\n${e.message ?? ""}`)) {
        log.warn("project.generateName: using fallback after structured output failure", {
          tier,
          failureMessage: failureMessage.slice(0, 300),
        });
        return createFallbackQuickCreateResult(requirement);
      }
      throw new Error(
        `Failed to generate project name: ${failureMessage}`,
      );
    } finally {
      rmSync(tmpAgentDir, { recursive: true, force: true });
    }

    const trimmed = stdout.trim();
    if (!trimmed) {
      log.warn("project.generateName: empty stdout", {
        stderr: stderr.slice(0, 500),
      });
      throw new Error(
        `Failed to generate project name (empty output): ${getPiCliFailureMessage({ stderr })}`,
      );
    }

    let parsed: { name?: string; description?: string; plan?: unknown };
    try {
      parsed = JSON.parse(trimmed) as { name?: string; description?: string; plan?: unknown };
    } catch {
      log.warn("project.generateName: invalid JSON", {
        stdout: trimmed.slice(0, 300),
      });
      return createFallbackQuickCreateResult(requirement);
    }

    // 兜底清洗：即便 schema 校验通过，仍可能含有不合规字符
    const safeName = sanitizeFolderName(parsed.name ?? "");
    if (!safeName) {
      throw new Error("Generated project name is invalid");
    }
    const safePlan = sanitizeQuickCreatePlan(parsed.plan);
    return {
      name: safeName,
      description: (parsed.description ?? "").trim().slice(0, 200),
      ...(safePlan ? { plan: safePlan } : {}),
    };
  });

  /**
   * 确认快速创建：在指定父目录下创建文件夹并执行 git init。
   * 成功后返回完整路径，前端拿到后调 project.open 进入开发。
   */
  r("project.confirmQuickCreate", async (params) => {
    const parentDir = params.parentDir?.trim() ?? "";
    const folderName = sanitizeFolderName(params.folderName ?? "");
    const description = params.description?.trim() ?? "";
    const plan = sanitizeQuickCreatePlan(params.plan);
    if (!parentDir) {
      return { ok: false, error: "Parent directory is required" };
    }
    if (!folderName) {
      return { ok: false, error: "Invalid folder name" };
    }
    if (!existsSync(parentDir)) {
      return { ok: false, error: `Parent directory does not exist: ${parentDir}` };
    }

    const created = await createDirectory(parentDir, folderName);
    if (!created.ok) {
      return { ok: false, error: created.error ?? "Failed to create directory" };
    }
    const projectPath = created.path;

    try {
      const readme = renderProjectReadme(folderName, description, plan);
      if (readme.trim()) {
        writeFileSync(join(projectPath, "README.md"), readme, "utf8");
      }
      const deliveryProtocol = renderQuickCreateDeliveryProtocol(folderName, description, plan);
      writeFileSync(join(projectPath, "QUICK_CREATE_DELIVERY.md"), deliveryProtocol, "utf8");
    } catch (err) {
      log.warn("project.confirmQuickCreate: write README failed (non-fatal)", {
        projectPath,
        error: String(err).slice(0, 300),
      });
    }

    try {
      await execFileAsync("git", ["init", projectPath], {
        maxBuffer: 1024 * 1024,
        timeout: 15_000,
      });
    } catch (err) {
      const e = err as { stderr?: string; message?: string };
      log.warn("project.confirmQuickCreate: git init failed (non-fatal)", {
        projectPath,
        error: (e.stderr ?? e.message ?? String(err)).slice(0, 300),
      });
      // git init 失败不阻塞，目录已创建，仍然返回 ok 让用户继续
    }
    return { ok: true, path: projectPath };
  });
}
