import type { RpcClientAPI } from "@dyyz1993/pi-coding-agent";

import { createLogger } from "../lib/logger";
import type { ExtensionUIRequestEvent } from "../modules/agent";

const log = createLogger("agent");

interface ManagedClientLike {
  client: Pick<RpcClientAPI, "getState" | "getCommands" | "getSessionStats">;
  info?: {
    activeToolExecutions?: Array<{
      toolCallId: string;
      toolName: string;
      args?: unknown;
      startedAt?: number;
    }>;
  };
}

interface ManagedClientAccess<TManaged extends ManagedClientLike> {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms),
    ),
  ]);
}

async function resolveManagedClient<TManaged extends ManagedClientLike>(
  access: ManagedClientAccess<TManaged>,
): Promise<TManaged | null> {
  let managed = access.getActiveManaged(access.sessionId);
  managed ??= await access.ensureManagedClient(access.sessionId);
  return managed;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isTimeoutLikeError(message: string): boolean {
  return /\btimeout\b|timed out|Timeout waiting for response/i.test(message);
}

export async function getStateOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
  isClientAlive: (sessionId: string, managed: TManaged) => Promise<boolean>;
  cleanupDeadClient: (sessionId: string, reason: string) => void;
}): Promise<{
  model?: {
    id: string;
    name?: string;
    provider?: string;
    reasoning?: boolean;
    contextWindow: number;
    maxTokens: number;
  };
  thinkingLevel?: string;
  isStreaming: boolean;
  isCompacting: boolean;
  messageCount: number;
  streamingMessage?: unknown;
  activeToolExecutions: Array<{
    toolCallId: string;
    toolName: string;
    args?: unknown;
    startedAt?: number;
  }>;
  pendingUIRequests?: ExtensionUIRequestEvent[];
} | null> {
  const managed = await resolveManagedClient(options);
  if (!managed) return null;

  try {
    const state = await withTimeout(managed.client.getState(), 10_000, "getState");
    const stateWithStreaming = state as typeof state & {
      streamingMessage?: unknown;
      pendingUIRequests?: ExtensionUIRequestEvent[];
    };
    const model = state.model;
    const streamingMessage = stateWithStreaming.streamingMessage;
    return {
      model: model
        ? {
            id: String(model.id ?? ""),
            name: model.name ? String(model.name) : undefined,
            provider: model.provider ? String(model.provider) : undefined,
            reasoning: Boolean(model.reasoning),
            contextWindow: Number(model.contextWindow ?? 0),
            maxTokens: Number(model.maxTokens ?? 0),
          }
        : undefined,
      thinkingLevel: state.thinkingLevel ? String(state.thinkingLevel) : undefined,
      isStreaming: Boolean(state.isStreaming),
      isCompacting: Boolean(state.isCompacting),
      messageCount: Number(state.messageCount ?? 0),
      streamingMessage,
      activeToolExecutions: managed.info?.activeToolExecutions ?? [],
      pendingUIRequests: stateWithStreaming.pendingUIRequests ?? [],
    };
  } catch (err: unknown) {
    const msg = errorMessage(err);
    log.warn("getState RPC failed, checking if CLI is alive", {
      sessionId: options.sessionId,
      error: msg,
    });
    if (isTimeoutLikeError(msg)) {
      // Timeout likely means CLI is dead or stuck — check before retrying
      if (!(await options.isClientAlive(options.sessionId, managed))) {
        options.cleanupDeadClient(options.sessionId, `getState timed out: ${msg}`);
      } else {
        log.warn("getState RPC timed out; CLI still alive, keeping registered", {
          sessionId: options.sessionId,
        });
      }
      return null;
    }
    if (!(await options.isClientAlive(options.sessionId, managed))) {
      options.cleanupDeadClient(options.sessionId, `getState failed: ${msg}`);
    }
    return null;
  }
}

export async function getCommandsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<
  Array<{ name: string; description: string; source: "extension" | "prompt" | "skill" }>
> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return [];

  try {
    const commands = await withTimeout(managed.client.getCommands(), 10_000, "getCommands");
    if (!commands) return [];
    return commands.map((command) => ({
      name: String(command.name ?? ""),
      description: String(command.description ?? ""),
      source: (command.source as "extension" | "prompt" | "skill") ?? "extension",
    }));
  } catch (err: unknown) {
    log.warn("getCommands failed", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return [];
  }
}

export async function getSessionStatsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  isClientAlive: (sessionId: string, managed: TManaged) => Promise<boolean>;
  cleanupDeadClient: (sessionId: string, reason: string) => void;
}): Promise<{
  tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
  cost: number;
  contextUsage?: { tokens: number | null; contextWindow: number; percent: number | null };
} | null> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return null;

  try {
    const stats = await withTimeout(managed.client.getSessionStats(), 10_000, "getSessionStats");
    if (!stats) return null;
    const tokens = stats.tokens;
    const cu = stats.contextUsage;
    return {
      tokens: {
        input: Number(tokens?.input ?? 0),
        output: Number(tokens?.output ?? 0),
        cacheRead: Number(tokens?.cacheRead ?? 0),
        cacheWrite: Number(tokens?.cacheWrite ?? 0),
        total: Number(tokens?.total ?? 0),
      },
      cost: Number(stats.cost ?? 0),
      contextUsage: cu
        ? {
            tokens: cu.tokens,
            contextWindow: Number(cu.contextWindow ?? 0),
            percent: cu.percent,
          }
        : undefined,
    };
  } catch (err: unknown) {
    const msg = errorMessage(err);
    log.warn("getSessionStats failed, checking if CLI is alive", {
      sessionId: options.sessionId,
      err: msg,
    });
    if (isTimeoutLikeError(msg)) {
      // Timeout likely means CLI is dead or stuck — check before retrying
      if (!(await options.isClientAlive(options.sessionId, managed))) {
        options.cleanupDeadClient(options.sessionId, `getSessionStats timed out: ${msg}`);
      } else {
        log.warn("getSessionStats timed out; CLI still alive, keeping registered", {
          sessionId: options.sessionId,
        });
      }
      return null;
    }
    if (!(await options.isClientAlive(options.sessionId, managed))) {
      options.cleanupDeadClient(options.sessionId, `getSessionStats failed: ${msg}`);
    }
    return null;
  }
}
