import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import { existsSync } from "fs";
import { basename } from "path";
import { addRecentProject, listRecentProjects, removeRecentProject, listConfiguredPaths, addConfiguredPath, removeConfiguredPath, syncOpenTabs, restoreOpenTabs, listDirectory, removeFavoriteFolder, listFavoriteFolders, toggleProjectPin, toggleFavoriteFolder } from "../lib/project-config";
import { scanSessionsForProject, scanAllProjects, listPiProjects, listMergedProjects, findSessionById } from "../lib/session-scanner";
import { openFolder } from "../lib/native-dialog";
import { linkProject, unlinkProject, getLinkedProjects } from "../lib/linked-projects-config";

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

export function register(server: RPCServer, options: HandlerOptions): void {
  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

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
    const sessions = await scanSessionsForProject(params.projectPath);
    return { sessions };
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
    } catch {
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
    const entries = await listDirectory(params.dirPath, params.searchQuery);
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
}
