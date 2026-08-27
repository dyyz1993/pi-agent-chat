/**
 * Channel method names — single source of truth.
 *
 * Frontend handlers call:  callChannel(sid, "file-review", METHOD, ...)
 * Backend extension handles: channel.handle(METHOD, ...)
 *
 * NOTE: 这些常量目前主要用于文档/参考和 ESLint 校验（`rpc/valid-channel-method` 规则
 * 在 lint 时正则解析本文件中的字符串值来构建合法方法名集合）。
 * 大部分 handler 目前直接硬编码 channel method 字符串，仅 change-review.ts 使用了
 * FILE_REVIEW_METHODS 常量。其他常量组保留在此作为权威方法名录，不要删除。
 *
 * The ESLint rule `rpc/valid-channel-method` reads this file at lint time.
 */

// ---- file-review channel ----
export const FILE_REVIEW_METHODS = {
  LIVE: "review.live",
  HISTORY: "review.history",
  SUMMARY: "review.summary",
  FILE_HISTORY: "review.fileHistory",
  CLEAR: "review.clear",
  PENDING: "review.pending",
  APPROVE: "review.approve",
  REJECT: "review.reject",
  APPROVE_ALL: "review.approveAll",
  REJECT_ALL: "review.rejectAll",
  APPROVALS: "review.approvals",
} as const;

// ---- file-snapshot channel ----
export const FILE_SNAPSHOT_METHODS = {
  LIST: "snapshot.list",
  ROLLBACK: "snapshot.rollback",
  UNREVERT: "snapshot.unrevert",
  GET: "snapshot.get",
  RESTORE_BY_HASH: "snapshot.restoreByHash",
  GC: "snapshot.gc",
  PRUNE: "snapshot.prune",
  STATS: "snapshot.stats",
  ENFORCE_LIMIT: "snapshot.enforceLimit",
} as const;

// ---- bash-ext channel ----
export const BASH_METHODS = {
  LIST: "list",
  KILL: "kill",
  BACKGROUND: "background",
  SUBSCRIBE_OUTPUT: "subscribe_output",
  UNSUBSCRIBE_OUTPUT: "unsubscribe_output",
  REMOVE: "remove",
  WRITE_STDIN: "write_stdin",
} as const;

// ---- hooks-engine channel ----
export const HOOKS_METHODS = {
  GET_LOG: "hooks.getLog",
  GET_CONFIG: "hooks.getConfig",
  CLEAR: "hooks.clear",
  GET_STATUS: "hooks.getStatus",
  SET_ENABLED: "hooks.setEnabled",
  SKIP_RULE: "hooks.skipRule",
  UNSKIP_RULE: "hooks.unskipRule",
  GET_SKIPPED_RULES: "hooks.getSkippedRules",
} as const;

// ---- lsp channel ----
export const LSP_METHODS = {
  SET_MODE: "lsp.setMode",
  GET_ACTIVE_LANGUAGES: "getActiveLanguages",
  GET_STATUS: "getStatus",
} as const;

// ---- learning channel memory methods ----
export const MEMORY_METHODS = {
  LIST: "learning.memory.list",
  USER_REMEMBER: "learning.memory.userRemember",
  MARK_IRRELEVANT: "learning.memory.markIrrelevant",
  GET_STATUS: "learning.memory.getStatus",
  REMOVE_RULE: "learning.memory.removeRule",
  ADD_RULE: "learning.memory.addRule",
} as const;

// ---- learning channel ----
export const LEARNING_METHODS = {
  GET_SNAPSHOT: "learning.getSnapshot",
  SET_CONFIG: "learning.setConfig",
  LIST_CANDIDATES: "learning.listCandidates",
  APPROVE_CANDIDATE: "learning.approveCandidate",
  REJECT_CANDIDATE: "learning.rejectCandidate",
  RUN_CURATOR: "learning.runCurator",
} as const;

// ---- goal channel (goal-vendor extension) ----
export const GOAL_METHODS = {
  GET_STATUS: "getStatus",
  START_SETUP: "startSetup",
  SUBMIT_CONTRACT: "submitContract",
  APPROVE_CONTRACT: "approveContract",
  APPROVE_AUTHORITY_AMENDMENT: "approveAuthorityAmendment",
  REJECT_AUTHORITY_AMENDMENT: "rejectAuthorityAmendment",
  REJECT_CONTRACT: "rejectContract",
  CLEAR_GOAL: "clearGoal",
  FORCE_CONTINUE: "forceContinue",
  DISABLE: "disable",
  ENABLE: "enable",
  GET_TASK_REPORT: "getTaskReport",
  GET_TRIGGER_HISTORY: "getTriggerHistory",
  REFINE_GOAL: "refineGoal",
  CHECK_TOOL_STATUS: "checkToolStatus",
} as const;

// ---- rules-engine channel ----
export const RULES_METHODS = {
  GET_SNAPSHOT: "getSnapshot",
} as const;

// ---- coordinator channel ----
export const COORDINATOR_METHODS = {
  DELEGATE: "session_delegate",
  DELEGATE_SEND: "session_delegate_send",
  DELEGATE_STATUS: "session_delegate_status",
  DELEGATE_LIST: "session_delegate_list",
  DELEGATE_STOP: "session_delegate_stop",
  DELEGATE_REMOVE: "session_delegate_remove",
  DELEGATE_CLEAR_STOPPED: "session_delegate_clear_stopped",
  DELEGATE_FORK: "session_delegate_fork",
  DELEGATE_SYNC: "session_delegate_sync",
} as const;

// ---- remote-ssh channel ----
export const REMOTE_SSH_METHODS = {
  GET_STATUS: "getStatus",
  CONFIGURE: "configure",
  DISABLE: "disable",
  TEST_CONNECTION: "testConnection",
  SMOKE_TEST: "smokeTest",
} as const;

/** All valid channel method names (flat set for O(1) lookup) */
export const ALL_CHANNEL_METHODS: ReadonlySet<string> = new Set([
  ...Object.values(FILE_REVIEW_METHODS),
  ...Object.values(FILE_SNAPSHOT_METHODS),
  ...Object.values(BASH_METHODS),
  ...Object.values(HOOKS_METHODS),
  ...Object.values(LSP_METHODS),
  ...Object.values(MEMORY_METHODS),
  ...Object.values(LEARNING_METHODS),
  ...Object.values(GOAL_METHODS),
  ...Object.values(RULES_METHODS),
  ...Object.values(COORDINATOR_METHODS),
  ...Object.values(REMOTE_SSH_METHODS),
  "getStatus",
  "getConfig",
]);

/** Channel name → valid methods mapping */
export const CHANNEL_METHOD_MAP: Readonly<Record<string, ReadonlySet<string>>> = {
  "file-review": new Set(Object.values(FILE_REVIEW_METHODS)),
  "file-snapshot": new Set(Object.values(FILE_SNAPSHOT_METHODS)),
  "bash-ext": new Set(Object.values(BASH_METHODS)),
  "hooks-engine": new Set(Object.values(HOOKS_METHODS)),
  hooks: new Set(Object.values(HOOKS_METHODS)),
  lsp: new Set(Object.values(LSP_METHODS)),
  memory: new Set(Object.values(MEMORY_METHODS)),
  learning: new Set(Object.values(LEARNING_METHODS)),
  goal: new Set(Object.values(GOAL_METHODS)),
  "rules-engine": new Set(Object.values(RULES_METHODS)),
  coordinator: new Set(Object.values(COORDINATOR_METHODS)),
  "remote-ssh": new Set(Object.values(REMOTE_SSH_METHODS)),
  "loop-scheduler": new Set(["list", "create", "update", "toggle", "remove", "getStatus", "becomeScheduler"]),
};
