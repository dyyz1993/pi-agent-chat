import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import { AgentProcessManager } from "../agent/process-manager";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

let manager: AgentProcessManager | null = null;

function getManager(): AgentProcessManager {
  if (!manager) {
    throw new Error("AgentProcessManager not initialized");
  }
  return manager;
}

export function getProcessManager(): AgentProcessManager | null {
  return manager;
}

export function unregister(server: RPCServer): void {
  if (manager) {
    manager.removeServer(server);
  }
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  if (!manager) {
    manager = new AgentProcessManager(server);
    log.info("Created new AgentProcessManager", { servers: 1 });
  } else {
    manager.updateServer(server);
    log.info("Updated server on AgentProcessManager", { servers: manager.serverCount() });
  }

  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  const m = getManager();

  r("agent.start", async (params) => {
    log.info("start called", { sessionId: params.sessionId, projectPath: params.projectPath });
    const result = await m.start(params.sessionId, params.projectPath, params.sessionPath);
    log.info("start result", { result });
    return result;
  });

  r("agent.replayHoldEvents", async (params) => {
    return m.replayHoldEvents(params.sessionId);
  });

  r("agent.send", async (params) => {
    log.info("send called", { sessionId: params.sessionId, content: params.content });
    const ok = m.send(params.sessionId, params.content);
    if (!ok) {
      throw new Error(`Agent not started for session ${params.sessionId}`);
    }
    return { ok };
  });

  r("agent.stop", async (params) => {
    const ok = m.stop(params.sessionId);
    return { ok };
  });

  r("agent.status", async (params) => {
    return m.getStatus(params.sessionId);
  });

  r("agent.respondUI", async (params) => {
    const ok = m.respondUI(params.sessionId, params.requestId, params.response);
    return { ok };
  });

  r("agent.getState", async (params) => {
    return m.getState(params.sessionId);
  });

  r("agent.getSessionStats", async (params) => {
    return m.getSessionStats(params.sessionId);
  });

  r("agent.getCommands", async (params) => {
    return m.getCommands(params.sessionId);
  });

  r("agent.getMessages", async (params) => {
    const result = await m.getMessages(params.sessionId, params.sessionPath);
    return { messages: result.messages, customEntries: result.customEntries } as R<"agent.getMessages">;
  });

  r("agent.steer", async (params) => {
    const ok = m.steer(params.sessionId, params.content);
    return { ok };
  });

  r("agent.followUp", async (params) => {
    const ok = m.followUp(params.sessionId, params.content);
    return { ok };
  });

  r("agent.abort", async (params) => {
    const ok = await m.abort(params.sessionId);
    return { ok };
  });

  r("agent.setCwd", async (params) => {
    const ok = await m.setCwd(params.sessionId, params.cwd);
    return { ok };
  });

  r("agent.getAvailableModels", async (params) => {
    return m.getAvailableModels(params.sessionId) as Promise<R<"agent.getAvailableModels">>;
  });

  r("agent.setModel", async (params) => {
    return m.setModel(params.sessionId, params.provider, params.modelId) as Promise<R<"agent.setModel">>;
  });

  r("agent.cycleModel", async (params) => {
    return m.cycleModel(params.sessionId) as Promise<R<"agent.cycleModel">>;
  });

  r("agent.setThinkingLevel", async (params) => {
    await m.setThinkingLevel(params.sessionId, params.level);
    return { ok: true };
  });

  r("agent.cycleThinkingLevel", async (params) => {
    return m.cycleThinkingLevel(params.sessionId) as Promise<R<"agent.cycleThinkingLevel">>;
  });

  r("agent.compact", async (params) => {
    return m.compact(params.sessionId, params.customInstructions) as Promise<R<"agent.compact">>;
  });

  r("agent.setAutoCompaction", async (params) => {
    await m.setAutoCompaction(params.sessionId, params.enabled);
    return { ok: true };
  });

  r("agent.setAutoRetry", async (params) => {
    await m.setAutoRetry(params.sessionId, params.enabled);
    return { ok: true };
  });

  r("agent.abortRetry", async (params) => {
    await m.abortRetry(params.sessionId);
    return { ok: true };
  });

  r("agent.setSteeringMode", async (params) => {
    await m.setSteeringMode(params.sessionId, params.mode);
    return { ok: true };
  });

  r("agent.setFollowUpMode", async (params) => {
    await m.setFollowUpMode(params.sessionId, params.mode);
    return { ok: true };
  });

  r("agent.getActiveTools", async (params) => {
    return m.getActiveTools(params.sessionId) as Promise<R<"agent.getActiveTools">>;
  });

  r("agent.setActiveTools", async (params) => {
    await m.setActiveTools(params.sessionId, params.toolNames);
    return { ok: true };
  });

  r("agent.getQueue", async (params) => {
    return m.getQueue(params.sessionId) as Promise<R<"agent.getQueue">>;
  });

  r("agent.clearQueue", async (params) => {
    return m.clearQueue(params.sessionId) as Promise<R<"agent.clearQueue">>;
  });

  r("agent.getExtensions", async (params) => {
    return m.getExtensions(params.sessionId) as Promise<R<"agent.getExtensions">>;
  });

  r("agent.getSkills", async (params) => {
    return m.getSkills(params.sessionId) as Promise<R<"agent.getSkills">>;
  });

  r("agent.getTools", async (params) => {
    return m.getTools(params.sessionId) as Promise<R<"agent.getTools">>;
  });

  r("agent.getContextUsage", async (params) => {
    return m.getContextUsage(params.sessionId) as Promise<R<"agent.getContextUsage">>;
  });

  r("agent.getSettings", async (params) => {
    return m.getSettings(params.sessionId, params.scope) as Promise<R<"agent.getSettings">>;
  });

  r("agent.setSettings", async (params) => {
    await m.setSettings(params.sessionId, params.settings, params.scope);
    return { ok: true };
  });

  r("agent.setSessionName", async (params) => {
    await m.setSessionName(params.sessionId, params.name);
    return { ok: true };
  });

  r("agent.getLastAssistantText", async (params) => {
    return m.getLastAssistantText(params.sessionId) as Promise<R<"agent.getLastAssistantText">>;
  });

  r("agent.getForkMessages", async (params) => {
    return m.getForkMessages(params.sessionId) as Promise<R<"agent.getForkMessages">>;
  });

  r("agent.fork", async (params) => {
    return m.fork(params.sessionId, params.entryId, params.position ? { position: params.position } : undefined) as Promise<R<"agent.fork">>;
  });

  r("agent.navigateTree", async (params) => {
    return m.navigateTree(params.sessionId, params.targetId, { summarize: params.summarize, skipFiles: params.skipFiles }) as Promise<R<"agent.navigateTree">>;
  });

  r("agent.rollbackPreview", async (params) => {
    return m.previewRollback(params.sessionId, params.targetId) as Promise<R<"agent.rollbackPreview">>;
  });

  r("agent.getTree", async (params) => {
    return m.getTree(params.sessionId) as Promise<R<"agent.getTree">>;
  });

  r("agent.clone", async (params) => {
    return m.clone(params.sessionId) as Promise<R<"agent.clone">>;
  });

  r("agent.newSession", async (params) => {
    return m.newSession(params.sessionId, params.parentSession) as Promise<R<"agent.newSession">>;
  });

  r("agent.exportHtml", async (params) => {
    return m.exportHtml(params.sessionId, params.outputPath) as Promise<R<"agent.exportHtml">>;
  });
}
