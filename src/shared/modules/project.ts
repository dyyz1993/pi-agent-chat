export interface PersistedTab {
  id: string;
  name: string;
  path: string;
}

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
    params: { dirPath: string; searchQuery?: string };
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
}

export interface RecentProject {
  path: string;
  name: string;
  lastOpened: number;
  pinned: boolean;
  sessionCount: number;
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
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
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
