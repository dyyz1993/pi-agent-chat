export interface PersistedTab {
  id: string;
  name: string;
  path: string;
  runtime?: ProjectRuntime;
  remote?: RemoteProjectRef;
}

export type ProjectRuntime = "local" | "ssh";
export type SshRuntimeKind = "remote-agent-child" | "ssh-command";
export type RemoteSyncResourceType = "skills" | "agents" | "rules";
export type WorktreeIssueStatus = "planned" | "ready" | "in_progress" | "blocked" | "done";
export type WorktreeWorkerStatus = "idle" | "assigned" | "running" | "blocked" | "done";
export type WorktreeIssuePriority = "low" | "medium" | "high";
export type WorktreeBatchStatus = "planned" | "active" | "blocked" | "done";

export interface QuickCreatePlan {
  goal: string;
  techStack: string[];
  steps: string[];
  testing: string;
}

export interface RemoteResourceSyncConfig {
  enabled?: boolean;
  resourceTypes?: RemoteSyncResourceType[];
}

export interface RemoteResourceSyncPreview {
  resources: Array<{
    type: RemoteSyncResourceType;
    files: number;
    bytes: number;
    sources: string[];
  }>;
  blocked: Array<{
    path: string;
    reason: string;
  }>;
  hash: string;
}

export interface WorktreeStackRepoEntry {
  name: string;
  role: "app" | "runtime-fork";
  repoPath: string;
  worktreePath: string;
  branch: string;
}

export interface WorktreeStackServiceEntry {
  name: string;
  role: "api" | "web";
  cwd: string;
  command: string;
  port: number;
  healthUrl: string;
}

export interface WorktreeStackIssueEntry {
  id: string;
  title: string;
  status: WorktreeIssueStatus;
  priority: WorktreeIssuePriority;
  repo?: "app" | "fork" | "both";
  batchId?: string | null;
  dependsOnIssueIds: string[];
  assigneeWorkerId?: string | null;
  branch?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeStackBatchEntry {
  id: string;
  title: string;
  status: WorktreeBatchStatus;
  issueIds: string[];
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeStackWorkerEntry {
  id: string;
  agent: string;
  status: WorktreeWorkerStatus;
  issueId?: string | null;
  sessionId?: string | null;
  repo?: "app" | "fork" | "both";
  branch?: string | null;
  worktreePath?: string | null;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorktreeStackCleanupPlan {
  removeWorktrees: boolean;
  removeRegistry: boolean;
}

export interface WorktreeStackExecutionContext {
  manifestPath: string;
  manifest: WorktreeStackManifest;
  appRepo: WorktreeStackRepoEntry | null;
  runtimeForkRepo: WorktreeStackRepoEntry | null;
  apiService: WorktreeStackServiceEntry | null;
  webService: WorktreeStackServiceEntry | null;
  batch: WorktreeStackBatchEntry | null;
  issue: WorktreeStackIssueEntry | null;
  worker: WorktreeStackWorkerEntry | null;
  targetRepoRoles: Array<"app" | "runtime-fork">;
  targetAppWorktreePath: string | null;
  targetRuntimeForkWorktreePath: string | null;
}

export interface WorktreeStackManifest {
  version: 1;
  id: string;
  kind: "paired-worktree-stack";
  name: string;
  createdAt: string;
  updatedAt: string;
  repos: WorktreeStackRepoEntry[];
  services: WorktreeStackServiceEntry[];
  appConfigDir: string;
  agentDir: string;
  runtime: {
    piCliPath: string;
  };
  orchestration: {
    leaderSessionId: string | null;
    batches: WorktreeStackBatchEntry[];
    issues: WorktreeStackIssueEntry[];
    workers: WorktreeStackWorkerEntry[];
    cleanup: WorktreeStackCleanupPlan;
  };
}

export interface WorktreeStackIssuePatch {
  id: string;
  title?: string;
  status?: WorktreeIssueStatus;
  priority?: WorktreeIssuePriority;
  repo?: "app" | "fork" | "both";
  batchId?: string | null;
  dependsOnIssueIds?: string[];
  assigneeWorkerId?: string | null;
  branch?: string | null;
  note?: string | null;
}

export interface WorktreeStackBatchPatch {
  id: string;
  title?: string;
  status?: WorktreeBatchStatus;
  issueIds?: string[];
  note?: string | null;
}

export interface WorktreeStackWorkerPatch {
  id: string;
  agent?: string;
  status?: WorktreeWorkerStatus;
  issueId?: string | null;
  sessionId?: string | null;
  repo?: "app" | "fork" | "both";
  branch?: string | null;
  worktreePath?: string | null;
  note?: string | null;
}

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

export type SshConnectionErrorCode =
  | "missing-host"
  | "auth-failed"
  | "timeout"
  | "host-unreachable"
  | "host-key"
  | "ssh-config"
  | "remote-path"
  | "permission-denied"
  | "command-failed";

export interface SshCommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
  errorCode?: SshConnectionErrorCode;
}

export interface RemoteProjectRef {
  runtime: "ssh";
  sshRuntimeKind?: SshRuntimeKind;
  profileId: string;
  host: string;
  remotePath: string;
  localPath: string;
  shell?: string;
  sshArgs?: string[];
  remoteResourceSync?: RemoteResourceSyncConfig;
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
export type SessionStatus = "idle" | "streaming" | "compacting" | "permission" | "retrying";

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
  "project.getAgentFavorites": {
    params: {};
    result: { favorites: string[] };
  };
  "project.toggleAgentFavorite": {
    params: { agentName: string };
    result: { added: boolean; favorites: string[] };
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
    result: SshCommandResult;
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
      errorCode?: SshConnectionErrorCode;
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
    result: SshCommandResult & { path: string };
  };
  "project.previewRemoteResourceSync": {
    params: {
      profileId?: string;
      host?: string;
      remotePath?: string;
      resourceTypes?: RemoteSyncResourceType[];
    };
    result: RemoteResourceSyncPreview;
  };
  "project.getWorktreeStackManifest": {
    params: { projectPath: string };
    result: { manifestPath: string; manifest: WorktreeStackManifest | null };
  };
  "project.updateWorktreeStackOrchestration": {
    params: {
      projectPath: string;
      leaderSessionId?: string | null;
      cleanup?: Partial<WorktreeStackCleanupPlan>;
      upsertBatches?: WorktreeStackBatchPatch[];
      removeBatchIds?: string[];
      upsertIssues?: WorktreeStackIssuePatch[];
      removeIssueIds?: string[];
      upsertWorkers?: WorktreeStackWorkerPatch[];
      removeWorkerIds?: string[];
    };
    result: { manifestPath: string; manifest: WorktreeStackManifest };
  };
  "project.getWorktreeStackExecutionContext": {
    params: { projectPath: string; issueId?: string; workerId?: string };
    result: WorktreeStackExecutionContext;
  };
  "project.openSshProject": {
    params: {
      profileId?: string;
      name?: string;
      projectName?: string;
      profileName?: string;
      host: string;
      remotePath: string;
      sshRuntimeKind?: SshRuntimeKind;
      remoteResourceSync?: RemoteResourceSyncConfig;
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
  "project.generateName": {
    params: { requirement: string; tier?: "fast" | "pro" | "max" };
    result: {
      name: string;
      description: string;
      plan?: QuickCreatePlan;
    };
  };
  "project.confirmQuickCreate": {
    params: {
      parentDir: string;
      folderName: string;
      description?: string;
      plan?: QuickCreatePlan;
    };
    result: { ok: boolean; path?: string; error?: string };
  };
  "project.getDefaultProjectDir": {
    params: {};
    result: { dir: string | null };
  };
  "project.setDefaultProjectDir": {
    params: { dir: string };
    result: { ok: boolean };
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
  agent?: string;
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
