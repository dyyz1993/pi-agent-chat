export interface ProjectMethods {
  "project.open": {
    params: { path: string };
    result: { projectPath: string; name: string; sessionCount: number };
  };
  "project.listRecent": {
    params: {};
    result: { projects: RecentProject[] };
  };
  "project.removeRecent": {
    params: { projectPath: string };
    result: { ok: boolean };
  };
  "project.scanSessions": {
    params: { projectPath: string };
    result: { sessions: SessionMeta[] };
  };
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
  pinned: boolean;
  sessionCount: number;
}

export interface SessionMeta {
  sessionId: string;
  name: string;
  sessionPath: string;
  projectPath: string;
  parentSessionPath: string | null;
  messageCount: number;
  firstMessage: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running";
}
