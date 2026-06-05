import { createLogger } from "../lib/logger";
import {
  asAgentCommandClient,
  getResponseData,
  normalizeAgentList,
  type AgentListItem,
  type NormalizedAgentListItem,
} from "./agent-command-response";

const log = createLogger("agent");

interface ManagedClientLike {
  client: unknown;
}

interface ManagedClientAccess<TManaged extends ManagedClientLike> {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
}

async function resolveManagedClient<TManaged extends ManagedClientLike>(
  access: ManagedClientAccess<TManaged>,
): Promise<TManaged | null> {
  let managed = access.getActiveManaged(access.sessionId);
  managed ??= await access.ensureManagedClient(access.sessionId);
  return managed;
}

export async function getTierModelsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
  retryDelayMs?: number;
}): Promise<{ models: Record<string, string> }> {
  let managed = options.getActiveManaged(options.sessionId);
  if (!managed && options.retryDelayMs !== 0) {
    await new Promise((r) => setTimeout(r, options.retryDelayMs ?? 200));
    managed = options.getActiveManaged(options.sessionId);
  }
  managed ??= await options.ensureManagedClient(options.sessionId);
  if (!managed) return { models: {} };
  const response = await asAgentCommandClient(managed.client)
    .send({ type: "get_tier_models" })
    .catch((err: unknown) => {
      log.warn("getTierModels error", {
        sessionId: options.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return null;
    });
  if (!response) return { models: {} };
  const data = getResponseData<{ models: Record<string, string> }>(response);
  return { models: data?.models ?? {} };
}

export async function setTierModelsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  models: Record<string, string>;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ ok: boolean }> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return { ok: false };
  await asAgentCommandClient(managed.client)
    .send({ type: "set_tier_models", models: options.models })
    .catch((err: unknown) => {
      log.warn("setTierModels error", {
        sessionId: options.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
  return { ok: true };
}

export async function getAgentsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
}): Promise<{ agents: NormalizedAgentListItem[] }> {
  const managed = await resolveManagedClient(options);
  if (!managed) return { agents: [] };
  try {
    const response = await asAgentCommandClient(managed.client).send({ type: "get_agents" });
    const data = getResponseData<{ agents: AgentListItem[] }>(response);
    return { agents: normalizeAgentList(data?.agents) };
  } catch (err: unknown) {
    log.warn("getAgents error", {
      sessionId: options.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { agents: [] };
  }
}

export async function switchAgentOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  agentName: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
}): Promise<{
  agentName: string;
  tools: string[];
  tier?: string;
  thinkingLevel?: string;
}> {
  const managed = await resolveManagedClient(options);
  if (!managed) throw new Error("No agent process for session");
  const response = await asAgentCommandClient(managed.client).send({
    type: "switch_agent",
    agentName: options.agentName,
  });
  const data = getResponseData<{
    agentName: string;
    tools: string[];
    tier?: string;
    thinkingLevel?: string;
  }>(response);
  if (!data) throw new Error("switch_agent returned no data");
  return data;
}

export async function getCurrentAgentOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
}): Promise<{ agentName: string | null }> {
  const managed = await resolveManagedClient(options);
  if (!managed) return { agentName: null };
  try {
    const response = await asAgentCommandClient(managed.client).send({
      type: "get_current_agent",
    });
    const data = getResponseData<{ agentName: string | null }>(response);
    return { agentName: data?.agentName ?? null };
  } catch (err: unknown) {
    log.warn("getCurrentAgent error", {
      sessionId: options.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return { agentName: null };
  }
}

export async function getLatestAgentChangeOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{
  agentName: string;
  agentConfig?: Record<string, unknown>;
  timestamp: string;
} | null> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return null;
  try {
    const response = await asAgentCommandClient(managed.client).send({
      type: "get_latest_agent_change",
    });
    const data = getResponseData<{
      agentName: string;
      agentConfig?: Record<string, unknown>;
      timestamp: string;
    } | null>(response);
    return data ?? null;
  } catch (err: unknown) {
    log.warn("getLatestAgentChange error", {
      sessionId: options.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
