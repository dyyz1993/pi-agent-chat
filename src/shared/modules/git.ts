/**
 * Git 模块 — 版本控制操作
 */
export interface GitMethods {
  "git.status": {
    params: { repoPath: string };
    result: {
      staged: GitFileChange[];
      changed: GitFileChange[];
      untracked: string[];
      branch: string;
      ahead: number;
      behind: number;
    };
  };
  "git.diff": {
    params: { repoPath: string; filePath: string; staged?: boolean };
    result: { filePath: string; diff: string; oldContent: string; newContent: string };
  };
  "git.log": {
    params: { repoPath: string; maxCount?: number };
    result: {
      commits: {
        hash: string;
        shortHash: string;
        message: string;
        author: string;
        date: string;
      }[];
    };
  };
  "git.commitFiles": {
    params: { repoPath: string; hash: string };
    result: { files: GitFileChange[] };
  };
  "git.commitFileDiff": {
    params: { repoPath: string; hash: string; filePath: string };
    result: { filePath: string; diff: string; oldContent: string; newContent: string };
  };
  "git.branches": {
    params: { repoPath: string };
    result: {
      branches: { name: string; isCurrent: boolean; isRemote: boolean }[];
    };
  };
  "git.checkout": {
    params: { repoPath: string; branch: string };
    result: { ok: boolean };
  };
  "git.add": {
    params: { repoPath: string; paths: string[] };
    result: { ok: boolean };
  };
  "git.reset": {
    params: { repoPath: string; paths: string[] };
    result: { ok: boolean };
  };
  "git.commit": {
    params: { repoPath: string; message: string };
    result: { hash: string; shortHash: string };
  };
  "git.push": {
    params: { repoPath: string };
    result: { ok: boolean };
  };
  "git.pull": {
    params: { repoPath: string };
    result: { ok: boolean };
  };
  "git.worktreeList": {
    params: { repoPath: string };
    result: {
      worktrees: { path: string; branch: string; isMain: boolean }[];
    };
  };
}

export interface GitFileChange {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "copied";
}
