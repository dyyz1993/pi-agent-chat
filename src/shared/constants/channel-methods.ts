/**
 * Channel method names — single source of truth.
 *
 * Frontend handlers call:  callChannel(sid, "file-review", METHOD, ...)
 * Backend extension handles: channel.handle(METHOD, ...)
 *
 * Keep this list in sync with the backend extension's channel.handle() calls.
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
} as const;

// ---- lsp channel ----
export const LSP_METHODS = {
  SET_MODE: "lsp.setMode",
  GET_ACTIVE_LANGUAGES: "getActiveLanguages",
  GET_STATUS: "getStatus",
} as const;

// ---- memory channel ----
export const MEMORY_METHODS = {
  LIST: "memory.list",
  USER_REMEMBER: "memory.userRemember",
  MARK_IRRELEVANT: "memory.markIrrelevant",
  GET_STATUS: "memory.getStatus",
  REMOVE_RULE: "memory.removeRule",
  ADD_RULE: "memory.addRule",
} as const;

// ---- supervisor channel ----
export const SUPERVISOR_METHODS = {
  GET_STATUS: "getStatus",
  REQUEST_PAUSE: "requestPause",
  CANCEL_PAUSE: "cancelPause",
  FORCE_CONTINUE: "forceContinue",
  DISABLE: "disable",
  ENABLE: "enable",
  GET_TASK_REPORT: "getTaskReport",
  CHECK_TOOL_STATUS: "checkToolStatus",
  SET_GOAL: "setGoal",
  CLEAR_GOAL: "clearGoal",
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

/** All valid channel method names (flat set for O(1) lookup) */
export const ALL_CHANNEL_METHODS: ReadonlySet<string> = new Set([
  ...Object.values(FILE_REVIEW_METHODS),
  ...Object.values(FILE_SNAPSHOT_METHODS),
  ...Object.values(BASH_METHODS),
  ...Object.values(HOOKS_METHODS),
  ...Object.values(LSP_METHODS),
  ...Object.values(MEMORY_METHODS),
  ...Object.values(SUPERVISOR_METHODS),
  ...Object.values(RULES_METHODS),
  ...Object.values(COORDINATOR_METHODS),
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
  supervisor: new Set(Object.values(SUPERVISOR_METHODS)),
  "rules-engine": new Set(Object.values(RULES_METHODS)),
  coordinator: new Set(Object.values(COORDINATOR_METHODS)),
};
