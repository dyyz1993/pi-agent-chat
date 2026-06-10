import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { AgentProcessManager } from "../agent/process-manager";
import { createLogger } from "../lib/logger";
import { listDisabledSkills, setDisabledSkill, listDisabledPlugins, setDisabledPlugin } from "../lib/project-config";

const log = createLogger("agent");

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

  const r = createRegister(server);

  const m = getManager();

  r("agent.start", async (params) => {
    log.info("start called", {
      sessionId: params.sessionId,
      projectPath: params.projectPath,
      forceNewProcess: params.forceNewProcess,
    });
    const result = await m.start(params.sessionId, params.projectPath, params.sessionPath, {
      forceNewProcess: params.forceNewProcess,
    });
    log.info("start result", { result });
    return result;
  });

  r("agent.send", async (params) => {
    log.info("send called", { sessionId: params.sessionId, content: params.content });
    const ok = await m.send(params.sessionId, params.content, params.images);
    if (!ok) {
      throw new Error(`Agent not started for session ${params.sessionId}`);
    }
    return { ok };
  });

  r("agent.stop", async (params) => {
    const ok = await m.stop(params.sessionId);
    return { ok };
  });

  r("agent.getStatus", async (params) => {
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
    return {
      messages: result.messages,
      customEntries: result.customEntries,
    } as R<"agent.getMessages">;
  });

  r("agent.getFullMessages", async (params) => {
    const result = await m.getFullMessages(params.sessionId, params.sessionPath, {
      limit: params.limit,
      afterEntryId: params.afterEntryId,
    });
    return {
      messages: result.messages,
      customEntries: result.customEntries,
      hasMore: result.hasMore,
      totalCount: result.totalCount,
      nextCursor: result.nextCursor,
    } as R<"agent.getFullMessages">;
  });

  r("agent.steer", async (params) => {
    const ok = m.steer(params.sessionId, params.content, params.images);
    return { ok };
  });

  r("agent.followUp", async (params) => {
    const ok = m.followUp(params.sessionId, params.content, params.images);
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
    return m.setModel(params.sessionId, params.provider, params.modelId) as Promise<
      R<"agent.setModel">
    >;
  });

  r("agent.switchTier", async (params) => {
    return m.switchTier(params.sessionId, params.tier) as Promise<R<"agent.switchTier">>;
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

  r("agent.setPermissionMode", async (params) => {
    return m.setPermissionMode(params.sessionId, params.mode) as Promise<
      R<"agent.setPermissionMode">
    >;
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

  r("agent.reload", async (params) => {
    return m.reload(params.sessionId) as Promise<R<"agent.reload">>;
  });

  r("agent.getDisabledSkills", async () => {
    const disabledSkills = await listDisabledSkills();
    return { disabledSkills };
  });

  r("agent.setDisabledSkill", async (params) => {
    const disabledSkills = await setDisabledSkill(params.skillName, params.disabled);
    return { disabledSkills };
  });

  r("agent.getDisabledPlugins", async (params) => {
    const disabledPlugins = await listDisabledPlugins(params.projectPath);
    return { disabledPlugins };
  });

  r("agent.setDisabledPlugin", async (params) => {
    const disabledPlugins = await setDisabledPlugin(params.projectPath, params.pluginPath, params.disabled);
    return { disabledPlugins };
  });

  r("agent.getTools", async (params) => {
    return m.getTools(params.sessionId) as Promise<R<"agent.getTools">>;
  });

  r("agent.getMcpServers", async (params) => {
    return m.getMcpServers(params.sessionId) as Promise<R<"agent.getMcpServers">>;
  });

  r("agent.toggleMcpServer", async (params) => {
    return m.toggleMcpServer(params.sessionId, params.name, params.enabled);
  });

  r("agent.restartMcpServer", async (params) => {
    return m.restartMcpServer(params.sessionId, params.name);
  });

  r("agent.getContextUsage", async (params) => {
    return m.getContextUsage(params.sessionId) as Promise<R<"agent.getContextUsage">>;
  });

  r("agent.getTierModels", async (params) => {
    return m.getTierModels(params.sessionId) as Promise<R<"agent.getTierModels">>;
  });

  r("agent.setTierModels", async (params) => {
    return m.setTierModels(params.sessionId, params.models) as Promise<R<"agent.setTierModels">>;
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
    return m.fork(
      params.sessionId,
      params.entryId,
      params.position ? { position: params.position } : undefined,
    ) as Promise<R<"agent.fork">>;
  });

  r("agent.navigateTree", async (params) => {
    log.info("navigateTree called", {
      sessionId: params.sessionId,
      targetId: params.targetId,
      skipFiles: params.skipFiles,
      summarize: params.summarize,
    });
    return m.navigateTree(params.sessionId, params.targetId, {
      summarize: params.summarize,
      skipFiles: params.skipFiles,
    }) as Promise<R<"agent.navigateTree">>;
  });

  r("agent.previewRollback", async (params) => {
    log.info("previewRollback called", {
      sessionId: params.sessionId,
      targetId: params.targetId,
    });
    return m.previewRollback(params.sessionId, params.targetId) as Promise<
      R<"agent.previewRollback">
    >;
  });

  r("agent.getModifiedFiles", async (params) => {
    return m.getModifiedFiles(
      params.sessionId,
      params.fromEntryId,
      params.toEntryId,
      params.toUserMsgEntryId,
    ) as Promise<R<"agent.getModifiedFiles">>;
  });

  r("agent.getFileDiff", async (params) => {
    return m.getFileDiff(
      params.sessionId,
      params.filePath,
      params.fromEntryId,
      params.toEntryId,
    ) as Promise<R<"agent.getFileDiff">>;
  });

  r("agent.getBatchDiffs", async (params) => {
    return m.getBatchDiffs(params.sessionId, params.fromEntryId, params.toEntryId) as Promise<
      R<"agent.getBatchDiffs">
    >;
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

  r("agent.getAgents", async (params) => {
    return m.getAgents(params.sessionId) as Promise<R<"agent.getAgents">>;
  });

  r("agent.switchAgent", async (params) => {
    return m.switchAgent(params.sessionId, params.agentName) as Promise<R<"agent.switchAgent">>;
  });

  r("agent.getCurrentAgent", async (params) => {
    return m.getCurrentAgent(params.sessionId) as Promise<R<"agent.getCurrentAgent">>;
  });

  r("agent.getAgentDetail", async (params) => {
    // CLI returns AgentConfig directly; schema expects { agent: AgentConfig }
    const agent = await m.getAgentDetail(params.sessionId, params.agentName);
    return { agent } as R<"agent.getAgentDetail">;
  });

  r("agent.getAllTools", async (params) => {
    // CLI returns tool[] directly; schema expects { tools: tool[] }
    const tools = await m.getAllTools(params.sessionId);
    return { tools } as R<"agent.getAllTools">;
  });

  r("agent.getSystemPrompt", async (params) => {
    return m.getSystemPrompt(params.sessionId) as Promise<R<"agent.getSystemPrompt">>;
  });

  r("agent.getLatestAgentChange", async (params) => {
    const result = await m.getLatestAgentChange(params.sessionId);
    return result as unknown as Promise<R<"agent.getLatestAgentChange">>;
  });

  r("agent.batchGetSessionsStatus", async (params) => {
    return m.batchGetSessionsStatus(params.sessionIds);
  });
}
