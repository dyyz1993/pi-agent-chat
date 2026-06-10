import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { existsSync } from "fs";
import { basename } from "path";
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
import type { SessionStatus } from "../modules/project";

const log = createLogger("config");

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
}
