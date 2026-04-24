import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import { existsSync } from "fs";
import { basename } from "path";
import { addRecentProject, listRecentProjects, removeRecentProject } from "../lib/project-config";
import { scanSessionsForProject, scanAllProjects } from "../lib/session-scanner";

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

export function register(server: RPCServer, _options: HandlerOptions): void {
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
}
