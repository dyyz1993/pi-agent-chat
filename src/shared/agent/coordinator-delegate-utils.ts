import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { writeFile } from "fs/promises";
import * as os from "os";
import * as path from "path";

export type DelegateSessionType = "coordinator" | "subagent";
export type CoordinatorSessionCreatedDelegateType = DelegateSessionType | "fork";
export type DelegateReplyMode = "auto" | "interrupt" | "followUp";

export interface DelegateReplyMetadata {
  task: string;
  title: string;
  projectPath: string;
  replyMode: DelegateReplyMode;
  agent?: string;
  params?: string;
}

export interface CoordinatorSessionCreatedPayload {
  parentSessionId: string;
  session: {
    sessionId: string;
    name: string;
    sessionPath: string;
    projectPath: string;
    parentSessionPath: string;
    delegateParentSessionId: string;
    delegateType: CoordinatorSessionCreatedDelegateType;
    agent?: string;
    messageCount: 0;
    firstMessage: string;
    createdAt: number;
    updatedAt: number;
    status: "running";
  };
}

export interface DelegateSessionPaths {
  projectPath: string;
  sessionPath: string;
  isCrossProject: boolean;
}

export function resolveDelegateSessionPaths(options: {
  parentProjectPath: string;
  parentSessionPath: string;
  newSessionId: string;
  rawProjectPath?: string;
  homeDir?: string;
}): DelegateSessionPaths {
  const projectPath = options.rawProjectPath ?? options.parentProjectPath;
  const isCrossProject =
    Boolean(options.rawProjectPath) && options.rawProjectPath !== options.parentProjectPath;
  let sessionDir: string;

  if (isCrossProject) {
    const encodedTarget = "--" + projectPath.replace(/^\//, "").replace(/\//g, "-") + "--";
    sessionDir = path.join(
      options.homeDir ?? os.homedir(),
      ".pi",
      "agent",
      "sessions",
      encodedTarget,
    );
    if (!existsSync(sessionDir)) mkdirSync(sessionDir, { recursive: true });
  } else {
    sessionDir = path.dirname(options.parentSessionPath);
  }

  return {
    projectPath,
    sessionPath: path.join(sessionDir, `${options.newSessionId}.jsonl`),
    isCrossProject,
  };
}

export async function writeDelegateSessionHeader(options: {
  sessionPath: string;
  newSessionId: string;
  projectPath: string;
  parentSessionId: string;
  parentSessionPath: string;
  delegateType: DelegateSessionType;
  permissionMode?: string;
  agent?: string;
  createdAt?: number;
  timestamp?: string;
}): Promise<void> {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const headerEntry = JSON.stringify({
    type: "session",
    version: 3,
    id: options.newSessionId,
    timestamp,
    cwd: options.projectPath,
    delegateParentSessionId: options.parentSessionId,
    permissionMode: options.permissionMode,
    agent: options.agent,
  });
  const delegateInfoEntry = JSON.stringify({
    type: "delegate_info",
    id: "delegate_info",
    parentId: null,
    timestamp,
    delegateParentSessionId: options.parentSessionId,
    parentSessionPath: options.parentSessionPath,
    delegateType: options.delegateType,
    agent: options.agent,
    createdAt: options.createdAt ?? Date.now(),
  });
  await writeFile(options.sessionPath, `${headerEntry}\n${delegateInfoEntry}\n`, "utf-8");
}

/**
 * Strip parentSession from a JSONL session file's header entry.
 * Prevents forked sessions from being identified as subagent children on refresh.
 */
export function stripParentSessionFromHeader(filePath: string): void {
  try {
    const content = readFileSync(filePath, "utf-8");
    const newlineIdx = content.indexOf("\n");
    if (newlineIdx < 0) return;
    const firstLine = content.slice(0, newlineIdx);
    const rest = content.slice(newlineIdx + 1);
    const header = JSON.parse(firstLine) as Record<string, unknown>;
    if ("parentSession" in header) {
      delete header.parentSession;
      writeFileSync(filePath, JSON.stringify(header) + "\n" + rest, "utf-8");
    }
  } catch {
    // Preserve the previous best-effort behavior for malformed or missing fork files.
  }
}

export function buildCoordinatorDelegatePrompt(options: {
  newSessionId: string;
  parentSessionId: string;
  title: string;
  task: string;
  projectPath: string;
  agent?: string;
  replyMode?: DelegateReplyMode;
}): string {
  const projectName = options.projectPath.split("/").pop() ?? options.projectPath;
  const replyMode = options.replyMode ?? "interrupt";
  const replyModeInstruction =
    replyMode === "followUp"
      ? "回传会排队到委派方当前轮结束后处理。"
      : replyMode === "auto"
        ? "委派方空闲时会立即处理回传；忙碌时会排队处理。"
        : "回传会作为打断式消息插入委派方，委派方不需要轮询状态。";
  const replyModeParamLine =
    replyMode === "auto"
      ? "   - mode: 可省略，由委派方创建时的默认回传策略决定"
      : `   - mode: ${replyMode === "interrupt" ? "steer" : "followUp"}`;
  return [
    `[系统提示] 你是一个被委派的后台任务会话。`,
    ``,
    `**你的身份信息：**`,
    options.agent ? `**Agent 角色:** ${options.agent}` : "",
    `- 你的会话 ID: ${options.newSessionId}`,
    `- 委派方（父会话）ID: ${options.parentSessionId}`,
    `- 任务: ${options.title}`,
    `- 项目路径: ${options.projectPath}`,
    `- 项目名称: ${projectName}`,
    ``,
    `**要求：**`,
    `1. 你是独立执行任务的助手，专注于完成委派给你的任务`,
    `2. 执行完毕后，请明确总结你的工作成果`,
    `3. 如果遇到问题无法继续，请说明原因`,
    `4. 这是异步委派任务；委派方不会轮询你的状态，也不应该反复调用 session_delegate_status 等你完成。你有中间进度或最终结果时，必须主动使用 session_delegate_send 工具回传给委派方：`,
    `   - targetSessionId: ${options.parentSessionId}`,
    `   - message: 你要反馈的内容`,
    replyModeParamLine,
    `5. 本次委派回传策略: ${replyMode}。${replyModeInstruction}`,
    `6. 最终结果发送成功后，不要等待委派方继续查询状态；除非任务本身要求继续等待，否则直接结束本轮。`,
    ``,
    `---`,
    ``,
    options.task,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildSyncDelegatePrompt(options: {
  task: string;
  rawTitle: string;
  agent?: string;
  projectPath: string;
}): string {
  const projectName = options.projectPath.split("/").pop() ?? options.projectPath;
  return [
    `[系统提示] 你是一个子代理任务会话。`,
    options.agent ? `**Agent 角色:** ${options.agent}` : "",
    `**任务:** ${options.rawTitle}`,
    `**项目:** ${projectName}`,
    `**项目路径:** ${options.projectPath}`,
    ``,
    `要求：`,
    `1. 专注于完成委派给你的任务`,
    `2. 执行完毕后，明确总结你的工作成果`,
    `3. 如果遇到问题无法继续，说明原因`,
    ``,
    `---`,
    ``,
    options.task,
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildCoordinatorSessionCreatedEvent(options: {
  parentSessionId: string;
  sessionId: string;
  name: string;
  sessionPath: string;
  projectPath: string;
  parentSessionPath: string;
  delegateType: CoordinatorSessionCreatedDelegateType;
  agent?: string;
  firstMessage: string;
  createdAt?: number;
}): CoordinatorSessionCreatedPayload {
  const createdAt = options.createdAt ?? Date.now();
  return {
    parentSessionId: options.parentSessionId,
    session: {
      sessionId: options.sessionId,
      name: options.name,
      sessionPath: options.sessionPath,
      projectPath: options.projectPath,
      parentSessionPath: options.parentSessionPath,
      delegateParentSessionId: options.parentSessionId,
      delegateType: options.delegateType,
      agent: options.agent,
      messageCount: 0,
      firstMessage: options.firstMessage,
      createdAt,
      updatedAt: createdAt,
      status: "running",
    },
  };
}

export function formatDelegateElapsed(createdAt: number, now = Date.now()): string {
  if (now < createdAt) return "0s";
  const elapsedMs = now - createdAt;
  return elapsedMs < 60000
    ? `${Math.max(1, Math.ceil(elapsedMs / 1000))}s`
    : `${Math.round(elapsedMs / 60000)}m`;
}

export function wrapDelegateReply(options: {
  sourceSessionId: string;
  targetSessionId: string;
  title: string;
  sequence: number;
  createdAt: number;
  elapsed: string;
  message: string;
  task?: string;
  agent?: string;
  projectPath?: string;
  replyMode?: string;
  params?: string;
}): string {
  const optionalAttrs = [
    ["task", options.task],
    ["agent", options.agent],
    ["projectPath", options.projectPath],
    ["replyMode", options.replyMode],
    ["params", options.params],
  ]
    .filter(
      (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].length > 0,
    )
    .map(([key, value]) => `${key}="${escapeXmlAttr(value)}"`)
    .join(" ");
  const attrs = [
    `from="${escapeXmlAttr(options.sourceSessionId)}"`,
    `sessionId="${escapeXmlAttr(options.sourceSessionId)}"`,
    `targetSessionId="${escapeXmlAttr(options.targetSessionId)}"`,
    `title="${escapeXmlAttr(options.title)}"`,
    `sequence="${options.sequence}"`,
    `createdAt="${options.createdAt}"`,
    `elapsed="${escapeXmlAttr(options.elapsed)}"`,
    `historyCount="${options.sequence}"`,
    optionalAttrs,
  ]
    .filter(Boolean)
    .join(" ");

  return [`<delegate-reply ${attrs}>`, options.message, `</delegate-reply>`].join("\n");
}

export function buildDelegateReplyParams(options: {
  title?: string;
  projectPath?: string;
  replyMode?: DelegateReplyMode;
  agent?: string;
}): string | undefined {
  const params: Record<string, string> = {};
  if (options.title) params.title = options.title;
  if (options.agent) params.agent = options.agent;
  if (options.projectPath) params.projectPath = options.projectPath;
  if (options.replyMode) params.replyMode = options.replyMode;
  return Object.keys(params).length > 0 ? JSON.stringify(params) : undefined;
}

function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
