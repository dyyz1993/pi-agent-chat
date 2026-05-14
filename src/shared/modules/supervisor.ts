export interface SupervisorStatus {
  enabled: boolean;
  state: "idle" | "checking" | "paused" | "continuing" | "disabled";
  continueCount: number;
  maxContinueCount: number;
  activeGuards: string[];
  lastCheckResult?: CheckResult;
  pendingPause?: { scheduledAt: number; delayMs: number; reason?: string };
}

export interface CheckResult {
  completed: boolean;
  confidence: number;
  incompleteTasks: IncompleteTask[];
  modelResponse?: string;
  guardResults?: GuardCheckResult[];
}

export interface IncompleteTask {
  ruleName: string;
  description: string;
  severity: "high" | "medium" | "low";
}

export interface GuardCheckResult {
  guardName: string;
  completed: boolean;
  confidence: number;
  remainingItems: string[];
  detail?: string;
}

export interface TaskReport {
  guardName: string;
  guardType: string;
  status: "completed" | "incomplete" | "unknown" | "error";
  details?: string;
  error?: string;
  remainingItems?: string[];
}

export type SupervisorChannelEvent =
  | { type: "statusChanged"; status: SupervisorStatus }
  | { type: "pauseRequested"; delayMs: number; reason?: string }
  | { type: "pauseCancelled"; reason: string }
  | { type: "continueTriggered"; reason: string; delayMs: number }
  | { type: "taskReport"; tasks: TaskReport[] };

export interface SupervisorMethods {
  "supervisor.getStatus": {
    params: { sessionId: string };
    result: SupervisorStatus;
  };
  "supervisor.requestPause": {
    params: { sessionId: string; delayMs?: number; reason?: string };
    result: { scheduled: boolean; scheduledAt?: number };
  };
  "supervisor.cancelPause": {
    params: { sessionId: string };
    result: { cancelled: boolean };
  };
  "supervisor.forceContinue": {
    params: { sessionId: string; reason?: string };
    result: { triggered: boolean };
  };
  "supervisor.disable": {
    params: { sessionId: string };
    result: { disabled: boolean };
  };
  "supervisor.enable": {
    params: { sessionId: string };
    result: { enabled: boolean };
  };
  "supervisor.getTaskReport": {
    params: { sessionId: string };
    result: { tasks: TaskReport[] };
  };
  "supervisor.checkToolStatus": {
    params: { sessionId: string; toolName: string; channelName?: string; method?: string };
    result: { reachable: boolean; status?: string; error?: string };
  };
}

export interface SupervisorEvents {
  "supervisor.event": { sessionId: string; event: SupervisorChannelEvent };
}
