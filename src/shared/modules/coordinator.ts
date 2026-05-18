import type { AgentEvent } from "./agent";

export type CoordinatorSessionStatus = "idle" | "streaming" | "stopped" | "completed";

export interface CoordinatorContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface DelegatedTask {
  sessionId: string;
  title: string;
  task: string;
  projectPath: string;
  dispatchedAt: number;
  status: CoordinatorSessionStatus;
  completedAt?: number;
  result?: string;
}

export interface DelegateCreateResult {
  sessionId: string;
  status: "started" | "already_running";
}

export interface DelegateSendResult {
  delivered: boolean;
  targetStatus: "active" | "started" | "not_found";
}

export interface DelegateStatusExt {
  task: DelegatedTask | null;
  isCompacting?: boolean;
  contextUsage?: CoordinatorContextUsage;
}

export interface DelegateListResult {
  tasks: DelegatedTask[];
}

export interface CoordinatorMethods {
  "coordinator.delegate": {
    params: { task: string; title?: string };
    result: DelegateCreateResult;
  };
  "coordinator.delegate_send": {
    params: { targetSessionId: string; message: string; mode?: "followUp" | "steer" };
    result: DelegateSendResult;
  };
  "coordinator.delegate_status": {
    params: { sessionId: string };
    result: DelegateStatusExt;
  };
  "coordinator.delegate_list": {
    params: Record<string, never>;
    result: DelegateListResult;
  };
  "coordinator.delegate_stop": {
    params: { sessionId: string };
    result: { ok: boolean };
  };
  "coordinator.delegate_fork": {
    params: { sessionId: string; task: string; title?: string };
    result: DelegateCreateResult;
  };
  "coordinator.delegate_sync": {
    params: {
      task: string;
      title?: string;
      agent?: string;
      timeoutMs?: number;
    };
    result: {
      sessionId: string;
      status: "completed" | "timeout" | "error" | "aborted";
      exitCode: number;
      finalText: string;
      error?: string;
    };
  };
}

export type CoordinatorMethodCall =
  | { __call: "session_delegate"; task: string; title?: string; invokeId?: string }
  | {
      __call: "session_delegate_send";
      targetSessionId: string;
      message: string;
      mode?: "followUp" | "steer";
      invokeId?: string;
    }
  | { __call: "session_delegate_status"; sessionId: string; invokeId?: string }
  | { __call: "session_delegate_list"; invokeId?: string }
  | { __call: "session_delegate_stop"; sessionId: string; invokeId?: string }
  | {
      __call: "session_delegate_fork";
      sessionId: string;
      task: string;
      title?: string;
      invokeId?: string;
    }
  | {
      __call: "session_delegate_sync";
      task: string;
      title?: string;
      agent?: string;
      timeoutMs?: number;
      projectPath?: string;
      invokeId?: string;
    };

export type CoordinatorMethodResponse =
  | { method: "session_delegate"; result: DelegateCreateResult }
  | { method: "session_delegate_send"; result: DelegateSendResult }
  | { method: "session_delegate_status"; result: DelegateStatusExt }
  | { method: "session_delegate_list"; result: DelegateListResult }
  | { method: "session_delegate_stop"; result: { ok: boolean } }
  | { method: "session_delegate_fork"; result: DelegateCreateResult }
  | {
      method: "session_delegate_sync";
      result: {
        sessionId: string;
        status: "completed" | "timeout" | "error" | "aborted";
        exitCode: number;
        finalText: string;
        error?: string;
      };
    };

export type CoordinatorEvent =
  | { type: "message_received"; fromSessionId: string; message: string }
  | { type: "task_started"; sessionId: string; title: string; task: string }
  | { type: "task_stopped"; sessionId: string }
  | { type: "task_completed"; sessionId: string; result?: string }
  | { type: "task_error"; sessionId: string; error: string };

export type CoordinatorChannelEvent = CoordinatorMethodCall | CoordinatorEvent;

export interface CoordinatorEvents {
  "coordinator.session_created": {
    parentSessionId: string;
    session: {
      sessionId: string;
      name: string;
      sessionPath: string;
      projectPath: string;
      parentSessionPath: string | null;
      messageCount: number;
      firstMessage: string;
      createdAt: number;
      updatedAt: number;
      status: "running";
    };
  };
  "coordinator.session_event": {
    parentSessionId: string;
    childSessionId: string;
    event: AgentEvent;
  };
}
