import type { RPCServer } from "@dyyz1993/rpc-core";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { HandlerOptions, P, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { AgentProcessManager } from "../agent/process-manager";
import { RemoteSshConfigureGuard } from "../agent/remote-ssh-config-guard";
import { REMOTE_SSH_METHODS } from "../constants/channel-methods";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";
import {
  getLegacyTrustStorePath,
  getProjectTrustStorePath,
  normalizeProjectPath,
} from "../lib/pi-agent-paths";
import {
  readProjectExecutionSandbox,
  writeProjectExecutionSandbox,
  normalizeExecutionSandboxMode,
} from "../lib/execution-sandbox-config";
import { getRemoteProjectSshRuntimeKind } from "../agent/remote-runtime-selection";
import {
  listDisabledSkills,
  setDisabledSkill,
  listDisabledPlugins,
  setDisabledPlugin,
  getRemoteProjectByLocalPath,
} from "../lib/project-config";

const log = createLogger("agent");

let manager: AgentProcessManager | null = null;
const remoteSshConfigureGuard = new RemoteSshConfigureGuard();

function getManager(): AgentProcessManager {
  if (!manager) {
    throw new Error("AgentProcessManager not initialized");
  }
  return manager;
}

type TrustFile = Record<string, boolean | null | undefined>;

interface ProjectTrustSubject {
  requestProjectPath: string;
  trustProjectPath: string;
}

function readTrustFile(path: string): TrustFile {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf-8");
  const parsed = JSON.parse(raw) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Invalid trust store ${path}: expected an object`);
  }
  const data: TrustFile = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== true && value !== false && value !== null) {
      throw new Error(
        `Invalid trust store ${path}: value for ${JSON.stringify(key)} must be true, false, or null`,
      );
    }
    data[key] = value as boolean | null;
  }
  return data;
}

function writeTrustFile(path: string, data: TrustFile): void {
  const sorted: TrustFile = {};
  for (const key of Object.keys(data).sort()) {
    const value = data[key];
    if (value === true || value === false || value === null) {
      sorted[key] = value;
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(sorted, null, 2)}\n`, "utf-8");
}

function findProjectTrustEntry(
  data: TrustFile,
  projectPath: string,
): { path: string; decision: boolean } | null {
  let current = normalizeProjectPath(projectPath);
  while (true) {
    const decision = data[current];
    if (decision === true || decision === false) {
      return { path: current, decision };
    }
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readProjectTrustEntry(
  projectPath: string,
): { path: string; decision: boolean; trustStorePath: string } | null {
  let current = normalizeProjectPath(projectPath);
  while (true) {
    const trustStorePath = getProjectTrustStorePath(current);
    const decision = readTrustFile(trustStorePath).decision;
    if (decision === true || decision === false) {
      return { path: current, decision, trustStorePath };
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  const legacyTrustStorePath = getLegacyTrustStorePath();
  const legacyEntry = findProjectTrustEntry(readTrustFile(legacyTrustStorePath), projectPath);
  return legacyEntry ? { ...legacyEntry, trustStorePath: legacyTrustStorePath } : null;
}

function remoteTrustProjectPath(remoteProject: { host: string; remotePath: string }): string {
  const hostSegment = encodeURIComponent(remoteProject.host);
  const remotePath = `/${remoteProject.remotePath.replace(/^\/+/, "")}`.replace(/\/+$/, "") || "/";
  return normalizeProjectPath(`/__pi_remote__/ssh/${hostSegment}${remotePath}`);
}

async function resolveProjectTrustSubject(projectPath: string): Promise<ProjectTrustSubject> {
  const requestProjectPath = normalizeProjectPath(projectPath);
  const remoteProject = await getRemoteProjectByLocalPath(requestProjectPath).catch(() => null);
  if (!remoteProject) {
    return { requestProjectPath, trustProjectPath: requestProjectPath };
  }
  return {
    requestProjectPath,
    trustProjectPath: remoteTrustProjectPath(remoteProject),
  };
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
    const remoteProject = await getRemoteProjectByLocalPath(params.projectPath);
    if (remoteProject && getRemoteProjectSshRuntimeKind(remoteProject) === "ssh-command") {
      log.info("configuring remote ssh runtime for project", {
        sessionId: params.sessionId,
        projectPath: params.projectPath,
        host: remoteProject.host,
        remotePath: remoteProject.remotePath,
      });
      const remoteConfigureConfig = {
        enabled: true,
        host: remoteProject.host,
        remoteCwd: remoteProject.remotePath,
        sshArgs: remoteProject.sshArgs,
        shell: remoteProject.shell,
        persist: false,
      };
      const ensureResult = await remoteSshConfigureGuard.ensure({
        sessionId: params.sessionId,
        config: remoteConfigureConfig,
        force: result.status === "started",
        configure: () =>
          withTimeout(
            m.callChannel(params.sessionId, "remote-ssh", REMOTE_SSH_METHODS.CONFIGURE, {
              enabled: true,
              host: remoteProject.host,
              remoteCwd: remoteProject.remotePath,
              sshArgs: remoteProject.sshArgs,
              shell: remoteProject.shell,
              persist: false,
            }),
            15_000,
            "remote ssh configure",
          ) as Promise<R<"agent.remoteSshConfigure">>,
      });
      if (ensureResult.skipped || ensureResult.joined) {
        log.info("remote ssh runtime configure reused", {
          sessionId: params.sessionId,
          projectPath: params.projectPath,
          skipped: ensureResult.skipped,
          joined: ensureResult.joined,
        });
      }
      if (ensureResult.result && !ensureResult.result.ok) {
        await m.stop(params.sessionId).catch((err: unknown) => {
          log.warn("failed to stop agent after remote ssh configure failure", {
            sessionId: params.sessionId,
            error: err instanceof Error ? err.message : String(err),
          });
        });
        throw new Error(
          `Failed to configure SSH remote runtime for ${remoteProject.remotePath}: ${
            ensureResult.result.error ?? "unknown error"
          }`,
        );
      }
    }
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
    if (ok) {
      remoteSshConfigureGuard.invalidateSession(params.sessionId);
    }
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
      fromStart: params.fromStart,
    });
    return {
      messages: result.messages,
      customEntries: result.customEntries,
      hasMore: result.hasMore,
      totalCount: result.totalCount,
      nextCursor: result.nextCursor,
    } as R<"agent.getFullMessages">;
  });

  r("agent.getFullMessagesAround", async (params) => {
    const result = await m.getFullMessagesAround(params.sessionId, params.sessionPath, {
      targetEntryId: params.targetEntryId,
      before: params.before,
      after: params.after,
    });
    return {
      messages: result.messages,
      customEntries: result.customEntries,
      hasMoreBefore: result.hasMoreBefore,
      hasMoreAfter: result.hasMoreAfter,
      beforeCursor: result.beforeCursor,
      afterCursor: result.afterCursor,
      targetFound: result.targetFound,
      totalCount: result.totalCount,
    } as R<"agent.getFullMessagesAround">;
  });

  r("agent.getMessageNavPage", async (params: P<"agent.getMessageNavPage">) => {
    const rawBeforeEntryId = (params as Record<string, unknown>).beforeEntryId;
    const beforeEntryId =
      typeof rawBeforeEntryId === "string" ? rawBeforeEntryId : undefined;
    const result = await m.getMessageNavPage(params.sessionId, params.sessionPath, {
      limit: params.limit,
      afterEntryId: params.afterEntryId,
      beforeEntryId,
      fromStart: params.fromStart,
    });
    return {
      messages: result.messages,
      hasMore: result.hasMore,
      totalCount: result.totalCount,
      nextCursor: result.nextCursor,
    } as R<"agent.getMessageNavPage">;
  });

  r("agent.steer", async (params) => {
    const ok = m.steer(params.sessionId, params.content, params.images, {
      promote: params.promote,
      immediate: params.immediate,
    });
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
    return m.setModelFromName(params.sessionId, params.model, {
      parentSessionId: params.parentSessionId,
      projectPath: params.projectPath,
    }) as Promise<R<"agent.setModel">>;
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
    return m.clearQueue(params.sessionId, params.item) as Promise<R<"agent.clearQueue">>;
  });

  r("agent.promoteQueuedFollowUp", async (params) => {
    return m.promoteQueuedFollowUp(params.sessionId, params.item) as Promise<
      R<"agent.promoteQueuedFollowUp">
    >;
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
    const disabledPlugins = await setDisabledPlugin(
      params.projectPath,
      params.pluginPath,
      params.disabled,
    );
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

  r("agent.getProjectTrust", async (params) => {
    const { requestProjectPath, trustProjectPath } = await resolveProjectTrustSubject(
      params.projectPath,
    );
    const entry = readProjectTrustEntry(trustProjectPath);
    return {
      projectPath: requestProjectPath,
      trusted: entry?.decision === true,
      decision: entry?.decision ?? null,
      decisionPath: entry?.path,
      trustStorePath: entry?.trustStorePath ?? getProjectTrustStorePath(trustProjectPath),
    };
  });

  r("agent.setProjectTrust", async (params) => {
    const { requestProjectPath, trustProjectPath } = await resolveProjectTrustSubject(
      params.projectPath,
    );
    const trustStorePath = getProjectTrustStorePath(trustProjectPath);
    const data = readTrustFile(trustStorePath);
    data.decision = params.trusted;
    writeTrustFile(trustStorePath, data);
    return {
      projectPath: requestProjectPath,
      trusted: params.trusted,
      decision: params.trusted,
      decisionPath: trustProjectPath,
      trustStorePath,
    };
  });

  r("agent.getExecutionSandbox", async (params) => {
    return readProjectExecutionSandbox(params.projectPath);
  });

  r("agent.setExecutionSandbox", async (params) => {
    return writeProjectExecutionSandbox(
      params.projectPath,
      normalizeExecutionSandboxMode(params.mode),
    );
  });

  r("agent.remoteSshGetStatus", async (params) => {
    return withTimeout(
      m.callChannel(params.sessionId, "remote-ssh", REMOTE_SSH_METHODS.GET_STATUS, {}),
      5_000,
      "remote ssh status",
    ) as Promise<R<"agent.remoteSshGetStatus">>;
  });

  r("agent.remoteSshConfigure", async (params) => {
    const { sessionId, ...config } = params;
    const result = (await withTimeout(
      m.callChannel(sessionId, "remote-ssh", REMOTE_SSH_METHODS.CONFIGURE, config),
      15_000,
      "remote ssh configure",
    )) as R<"agent.remoteSshConfigure">;
    if (result.ok) {
      remoteSshConfigureGuard.markConfigured(sessionId, config);
    }
    return result;
  });

  r("agent.remoteSshDisable", async (params) => {
    const result = (await withTimeout(
      m.callChannel(params.sessionId, "remote-ssh", REMOTE_SSH_METHODS.DISABLE, {
        persist: params.persist,
      }),
      5_000,
      "remote ssh disable",
    )) as R<"agent.remoteSshDisable">;
    if (result.ok) {
      remoteSshConfigureGuard.invalidateSession(params.sessionId);
    }
    return result;
  });

  r("agent.remoteSshTestConnection", async (params) => {
    const { sessionId, ...config } = params;
    return withTimeout(
      m.callChannel(sessionId, "remote-ssh", REMOTE_SSH_METHODS.TEST_CONNECTION, config),
      15_000,
      "remote ssh test connection",
    ) as Promise<R<"agent.remoteSshTestConnection">>;
  });

  r("agent.remoteSshSmokeTest", async (params) => {
    return withTimeout(
      m.callChannel(params.sessionId, "remote-ssh", REMOTE_SSH_METHODS.SMOKE_TEST, {
        subdir: params.subdir,
        text: params.text,
      }),
      15_000,
      "remote ssh smoke test",
    ) as Promise<R<"agent.remoteSshSmokeTest">>;
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

  r("agent.deleteEntries", async (params) => {
    const result = await m.deleteEntries(params.sessionId, params.targetIds);
    return { ok: true, entryId: result.entryId };
  });

  r("agent.summarizeEntries", async (params) => {
    const result = await m.summarizeEntries(params.sessionId, params.targetIds, {
      summary: params.summary,
      model: params.model,
    });
    return { ok: true, entryId: result.entryId };
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
      params.fromHash,
      params.toHash,
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
