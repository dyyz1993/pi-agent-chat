import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import { AgentProcessManager } from "../agent/process-manager";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

let manager: AgentProcessManager | null = null;

export function getProcessManager(): AgentProcessManager | null {
  return manager;
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  if (!manager) {
    manager = new AgentProcessManager(server);
  } else {
    manager.updateServer(server);
  }

  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  r("agent.start", async (params) => {
    log.info("start called", { sessionId: params.sessionId, projectPath: params.projectPath });
    const result = await manager!.start(params.sessionId, params.projectPath, params.sessionPath);
    log.info("start result", { result });
    return result;
  });

  r("agent.replayHoldEvents", async (params) => {
    return manager!.replayHoldEvents(params.sessionId);
  });

  r("agent.send", async (params) => {
    log.info("send called", { sessionId: params.sessionId, content: params.content });
    const ok = manager!.send(params.sessionId, params.content);
    return { ok };
  });

  r("agent.stop", async (params) => {
    const ok = manager!.stop(params.sessionId);
    return { ok };
  });

  r("agent.status", async (params) => {
    return manager!.getStatus(params.sessionId);
  });

  r("agent.respondUI", async (params) => {
    const ok = manager!.respondUI(params.sessionId, params.requestId, params.response);
    return { ok };
  });

  r("agent.getState", async (params) => {
    return manager!.getState(params.sessionId);
  });

  r("agent.getSessionStats", async (params) => {
    return manager!.getSessionStats(params.sessionId);
  });

  r("agent.getCommands", async (params) => {
    return manager!.getCommands(params.sessionId);
  });

  r("agent.getMessages", async (params) => {
    const result = await manager!.getMessages(params.sessionId, params.sessionPath);
    return { messages: result.messages, customEntries: result.customEntries } as R<"agent.getMessages">;
  });

  r("agent.steer", async (params) => {
    const ok = manager!.steer(params.sessionId, params.content);
    return { ok };
  });

  r("agent.followUp", async (params) => {
    const ok = manager!.followUp(params.sessionId, params.content);
    return { ok };
  });

  r("agent.abort", async (params) => {
    const ok = await manager!.abort(params.sessionId);
    return { ok };
  });

  r("agent.getAvailableModels", async (params) => {
    return manager!.getAvailableModels(params.sessionId) as Promise<R<"agent.getAvailableModels">>;
  });

  r("agent.setModel", async (params) => {
    return manager!.setModel(params.sessionId, params.provider, params.modelId) as Promise<R<"agent.setModel">>;
  });

  r("agent.cycleModel", async (params) => {
    return manager!.cycleModel(params.sessionId) as Promise<R<"agent.cycleModel">>;
  });

  r("agent.setThinkingLevel", async (params) => {
    await manager!.setThinkingLevel(params.sessionId, params.level);
    return { ok: true };
  });

  r("agent.cycleThinkingLevel", async (params) => {
    return manager!.cycleThinkingLevel(params.sessionId) as Promise<R<"agent.cycleThinkingLevel">>;
  });

  r("agent.compact", async (params) => {
    return manager!.compact(params.sessionId, params.customInstructions) as Promise<R<"agent.compact">>;
  });

  r("agent.setAutoCompaction", async (params) => {
    await manager!.setAutoCompaction(params.sessionId, params.enabled);
    return { ok: true };
  });

  r("agent.setAutoRetry", async (params) => {
    await manager!.setAutoRetry(params.sessionId, params.enabled);
    return { ok: true };
  });

  r("agent.abortRetry", async (params) => {
    await manager!.abortRetry(params.sessionId);
    return { ok: true };
  });

  r("agent.setSteeringMode", async (params) => {
    await manager!.setSteeringMode(params.sessionId, params.mode);
    return { ok: true };
  });

  r("agent.setFollowUpMode", async (params) => {
    await manager!.setFollowUpMode(params.sessionId, params.mode);
    return { ok: true };
  });

  r("agent.getActiveTools", async (params) => {
    return manager!.getActiveTools(params.sessionId) as Promise<R<"agent.getActiveTools">>;
  });

  r("agent.setActiveTools", async (params) => {
    await manager!.setActiveTools(params.sessionId, params.toolNames);
    return { ok: true };
  });

  r("agent.getQueue", async (params) => {
    return manager!.getQueue(params.sessionId) as Promise<R<"agent.getQueue">>;
  });

  r("agent.clearQueue", async (params) => {
    return manager!.clearQueue(params.sessionId) as Promise<R<"agent.clearQueue">>;
  });

  r("agent.getExtensions", async (params) => {
    return manager!.getExtensions(params.sessionId) as Promise<R<"agent.getExtensions">>;
  });

  r("agent.getSkills", async (params) => {
    return manager!.getSkills(params.sessionId) as Promise<R<"agent.getSkills">>;
  });

  r("agent.getTools", async (params) => {
    return manager!.getTools(params.sessionId) as Promise<R<"agent.getTools">>;
  });

  r("agent.getContextUsage", async (params) => {
    return manager!.getContextUsage(params.sessionId) as Promise<R<"agent.getContextUsage">>;
  });

  r("agent.getSettings", async (params) => {
    return manager!.getSettings(params.sessionId, params.scope) as Promise<R<"agent.getSettings">>;
  });

  r("agent.setSettings", async (params) => {
    await manager!.setSettings(params.sessionId, params.settings, params.scope);
    return { ok: true };
  });

  r("agent.setSessionName", async (params) => {
    await manager!.setSessionName(params.sessionId, params.name);
    return { ok: true };
  });

  r("agent.getLastAssistantText", async (params) => {
    return manager!.getLastAssistantText(params.sessionId) as Promise<R<"agent.getLastAssistantText">>;
  });

  r("agent.getForkMessages", async (params) => {
    return manager!.getForkMessages(params.sessionId) as Promise<R<"agent.getForkMessages">>;
  });

  r("agent.fork", async (params) => {
    return manager!.fork(params.sessionId, params.entryId, params.position ? { position: params.position } : undefined) as Promise<R<"agent.fork">>;
  });

  r("agent.navigateTree", async (params) => {
    return manager!.navigateTree(params.sessionId, params.targetId, { summarize: params.summarize }) as Promise<R<"agent.navigateTree">>;
  });

  r("agent.getTree", async (params) => {
    return manager!.getTree(params.sessionId) as Promise<R<"agent.getTree">>;
  });

  r("agent.clone", async (params) => {
    return manager!.clone(params.sessionId) as Promise<R<"agent.clone">>;
  });

  r("agent.newSession", async (params) => {
    return manager!.newSession(params.sessionId, params.parentSession) as Promise<R<"agent.newSession">>;
  });

  r("agent.exportHtml", async (params) => {
    return manager!.exportHtml(params.sessionId, params.outputPath) as Promise<R<"agent.exportHtml">>;
  });
}
