import type { ImageContent } from "@dyyz1993/pi-ai";

import { createLogger } from "../lib/logger";
import type { SanitizedEvent } from "./hold-events";

const log = createLogger("agent");

interface PromptClientLike {
  prompt(content: string, images?: ImageContent[]): Promise<void>;
}

interface SteeringClientLike {
  steer(content: string, images?: ImageContent[]): Promise<void>;
  steer(options: {
    text?: string;
    images?: ImageContent[];
    promote?: number;
    immediate?: boolean;
  }): Promise<void>;
}

interface FollowUpClientLike {
  followUp(content: string, images?: ImageContent[]): Promise<void>;
}

interface AbortClientLike {
  abort(): Promise<void>;
}

interface ManagedPromptLike {
  client: PromptClientLike;
  info?: {
    status?: string;
  };
  lastActiveAt: number;
}

interface ManagedSteeringLike {
  client: SteeringClientLike;
}

interface ManagedFollowUpLike {
  client: FollowUpClientLike;
}

interface ManagedAbortLike {
  client: AbortClientLike;
  info: {
    status: string;
  };
  lastActiveAt: number;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out (${ms}ms)`)), ms),
    ),
  ]);
}

export async function sendPromptOperation<TManaged extends ManagedPromptLike>(options: {
  sessionId: string;
  content: string;
  images?: ImageContent[];
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
  isClientAlive: (sessionId: string, managed: TManaged) => Promise<boolean>;
  cleanupDeadClient: (sessionId: string, reason: string) => void;
  emitAgentEnd: (sessionId: string, reason?: string) => Promise<void>;
  now?: () => number;
}): Promise<boolean> {
  let managed = options.getActiveManaged(options.sessionId);
  managed ??= await options.ensureManagedClient(options.sessionId);
  if (!managed) {
    log.warn("send: no client after ensure", { sessionId: options.sessionId });
    return false;
  }

  const status = managed.info?.status;
  if (status && status !== "idle") {
    throw new Error(
      `Agent is ${status}; send a follow-up or steer message instead of a new prompt.`,
    );
  }

  managed.lastActiveAt = (options.now ?? Date.now)();
  try {
    await managed.client.prompt(options.content, options.images);
  } catch (err: unknown) {
    const msg = errorMessage(err);
    log.error("prompt error", {
      sessionId: options.sessionId,
      err: msg,
      errDetails: err instanceof Error ? err.stack : String(err),
    });
    if (!(await options.isClientAlive(options.sessionId, managed))) {
      options.cleanupDeadClient(options.sessionId, `prompt failed: ${msg}`);
      throw err;
    }
    await options.emitAgentEnd(options.sessionId, msg).catch((emitErr: unknown) => {
      log.warn("emitAgentEvent(agent_end) after prompt error", {
        err: errorMessage(emitErr),
      });
    });
    throw err;
  }
  return true;
}

export function steerOperation<TManaged extends ManagedSteeringLike>(options: {
  sessionId: string;
  content?: string;
  images?: ImageContent[];
  promote?: number;
  immediate?: boolean;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): boolean {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return false;
  const steerPromise =
    options.promote !== undefined || options.immediate
      ? managed.client.steer({
          text: options.content,
          images: options.images,
          promote: options.promote,
          immediate: options.immediate,
        })
      : managed.client.steer(options.content ?? "", options.images);
  steerPromise.catch((err: unknown) => {
    log.warn("steer error", { sessionId: options.sessionId, err: errorMessage(err) });
  });
  return true;
}

export function followUpOperation<TManaged extends ManagedFollowUpLike>(options: {
  sessionId: string;
  content: string;
  images?: ImageContent[];
  getActiveManaged: (sessionId: string) => TManaged | null;
}): boolean {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return false;
  managed.client.followUp(options.content, options.images).catch((err: unknown) => {
    log.warn("followUp error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
  });
  return true;
}

export async function abortOperation<TManaged extends ManagedAbortLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  broadcastIdle: (sessionId: string) => void;
  emitAgentEvent: (sessionId: string, event: SanitizedEvent) => Promise<void>;
  abortTimeoutMs?: number;
  emitAgentEndTimeoutMs?: number;
  now?: () => number;
}): Promise<boolean> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) {
    options.broadcastIdle(options.sessionId);
    return false;
  }

  const abortPromise = managed.client.abort().catch((err: unknown) => {
    log.warn("abort error", { sessionId: options.sessionId, err: errorMessage(err) });
  });
  await withTimeout(abortPromise, options.abortTimeoutMs ?? 1_500, "abort").catch(
    (err: unknown) => {
      log.warn("abort timed out; forcing local idle", {
        sessionId: options.sessionId,
        err: errorMessage(err),
      });
    },
  );
  managed.info.status = "idle";
  managed.lastActiveAt = (options.now ?? Date.now)();
  options.broadcastIdle(options.sessionId);
  await withTimeout(
    options.emitAgentEvent(options.sessionId, { type: "agent_end" } as SanitizedEvent),
    options.emitAgentEndTimeoutMs ?? 1_500,
    "abort agent_end",
  ).catch((err: unknown) => {
    log.warn("emitAgentEvent(agent_end) after abort timed out", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
  });
  return true;
}
