import type { ImageContent } from "@dyyz1993/pi-ai";

import { createLogger } from "../lib/logger";
import type { SanitizedEvent } from "./hold-events";

const log = createLogger("agent");

interface PromptClientLike {
  prompt(content: string, images?: ImageContent[]): Promise<void>;
}

interface SteeringClientLike {
  steer(content: string, images?: ImageContent[]): Promise<void>;
}

interface FollowUpClientLike {
  followUp(content: string, images?: ImageContent[]): Promise<void>;
}

interface AbortClientLike {
  abort(): Promise<void>;
}

interface ManagedPromptLike {
  client: PromptClientLike;
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

export async function sendPromptOperation<TManaged extends ManagedPromptLike>(options: {
  sessionId: string;
  content: string;
  images?: ImageContent[];
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
  isClientAlive: (sessionId: string, managed: TManaged) => Promise<boolean>;
  cleanupDeadClient: (sessionId: string, reason: string) => void;
  emitAgentEnd: (sessionId: string) => Promise<void>;
  now?: () => number;
}): Promise<boolean> {
  let managed = options.getActiveManaged(options.sessionId);
  managed ??= await options.ensureManagedClient(options.sessionId);
  if (!managed) {
    log.warn("send: no client after ensure", { sessionId: options.sessionId });
    return false;
  }

  managed.lastActiveAt = (options.now ?? Date.now)();
  managed.client.prompt(options.content, options.images).catch(async (err: unknown) => {
    const msg = errorMessage(err);
    log.error("prompt error", {
      sessionId: options.sessionId,
      err: msg,
      errDetails: err instanceof Error ? err.stack : String(err),
    });
    if (!(await options.isClientAlive(options.sessionId, managed))) {
      options.cleanupDeadClient(options.sessionId, `prompt failed: ${msg}`);
      return;
    }
    options.emitAgentEnd(options.sessionId).catch((emitErr: unknown) => {
      log.warn("emitAgentEvent(agent_end) after prompt error", {
        err: errorMessage(emitErr),
      });
    });
  });
  return true;
}

export function steerOperation<TManaged extends ManagedSteeringLike>(options: {
  sessionId: string;
  content: string;
  images?: ImageContent[];
  getActiveManaged: (sessionId: string) => TManaged | null;
}): boolean {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return false;
  managed.client.steer(options.content, options.images).catch((err: unknown) => {
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
  now?: () => number;
}): Promise<boolean> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) {
    options.broadcastIdle(options.sessionId);
    return false;
  }

  await managed.client.abort().catch((err: unknown) => {
    log.warn("abort error", { sessionId: options.sessionId, err: errorMessage(err) });
  });
  managed.info.status = "idle";
  managed.lastActiveAt = (options.now ?? Date.now)();
  options.broadcastIdle(options.sessionId);
  await options.emitAgentEvent(options.sessionId, { type: "agent_end" } as SanitizedEvent);
  return true;
}
