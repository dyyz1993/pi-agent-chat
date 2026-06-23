import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { existsSync } from "fs";
import { execFile } from "child_process";
import { basename } from "path";
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
import type { SessionStatus, SshDirectoryEntry } from "../modules/project";
import { listDetectedSshHosts } from "../lib/ssh-config";

const log = createLogger("config");
const execFileAsync = promisify(execFile);

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function joinRemotePath(base: string, name: string): string {
  const cleanBase = base.trim().replace(/\/+$/, "");
  const cleanName = name.replace(/^\/+/, "");
  if (!cleanBase || cleanBase === ".") return cleanName || ".";
  if (cleanBase === "/") return `/${cleanName}`;
  return `${cleanBase}/${cleanName}`;
}

function directoryTarget(path?: string): string {
  const trimmed = path?.trim();
  return trimmed ? shellQuote(trimmed) : '"$HOME"';
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
}): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  const host = input.host.trim();
  if (!host) return { ok: false, stdout: "", stderr: "", error: "SSH host is required" };
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
    return {
      ok: false,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
      error: e.message,
    };
  }
}

async function testSshConnection(input: {
  host: string;
  remotePath?: string;
  sshArgs?: string[];
}): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  const remotePath = input.remotePath?.trim();
  const command = remotePath
    ? `cd ${shellQuote(remotePath)} && printf 'pi-agent-chat-ssh-ok\\n' && pwd`
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
  if (!result.ok) return { ...result, path: input.dirPath?.trim() ?? "", entries: [] };

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
  const dirPath = input.dirPath.trim();
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

  r("project.openSshProject", async (params) => {
    const { host, sshArgs, shell } = await resolveSshConnection(params);
    const connection = await testSshConnection({ host, remotePath: params.remotePath, sshArgs });
    if (!connection.ok) {
      throw new Error(connection.error ?? connection.stderr ?? "SSH connection failed");
    }

    const opened = await openRemoteProject({
      profileId: params.profileId,
      name: params.name,
      projectName: params.projectName,
      profileName: params.profileName,
      host,
      remotePath: params.remotePath,
      sshArgs,
      shell,
    });
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
