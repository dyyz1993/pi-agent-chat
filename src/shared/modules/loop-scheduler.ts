/**
 * Loop Scheduler module types — RPC methods + events for loop-scheduler extension.
 */

export interface LoopConfig {
  id: string;
  name: string;
  enabled: boolean;
  cron: string;
  prompt: string;
  deliverAs: "followUp" | "steer";
}

export interface LoopStatus {
  id: string;
  isRunning: boolean;
  lastRun: number | null;
  nextRun: number | null;
  runCount: number;
  lastError: string | null;
}

export type LoopChannelResult =
  | { ok: true; loops: LoopConfig[] }
  | { ok: true; status: { type: "status"; loops: LoopStatus[] } }
  | { ok: true; id: string }
  | { ok: false; error: string };

export interface LoopSchedulerMethods {
  "loop-scheduler.callChannel": {
    params: {
      sessionId: string;
      method: "list" | "create" | "update" | "toggle" | "remove" | "getStatus" | "becomeScheduler";
      args?: Record<string, unknown>;
    };
    result: LoopChannelResult;
  };
}

export interface LoopSchedulerEvents {
  "loop-scheduler.event": { sessionId: string } & Record<string, unknown>;
}
