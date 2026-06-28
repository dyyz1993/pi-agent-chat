import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { existsSync, rmSync } from "fs";
import { execFile } from "child_process";
import { basename, join } from "path";
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
  getModelFavorites,
  toggleModelFavorite,
  createDirectory,
  listSshProfiles,
  getSshProfile,
  upsertSshProfile,
  removeSshProfile,
  openRemoteProject,
  listRemoteProjects,
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

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
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
}
