import type { RpcClientAPI } from "@dyyz1993/pi-coding-agent";

import { config } from "../../server-config";
import { createLogger } from "../lib/logger";
import { parseTierModel, TIER_KEYS, type TierKey } from "./agent-runtime-config";
import { ensureLocalCodingAgentRuntimeDependencies } from "./agent-runtime-package-repair";

const log = createLogger("agent");

interface ManagedClientLike {
  client: Pick<
    RpcClientAPI,
    "getAvailableModels" | "setModel" | "cycleModel" | "setThinkingLevel" | "cycleThinkingLevel"
  >;
}

interface ManagedClientAccess<TManaged extends ManagedClientLike> {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
}

type AvailableModelInfo = {
  provider: string;
  id: string;
  name: string;
  contextWindow: number;
  reasoning: boolean;
  input: ("text" | "image")[];
};

type RawAvailableModelInfo = {
  provider: string;
  id: string;
  name?: string;
  contextWindow: number;
  reasoning: boolean;
  input?: ("text" | "image")[];
};

function normalizeAvailableModel(model: RawAvailableModelInfo): AvailableModelInfo {
  return {
    provider: model.provider,
    id: model.id,
    name: model.name ?? model.id,
    contextWindow: model.contextWindow,
    reasoning: model.reasoning,
    input: model.input ?? ["text"],
  };
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

type ModelRegistryModule = {
  AuthStorage: { create: () => unknown };
  ModelRegistry: { create: (storage: unknown) => { getAvailable: () => RawAvailableModelInfo[] } };
};

let modelRegistryModule: Promise<ModelRegistryModule> | null = null;

async function loadModelRegistryModule(): Promise<ModelRegistryModule> {
  ensureLocalCodingAgentRuntimeDependencies(config.piCliPath);
  return (modelRegistryModule ??= import("@dyyz1993/pi-coding-agent").then(
    (mod) => mod as unknown as ModelRegistryModule,
  ));
}

async function getAvailableModelsFromRegistry(): Promise<AvailableModelInfo[]> {
  const { AuthStorage, ModelRegistry } = await loadModelRegistryModule();
  const registry = ModelRegistry.create(AuthStorage.create());
  return registry.getAvailable().map(normalizeAvailableModel);
}

export async function getAvailableModelsOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
  isClientAlive: (sessionId: string, managed: TManaged) => Promise<boolean>;
  cleanupDeadClient: (sessionId: string, reason: string) => void;
  retryDelayMs?: number;
}): Promise<AvailableModelInfo[]> {
  let managed = options.getActiveManaged(options.sessionId);
  if (!managed && options.retryDelayMs !== 0) {
    await new Promise((r) => setTimeout(r, options.retryDelayMs ?? 200));
    managed = options.getActiveManaged(options.sessionId);
  }
  managed ??= await options.ensureManagedClient(options.sessionId);
  if (!managed) return getAvailableModelsFromRegistry();
  return managed.client
    .getAvailableModels()
    .then((models) => models.map(normalizeAvailableModel))
    .catch(async (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("getAvailableModels error, checking if CLI is alive", {
        sessionId: options.sessionId,
        err: msg,
      });
      if (!(await options.isClientAlive(options.sessionId, managed))) {
        options.cleanupDeadClient(options.sessionId, `getAvailableModels failed: ${msg}`);
      }
      return getAvailableModelsFromRegistry();
    });
}

export async function setModelOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  provider: string;
  modelId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
}): Promise<{ provider: string; id: string }> {
  const managed = await resolveManagedClient(options);
  if (!managed) throw new Error("Client not found");
  return withTimeout(
    managed.client.setModel(options.provider, options.modelId),
    15_000,
    "setModel",
  );
}

export async function switchTierOperation(options: {
  tier: TierKey;
  getTierModels: () => Promise<{ models: Record<string, string> }>;
  setModel: (provider: string, modelId: string) => Promise<{ provider: string; id: string }>;
}): Promise<{ provider: string; id: string; tier: TierKey }> {
  if (!TIER_KEYS.includes(options.tier)) {
    throw new Error(`Invalid tier "${options.tier}". Valid tiers are: fast, pro, max`);
  }

  const { models } = await options.getTierModels();
  const { provider, modelId } = parseTierModel(options.tier, models[options.tier]);
  const model = await options.setModel(provider, modelId);
  return { ...model, tier: options.tier };
}

export async function cycleModelOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
  ensureManagedClient: (sessionId: string) => Promise<TManaged | null>;
}): Promise<{
  model: { provider: string; id: string };
  thinkingLevel: string;
  isScoped: boolean;
} | null> {
  const managed = await resolveManagedClient(options);
  if (!managed) return null;
  return managed.client.cycleModel().catch((err: unknown) => {
    log.warn("cycleModel error", {
      sessionId: options.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
}

export async function setThinkingLevelOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  level: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<void> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return;
  await managed.client
    .setThinkingLevel(options.level as Parameters<RpcClientAPI["setThinkingLevel"]>[0])
    .catch((err: unknown) => {
      log.warn("setThinkingLevel error", {
        sessionId: options.sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
    });
}

export async function cycleThinkingLevelOperation<TManaged extends ManagedClientLike>(options: {
  sessionId: string;
  getActiveManaged: (sessionId: string) => TManaged | null;
}): Promise<{ level: string } | null> {
  const managed = options.getActiveManaged(options.sessionId);
  if (!managed) return null;
  return managed.client.cycleThinkingLevel().catch((err: unknown) => {
    log.warn("cycleThinkingLevel error", {
      sessionId: options.sessionId,
      err: err instanceof Error ? err.message : String(err),
    });
    return null;
  });
}
