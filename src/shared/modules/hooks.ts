export interface HookLogEntry {
  id: number;
  timestamp: number;
  durationMs: number;
  event: string;
  toolName: string;
  matcher: string;
  hookType: "command" | "http" | "prompt" | "agent" | "mcp_tool";
  command: string;
  decision: "allow" | "block" | "ask";
  reason: string;
  exitCode: number;
  source: "policy" | "global" | "project" | "local" | "unknown";
  snippet: string;
}

export interface HookRuleStats {
  matcher: string;
  event: string;
  hookType: string;
  command: string;
  source: string;
  allowCount: number;
  blockCount: number;
  askCount: number;
}

export interface HookConfigSnapshot {
  runtimeEnabled: boolean;
  sources: Array<{
    path: string;
    scope: string;
    exists: boolean;
    disabled: boolean;
  }>;
  events: Array<{
    name: string;
    groups: Array<{
      matcher: string;
      source: string;
      hooks: Array<{
        type: string;
        command?: string;
        url?: string;
        prompt?: string;
        timeout?: number;
        async?: boolean;
        once?: boolean;
        if?: string;
      }>;
    }>;
  }>;
}

export interface HookLogResult {
  entries: HookLogEntry[];
  ruleStats: HookRuleStats[];
  totalExecutions: number;
  configSnapshot: HookConfigSnapshot;
}

export interface HooksMethods {
  "hooks.getLog": {
    params: { sessionId: string; limit?: number; event?: string };
    result: HookLogResult;
  };
  "hooks.getConfig": {
    params: { sessionId: string };
    result: HookLogResult;
  };
  "hooks.clear": {
    params: { sessionId: string };
    result: { ok: boolean };
  };
  "hooks.getStatus": {
    params: { sessionId: string };
    result: { enabled: boolean };
  };
  "hooks.setEnabled": {
    params: { sessionId: string; enabled: boolean };
    result: { enabled: boolean };
  };
}

export interface HooksEvents {
  "hooks.executed": HookLogEntry;
  "hooks.blocked": HookLogEntry;
}
