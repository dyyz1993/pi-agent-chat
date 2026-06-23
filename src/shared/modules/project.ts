export interface PersistedTab {
  id: string;
  name: string;
  path: string;
  runtime?: ProjectRuntime;
  remote?: RemoteProjectRef;
}

export type ProjectRuntime = "local" | "ssh";

export interface SshProfile {
  id: string;
  name: string;
  host: string;
  sshArgs?: string[];
  shell?: string;
  createdAt: number;
  updatedAt: number;
}

export interface DetectedSshHost {
  host: string;
  name: string;
  source: string;
  hostName?: string;
  user?: string;
  port?: string;
  identityFile?: string;
}

export interface SshDirectoryEntry {
  name: string;
  path: string;
  isDirectory: true;
}

export interface RemoteProjectRef {
  runtime: "ssh";
  profileId: string;
  host: string;
  remotePath: string;
  localPath: string;
  shell?: string;
  sshArgs?: string[];
}

export interface RemoteProjectRecord extends RemoteProjectRef {
  id: string;
  name: string;
  createdAt: number;
  lastOpened: number;
}

/**
 * 前端展示用的 session 状态。RPC schema 与前端 store 共用此类型，
 * server handler 负责把进程池内部的 "stopped" 映射成 "idle" 再返回。
 * 不允许 "stopped" 出现在前端（前端用颜色/角标区分 idle/stopped 没意义）。
 */
export type SessionStatus =
  | "idle"
  | "streaming"
  | "compacting"
  | "permission"
  | "retrying";

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
    result: {
      sessions: SessionMeta[];
      // 与 sessions 同一 RPC 返回，避免前端再发一次 batchGetSessionsStatus。
      // status 已经是 SessionStatus（server handler 在边界做 "stopped"→"idle" 映射），
      // 前端拿到后可以直接写 store，不需要再做白名单校验。
      statuses: Array<{ sessionId: string; status: SessionStatus }>;
    };
  };
  "project.findSessionById": {
    params: { sessionId: string };
    result: { session: (SessionMeta & { sessionPath: string }) | null };
  };
  "project.listPiProjects": {
    params: {};
    result: { projects: PiProject[] };
  };
  "project.browseFolder": {
    params: { defaultPath?: string };
    result: { path: string } | { cancelled: true };
  };
  "project.addConfiguredPath": {
    params: { path: string; name?: string };
    result: { ok: boolean };
  };
  "project.removeConfiguredPath": {
    params: { path: string };
    result: { ok: boolean };
  };
  "project.listConfiguredPaths": {
    params: {};
    result: { paths: ConfiguredPath[] };
  };
  "project.listAllProjects": {
    params: {};
    result: { projects: MergedProject[] };
  };
  "project.syncTabs": {
    params: { tabs: PersistedTab[]; activeTabId: string | null };
    result: { ok: boolean };
  };
  "project.restoreTabs": {
    params: {};
    result: { tabs: PersistedTab[]; activeTabId: string | null };
  };
  "project.listDirectory": {
    params: { dirPath: string; searchQuery?: string; sortBy?: "name" | "mtime" };
    result: { entries: DirectoryEntry[] };
  };
  "project.toggleFavoriteFolder": {
    params: { folderPath: string };
    result: { isFavorite: boolean; favorites: FavoriteFolder[] };
  };
  "project.removeFavoriteFolder": {
    params: { folderPath: string };
    result: { ok: boolean };
  };
  "project.listFavoriteFolders": {
    params: {};
    result: { folders: FavoriteFolder[] };
  };
  "project.createDirectory": {
    params: { parentPath: string; folderName: string };
    result: { ok: boolean; path: string; error?: string };
  };
  "project.toggleProjectPin": {
    params: { projectPath: string };
    result: { pinned: boolean };
  };
  "project.linkProject": {
    params: { projectRoot: string; project: LinkedProjectConfig };
    result: LinkedProjectResult;
  };
  "project.unlinkProject": {
    params: { projectRoot: string; projectId: string };
    result: LinkedProjectResult;
  };
  "project.getLinkedProjects": {
    params: { projectRoot: string };
    result: { projects: LinkedProjectConfig[] };
  };
  "project.getModelFavorites": {
    params: {};
    result: { favorites: string[] };
  };
  "project.toggleModelFavorite": {
    params: { modelKey: string };
    result: { added: boolean; favorites: string[] };
  };
  "project.listSshProfiles": {
    params: {};
    result: { profiles: SshProfile[] };
  };
  "project.listDetectedSshHosts": {
    params: {};
    result: { hosts: DetectedSshHost[] };
  };
  "project.upsertSshProfile": {
    params: { id?: string; name: string; host: string; sshArgs?: string[]; shell?: string };
    result: { profile: SshProfile };
  };
  "project.removeSshProfile": {
    params: { profileId: string };
    result: { ok: boolean };
  };
  "project.testSshProfile": {
    params: {
      profileId?: string;
      host?: string;
      remotePath?: string;
      sshArgs?: string[];
      shell?: string;
    };
    result: { ok: boolean; stdout: string; stderr: string; error?: string };
  };
  "project.listSshDirectory": {
    params: {
      profileId?: string;
      host?: string;
      dirPath?: string;
      sshArgs?: string[];
      shell?: string;
    };
    result: {
      ok: boolean;
      path: string;
      entries: SshDirectoryEntry[];
      stdout: string;
      stderr: string;
      error?: string;
    };
  };
  "project.createSshDirectory": {
    params: {
      profileId?: string;
      host?: string;
      dirPath: string;
      sshArgs?: string[];
      shell?: string;
    };
    result: { ok: boolean; path: string; stdout: string; stderr: string; error?: string };
  };
  "project.openSshProject": {
    params: {
      profileId?: string;
      name?: string;
      projectName?: string;
      profileName?: string;
      host: string;
      remotePath: string;
      sshArgs?: string[];
      shell?: string;
    };
    result: {
      projectPath: string;
      name: string;
      sessionCount: number;
      tab: PersistedTab;
      profile: SshProfile;
      remote: RemoteProjectRecord;
    };
  };
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
  pinned: boolean;
  sessionCount: number;
  runtime?: ProjectRuntime;
  remote?: RemoteProjectRef;
}

export interface PiProject {
  path: string;
  name: string;
  sessionCount: number;
  lastModified: number;
  hasActiveSession: boolean;
}

export interface ConfiguredPath {
  path: string;
  name: string;
  type: "home" | "documents" | "custom";
}

export interface MergedProject {
  path: string;
  name: string;
  source: "pi" | "recent" | "configured";
  sessionCount: number;
  lastModified: number;
  hasActiveSession: boolean;
}

export interface SessionMeta {
  sessionId: string;
  name: string;
  sessionPath: string;
  projectPath: string;
  parentSessionPath: string | null;
  delegateParentSessionId: string | null;
  delegateType: string | null;
  messageCount: number;
  firstMessage: string;
  createdAt: number;
  updatedAt: number;
  status: "idle" | "running";
  pinned?: boolean;
  tierConfig?: {
    tierModels: Record<string, string>;
    currentTier: string | null;
  };
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  mtime?: number;
}

export interface FavoriteFolder {
  path: string;
  name: string;
  addedAt: number;
}

export interface LinkedProjectConfig {
  id: string;
  path: string;
  description: string;
  relationship: "upstream" | "downstream" | "sibling";
  keyPaths: Array<{ path: string; description: string }>;
  readonly: boolean;
}

export interface LinkedProjectResult {
  ok: boolean;
  error?: string;
}
