/**
 * Goal channel types — mirrors the GoalChannelContract from
 * pi-momo-fork/extensions/goal-vendor/channel-contract.ts.
 *
 * The "goal" channel is the vendored misunders2d/pi-goal extension's
 * control surface, adapted from the legacy "supervisor" channel.
 * It uses a contract-based model (setup → approve → execute → verify → audit)
 * with machine-executable verification.
 */

/** Flattened status projected from misunders2d GoalStatus + GoalPhase. */
export interface GoalVendorStatus {
  enabled: boolean;
  state: "idle" | "setup" | "running" | "checking" | "paused" | "blocked" | "disabled";
  rawStatus: string;
  rawPhase: string;
  continuationSequence: number;
  turnCount: number;
  objective?: string;
  goalId?: string;
  generation?: number;
  interrupt?: GoalVendorInterruptSummary;
}

export interface GoalVendorAuthoritySummary {
  id: string;
  label: string;
  actionClass: string;
  toolName: string;
  command?: {
    executable: string;
    argsPrefix: string[];
    trailingArgs: string;
  };
  maxUses: number;
  expiresAt?: string;
}

export interface GoalVendorPendingAuthorityAmendmentSummary {
  rationale: string;
  requestedAt: string;
  authorities: GoalVendorAuthoritySummary[];
}

export interface GoalVendorInterruptSummary {
  class: string;
  message: string;
  attempts: string[];
  need: string;
  recommendation: string;
  createdAt: string;
  pendingAuthorityAmendment?: GoalVendorPendingAuthorityAmendmentSummary;
}

/** Per-criterion task report projected from misunders2d audit/evidence. */
export interface GoalVendorTaskItem {
  id: string;
  label: string;
  status: string;
  hasEvidence: boolean;
}

/** Event log entry from events.jsonl. */
export interface GoalVendorTriggerRecord {
  goalId?: string;
  seq: number;
  eventType: string;
  summary: string;
  revision: number;
  timestamp: string;
}

export interface GoalDraftCommandInvocation {
  executable: string;
  args: string[];
  cwd?: string;
  actionClasses?: string[];
}

export type GoalDraftVerificationCheck =
  | { id: string; kind: "file_exists"; label: string; path: string }
  | { id: string; kind: "file_contains"; label: string; path: string; pattern: string; regex?: boolean }
  | { id: string; kind: "json_equals"; label: string; path: string; pointer: string; value: unknown }
  | {
      id: string;
      kind: "command_exit";
      label: string;
      executable: string;
      args: string[];
      cwd?: string;
      expectedExitCode?: number;
      timeoutMs?: number;
    }
  | { id: string; kind: "git_status"; label: string; cwd?: string; clean?: boolean }
  | { id: string; kind: "git_diff"; label: string; cwd?: string; empty?: boolean; paths?: string[] };

export interface GoalDraftAuthority {
  id: string;
  label: string;
  actionClass: string;
  toolName: string;
  targets: Array<{ path: string; equals: string | number | boolean | null }>;
  command?: {
    executable: string;
    argsPrefix: string[];
    trailingArgs: "none" | "any" | "workspace_paths" | "single_value";
  };
  inputHash?: string;
  maxUses: number;
  expiresAt?: string;
}

export interface GoalDraftContract {
  outcome: string;
  workspaceRoots?: string[];
  criteria: string[];
  phases: Array<{
    id?: string;
    title: string;
    description?: string;
    commands?: GoalDraftCommandInvocation[];
    dependsOn?: string[];
    criterionIds?: string[];
  }>;
  verificationChecks: GoalDraftVerificationCheck[];
  authorities: GoalDraftAuthority[];
  constraints: string[];
  nonGoals: string[];
}

/** Channel events emitted by the goal-vendor extension (4 types). */
export type GoalChannelEvent =
  | { type: "statusChanged"; status: GoalVendorStatus }
  | { type: "goalChanged"; goalId?: string; status?: string; reason?: string }
  | { type: "taskReport"; tasks: GoalVendorTaskItem[] }
  | { type: "continueTriggered"; goalId: string; reason: string };

export interface GoalMethods {
  "goal.getStatus": {
    params: { sessionId: string };
    result: GoalVendorStatus;
  };
  "goal.startSetup": {
    params: { sessionId: string; objective: string };
    result: { started: boolean; goalId?: string; error?: string };
  };
  "goal.submitContract": {
    params: { sessionId: string; contract: GoalDraftContract };
    result: { submitted: boolean; goalId?: string; status?: string; error?: string };
  };
  "goal.approveContract": {
    params: { sessionId: string };
    result: { approved: boolean; error?: string };
  };
  "goal.approveAuthorityAmendment": {
    params: { sessionId: string };
    result: { approved: boolean; count?: number; error?: string };
  };
  "goal.rejectContract": {
    params: { sessionId: string; reason?: string };
    result: { rejected: boolean };
  };
  "goal.clearGoal": {
    params: { sessionId: string; reason?: string };
    result: { cleared: boolean };
  };
  "goal.forceContinue": {
    params: { sessionId: string; reason?: string };
    result: { triggered: boolean };
  };
  "goal.disable": {
    params: { sessionId: string };
    result: { disabled: boolean };
  };
  "goal.enable": {
    params: { sessionId: string };
    result: { enabled: boolean };
  };
  "goal.getTaskReport": {
    params: { sessionId: string };
    result: { tasks: GoalVendorTaskItem[] };
  };
  "goal.getTriggerHistory": {
    params: { sessionId: string; limit?: number };
    result: { triggers: GoalVendorTriggerRecord[] };
  };
  "goal.refineGoal": {
    params: { sessionId: string; objective: string };
    result: { success: boolean; objective?: string; error?: string };
  };
  "goal.checkToolStatus": {
    params: { sessionId: string; toolName: string; channelName?: string; method?: string };
    result: { reachable: boolean; status?: string; error?: string };
  };
}

export interface GoalEvents {
  "goal.event": { sessionId: string; event: GoalChannelEvent };
}
