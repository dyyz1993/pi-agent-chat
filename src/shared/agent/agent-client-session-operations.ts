import type { RpcClientAPI } from "@dyyz1993/pi-coding-agent";

import { createLogger } from "../lib/logger";

const log = createLogger("agent");

type McpServerInfo = Awaited<ReturnType<RpcClientAPI["getMcpServers"]>>[number];

export type QueueItemRef = { type: "steering" | "followUp"; index: number; text: string };
export type FollowUpQueueItemRef = { type: "followUp"; index: number; text: string };

interface ManagedClientLike {
  client: Pick<
    RpcClientAPI,
    | "compact"
    | "setAutoCompaction"
    | "setAutoRetry"
    | "abortRetry"
    | "setSteeringMode"
    | "setFollowUpMode"
    | "setPermissionMode"
    | "getActiveTools"
    | "setActiveTools"
    | "getQueue"
    | "getExtensions"
    | "getSkills"
    | "reload"
    | "getTools"
    | "getMcpServers"
    | "toggleMcpServer"
    | "restartMcpServer"
    | "getContextUsage"
  > & {
    clearQueue(item?: QueueItemRef): Promise<{ steering: string[]; followUp: string[] }>;
    promoteQueuedFollowUp?(
      item: FollowUpQueueItemRef,
    ): Promise<{ steering: string[]; followUp: string[] }>;
  };
  info?: {
    projectPath?: string;
    sessionPath?: string;
    status?: string;
    activeToolExecutions?: unknown;
    permissionMode?: string;
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

export async function compactOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  customInstructions?: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ summary: string; tokensBefore: number }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) throw new Error("Client not found");
  return withTimeout(managed.client.compact(options.customInstructions), 120_000, "compact");
}

export async function setAutoCompactionOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  enabled: boolean;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<void> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return;
  await managed.client.setAutoCompaction(options.enabled).catch((err: unknown) => {
    log.warn("setAutoCompaction error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
  });
}

export async function setAutoRetryOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  enabled: boolean;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<void> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return;
  await managed.client.setAutoRetry(options.enabled).catch((err: unknown) => {
    log.warn("setAutoRetry error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
  });
}

export async function abortRetryOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<void> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return;
  await managed.client.abortRetry().catch((err: unknown) => {
    log.warn("abortRetry error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
  });
}

export async function setSteeringModeOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  mode: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<void> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return;
  await managed.client
    .setSteeringMode(options.mode as Parameters<RpcClientAPI["setSteeringMode"]>[0])
    .catch((err: unknown) => {
      log.warn("setSteeringMode error", {
        sessionId: options.sessionId,
        err: errorMessage(err),
      });
    });
}

export async function setFollowUpModeOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  mode: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<void> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return;
  await managed.client
    .setFollowUpMode(options.mode as Parameters<RpcClientAPI["setFollowUpMode"]>[0])
    .catch((err: unknown) => {
      log.warn("setFollowUpMode error", {
        sessionId: options.sessionId,
        err: errorMessage(err),
      });
    });
}

export async function setPermissionModeOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  mode: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
}): Promise<{ mode: string }> {
  const managed = await resolveManagedClient(options);
  if (!managed) throw new Error("Client not found");
  const result = await withTimeout(
    managed.client.setPermissionMode(
      options.mode as Parameters<RpcClientAPI["setPermissionMode"]>[0],
    ),
    15_000,
    "setPermissionMode",
  );
  managed.info ??= {};
  managed.info.permissionMode = result.mode;
  return result;
}

export async function getActiveToolsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ toolNames: string[] }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { toolNames: [] };
  try {
    const result = await withTimeout(managed.client.getActiveTools(), 10_000, "getActiveTools");
    return { toolNames: Array.isArray(result) ? result : [] };
  } catch (err: unknown) {
    log.warn("getActiveTools error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return { toolNames: [] };
  }
}

export async function setActiveToolsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  toolNames: string[];
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<void> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return;
  await managed.client.setActiveTools(options.toolNames).catch((err: unknown) => {
    log.warn("setActiveTools error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
  });
}

export async function getQueueOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ steering: string[]; followUp: string[] }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { steering: [], followUp: [] };
  return managed.client.getQueue().catch((err: unknown) => {
    log.warn("getQueue error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return { steering: [], followUp: [] };
  });
}

export async function clearQueueOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  item?: QueueItemRef;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ steering: string[]; followUp: string[] }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { steering: [], followUp: [] };
  return managed.client.clearQueue(options.item).catch((err: unknown) => {
    log.warn("clearQueue error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return { steering: [], followUp: [] };
  });
}

export async function promoteQueuedFollowUpOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  item: FollowUpQueueItemRef;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ steering: string[]; followUp: string[] }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { steering: [], followUp: [] };
  if (!managed.client.promoteQueuedFollowUp) {
    throw new Error("promoteQueuedFollowUp RPC is not available in the active agent runtime");
  }
  return managed.client.promoteQueuedFollowUp(options.item).catch((err: unknown) => {
    log.warn("promoteQueuedFollowUp error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return { steering: [], followUp: [] };
  });
}

export async function getExtensionsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{
  extensions: Array<{
    path: string;
    resolvedPath: string;
    toolNames: string[];
    commandNames: string[];
  }>;
}> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { extensions: [] };
  try {
    const result = await withTimeout(managed.client.getExtensions(), 10_000, "getExtensions");
    return { extensions: Array.isArray(result) ? result : [] };
  } catch (err: unknown) {
    log.warn("getExtensions error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return { extensions: [] };
  }
}

export async function getSkillsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{
  skills: Array<{
    name: string;
    description: string;
    filePath: string;
    baseDir: string;
    disableModelInvocation: boolean;
  }>;
}> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { skills: [] };
  try {
    const result = await withTimeout(managed.client.getSkills(), 10_000, "getSkills");
    return { skills: Array.isArray(result) ? result : [] };
  } catch (err: unknown) {
    log.warn("getSkills error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return { skills: [] };
  }
}

export async function reloadOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<void> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return;
  await withTimeout(managed.client.reload(), 30_000, "reload");
}

export async function getToolsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ tools: Array<{ name: string; label: string; description: string }> }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { tools: [] };
  try {
    const result = await withTimeout(managed.client.getTools(), 10_000, "getTools");
    return { tools: Array.isArray(result) ? result : [] };
  } catch (err: unknown) {
    log.warn("getTools error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return { tools: [] };
  }
}

export async function getMcpServersOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ servers: McpServerInfo[] }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { servers: [] };
  try {
    const servers = await withTimeout(managed.client.getMcpServers(), 10_000, "getMcpServers");
    return { servers: Array.isArray(servers) ? servers : [] };
  } catch (err: unknown) {
    log.warn("getMcpServers error", {
      sessionId: options.sessionId,
      err: errorMessage(err),
    });
    return { servers: [] };
  }
}

export async function toggleMcpServerOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  name: string;
  enabled: boolean;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ success: boolean; error?: string }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { success: false, error: "Client not found" };
  try {
    await managed.client.toggleMcpServer(options.name, options.enabled);
    return { success: true };
  } catch (err: unknown) {
    const msg = errorMessage(err);
    log.warn("toggleMcpServer error", { sessionId: options.sessionId, err: msg });
    return { success: false, error: msg };
  }
}

export async function restartMcpServerOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  name: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ success: boolean; error?: string }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { success: false, error: "Client not found" };
  try {
    await managed.client.restartMcpServer(options.name);
    return { success: true };
  } catch (err: unknown) {
    const msg = errorMessage(err);
    log.warn("restartMcpServer error", { sessionId: options.sessionId, err: msg });
    return { success: false, error: msg };
  }
}

export async function getContextUsageOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
  isClientAlive: (sessionId: string, managed: TManaged) => Promise<boolean>;
  cleanupDeadClient: (sessionId: string, reason: string) => void;
}): Promise<{ tokens: number | null; contextWindow: number; percent: number | null }> {
  const managed = await resolveManagedClient(options);
  if (!managed) return { tokens: null, contextWindow: 0, percent: null };
  return managed.client.getContextUsage().catch(async (err: unknown) => {
    const msg = errorMessage(err);
    log.warn("getContextUsage error, checking if CLI is alive", {
      sessionId: options.sessionId,
      err: msg,
    });
    if (isTimeoutLikeError(msg)) {
      // Timeout likely means CLI is dead or stuck — check before retrying
      if (!(await options.isClientAlive(options.sessionId, managed))) {
        options.cleanupDeadClient(options.sessionId, `getContextUsage timed out: ${msg}`);
      } else {
        log.warn("getContextUsage timed out; CLI still alive, keeping registered", {
          sessionId: options.sessionId,
        });
      }
      return { tokens: null, contextWindow: 0, percent: null };
    }
    if (!(await options.isClientAlive(options.sessionId, managed))) {
      options.cleanupDeadClient(options.sessionId, `getContextUsage failed: ${msg}`);
    }
    return { tokens: null, contextWindow: 0, percent: null };
  });
}
