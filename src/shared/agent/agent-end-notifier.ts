/**
 * Agent-end push notifier (Drel channel).
 *
 * On agent_end, push a short notification with a deep link so the user can tap
 * it and land directly on the session page. Fire-and-forget: failures are
 * logged, never propagated into the agent event loop.
 *
 * Gating order (see shouldPushAgentEnd):
 *   1. DREL_KEY + PUBLIC_PI_CHAT_URL configured (deployment opt-in)
 *   2. user toggle (config.json notificationSettings.agentEndPushEnabled)
 *   3. connection-level presence (any alive WS client → suppress)
 *
 * Boundary: a push is navigation, not authorization. The URL carries only a
 * session locator plus the interim fixed AUTH_TOKEN (deep-link auth slice will
 * replace it); the body is a fixed, non-sensitive summary — never LLM output.
 *
 * Env:
 *   DREL_KEY           - Drel push address key (api.drel.app/<key>)
 *   PUBLIC_PI_CHAT_URL - public HTTPS base for deep links, no trailing slash
 */
import { basename } from "path";
import { createLogger } from "../lib/logger";
import { getNotificationSettings, type NotificationSettings } from "../lib/project-config";
import { config as serverConfig } from "../../server-config";

const log = createLogger("agent");

const DREL_API_BASE = "https://api.drel.app";
const MAX_BODY_CHARS = 200;
const PUSH_TIMEOUT_MS = 10_000;

export interface AgentEndPushInput {
  sessionId: string;
  projectPath?: string;
  outcomeStatus: string;
}

export interface PresenceStats {
  /** all alive WS clients, any device/browser */
  total: number;
  /** alive clients inside the Drel container (UA-classified) */
  drel: number;
}

type PresenceSource = () => PresenceStats;

let presenceSource: PresenceSource = () => ({ total: 0, drel: 0 });

/** Register the alive-WS-client counter (wired once from server.ts). */
export function setAgentEndPushPresenceSource(fn: PresenceSource): void {
  presenceSource = fn;
}

function getPresenceStats(): PresenceStats {
  try {
    const stats = presenceSource();
    return { total: stats.total ?? 0, drel: stats.drel ?? 0 };
  } catch {
    return { total: 0, drel: 0 };
  }
}

const DREL_UA_PATTERN = /drel/i;

export function isDrelUserAgent(ua: string | undefined | null): boolean {
  return typeof ua === "string" && DREL_UA_PATTERN.test(ua);
}

export interface PushDecision {
  push: boolean;
  reason: string;
}

export interface AgentEndPushGate {
  configured: boolean;
  enabled: boolean;
  hasBaseUrl: boolean;
  /** all alive WS clients */
  aliveClients: number;
  /** alive clients inside the Drel container */
  drelClients: number;
  /**
   * 在 Drel 内打开页面时静默（缺省开）：用户在 APP 里直接看得见，无需推送。
   * 只按 Drel 客户端计数抑制；桌面浏览器连接不影响推送必达。
   */
  presenceSuppress: boolean;
}

export function shouldPushAgentEnd(gate: AgentEndPushGate): PushDecision {
  if (!gate.configured) return { push: false, reason: "drel_not_configured" };
  if (!gate.hasBaseUrl) return { push: false, reason: "no_public_base_url" };
  if (!gate.enabled) return { push: false, reason: "disabled_by_user" };
  if (gate.drelClients > 0 && gate.presenceSuppress) {
    return { push: false, reason: "drel_client_online" };
  }
  return { push: true, reason: "ok" };
}

export function buildSessionDeepLink(baseUrl: string, sessionId: string, token: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  return `${base}/?session=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`;
}

const STATUS_LABELS: Record<string, string> = {
  completed: "任务完成",
  error: "任务出错",
  timeout: "任务超时",
  aborted: "任务已中止",
};

export function buildAgentEndNotification(input: AgentEndPushInput): {
  title: string;
  body: string;
} {
  const project = input.projectPath ? basename(input.projectPath) : "会话";
  const label = STATUS_LABELS[input.outcomeStatus] ?? "任务结束";
  // 敏感边界：正文只放固定摘要，不放 LLM 输出内容；防御性截断
  const body =
    "点开查看会话详情".length > MAX_BODY_CHARS
      ? `${"点开查看会话详情".slice(0, MAX_BODY_CHARS - 1)}…`
      : "点开查看会话详情";
  return {
    title: `${label} · ${project}`,
    body,
  };
}

export interface AgentEndPushOptions {
  getSettings?: () => Promise<NotificationSettings>;
}

// The same agent_end can be handled once per registered transport, and resumed
// sessions re-fire agent_end (e.g. reopening the page calls agent.start on an
// already-running session). Same-session completions within this window are
// treated as echoes of one notification.
const AGENT_END_DEDUPE_WINDOW_MS = 10 * 60_000;
const lastDeliveredAt = new Map<string, number>();

/** Test hook: clear the dedupe window. */
export function resetAgentEndPushDedupe(): void {
  lastDeliveredAt.clear();
}

export async function notifyAgentEnd(
  input: AgentEndPushInput,
  options?: AgentEndPushOptions,
): Promise<PushDecision> {
  const now = Date.now();
  if (now - (lastDeliveredAt.get(input.sessionId) ?? 0) < AGENT_END_DEDUPE_WINDOW_MS) {
    return { push: false, reason: "duplicate" };
  }

  const key = process.env.DREL_KEY ?? "";
  const baseUrl = process.env.PUBLIC_PI_CHAT_URL ?? "";

  let enabled = true;
  let immersiveOpen = true;
  let presenceSuppress = true;
  try {
    const load = options?.getSettings ?? getNotificationSettings;
    const settingsLoaded = await load();
    enabled = settingsLoaded.agentEndPushEnabled;
    immersiveOpen = settingsLoaded.immersiveOpen;
    presenceSuppress = settingsLoaded.presenceSuppress;
  } catch (err) {
    log.warn("agent_end push: failed to read settings, defaulting to enabled", {
      sessionId: input.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const stats = getPresenceStats();
  const settings: NotificationSettings = {
    agentEndPushEnabled: enabled,
    immersiveOpen,
    presenceSuppress,
  };
  const decision = shouldPushAgentEnd({
    configured: key.length > 0,
    enabled,
    hasBaseUrl: baseUrl.length > 0,
    aliveClients: stats.total,
    drelClients: stats.drel,
    presenceSuppress,
  });
  if (!decision.push) {
    log.debug("agent_end push skipped", { sessionId: input.sessionId, reason: decision.reason });
    return decision;
  }

  const { title, body } = buildAgentEndNotification(input);
  const token = serverConfig.authToken ?? "";
  const link = buildSessionDeepLink(baseUrl, input.sessionId, token);
  const payload = {
    title,
    body,
    url: link,
    // 官方 stable field：normal | modal | immersive；immersive 为全屏朝向容器
    mode: settings.immersiveOpen ? ("immersive" as const) : ("normal" as const),
    group: "pi-chat",
    threadId: input.sessionId,
    isArchive: 1,
  };

  const delivered = await deliverToDrel(payload, input.sessionId, "agent_end");
  if (delivered.accepted !== null && delivered.accepted > 0) {
    if (lastDeliveredAt.size > 200) lastDeliveredAt.clear();
    lastDeliveredAt.set(input.sessionId, Date.now());
  }
  return { push: delivered.push, reason: delivered.reason };
}

interface DrelDelivery {
  push: boolean;
  reason: string;
  accepted: number | null;
}

async function deliverToDrel(
  payload: Record<string, unknown>,
  sessionId: string,
  kind: string,
): Promise<DrelDelivery> {
  const key = process.env.DREL_KEY ?? "";
  if (!key) return { push: false, reason: "drel_not_configured", accepted: null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PUSH_TIMEOUT_MS);
    const resp = await fetch(`${DREL_API_BASE}/${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (resp.status !== 200) {
      log.warn(`${kind} push failed`, { sessionId, status: resp.status });
      return { push: false, reason: `http_${resp.status}`, accepted: null };
    }
    // 官方契约：只读 code/attempted/accepted，不解析 message 文案
    let accepted: number | null = null;
    try {
      const data = (await resp.json()) as { code?: number; accepted?: number };
      accepted = data.accepted ?? 0;
      if (data.code !== 200) {
        log.warn(`${kind} push rejected by relay`, { sessionId, code: data.code });
        return { push: false, reason: "relay_rejected", accepted: null };
      }
    } catch {
      log.warn(`${kind} push: non-JSON response`, { sessionId });
      return { push: false, reason: "bad_response", accepted: null };
    }
    log.info(`${kind} push delivered`, {
      sessionId,
      accepted,
      mode: payload.mode,
    });
    return { push: true, reason: "ok", accepted };
  } catch (err) {
    log.warn(`${kind} push error`, {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { push: false, reason: "fetch_error", accepted: null };
  }
}

// ---------------------------------------------------------------------------
// Approval / question pushes (askUserQuestion family: tool permissions, path
// boundary, goal approvals, plain agent questions). A push is navigation, not
// authorization — the user approves inside the opened session page.
// ---------------------------------------------------------------------------

const pushedRequestIds = new Set<string>();

/** Test hook: clear approval-request dedupe. */
export function resetApprovalPushDedupe(): void {
  pushedRequestIds.clear();
}

export interface ApprovalRequestPushInput {
  sessionId: string;
  projectPath?: string;
  requestId: string;
  method: string;
  title?: string;
  message?: string;
  metaType?: string;
  deepLinkBaseUrl: string;
}

const META_LABELS: Record<string, string> = {
  permission_runtime: "工具权限审批",
  path_boundary: "路径边界审批",
  goal_approval: "Goal 审批",
};

export function buildApprovalNotification(input: ApprovalRequestPushInput): {
  title: string;
  body: string;
} {
  const project = input.projectPath ? basename(input.projectPath) : "会话";
  const kind = META_LABELS[input.metaType ?? ""] ?? (input.metaType ? "审批请求" : "Agent 提问");
  // 敏感边界：正文只放标题的截断摘要，不放完整问题内容
  // 空字符串回退是有意行为（"" 和 undefined 都应回退）
  const snippetSource =
    input.title != null && input.title.length > 0
      ? input.title
      : input.message != null && input.message.length > 0
        ? input.message
        : "";
  const snippet = snippetSource.replace(/\s+/g, " ").trim();
  const clipped = snippet.length > MAX_BODY_CHARS ? `${snippet.slice(0, MAX_BODY_CHARS - 1)}…` : snippet;
  return {
    title: `${kind} · ${project}`,
    body: clipped || "点开查看并处理",
  };
}

export async function notifyApprovalRequest(
  input: ApprovalRequestPushInput,
  options?: AgentEndPushOptions,
): Promise<PushDecision> {
  if (input.requestId) {
    if (pushedRequestIds.has(input.requestId)) {
      return { push: false, reason: "duplicate" };
    }
    pushedRequestIds.add(input.requestId);
    if (pushedRequestIds.size > 500) pushedRequestIds.clear();
  }

  const key = process.env.DREL_KEY ?? "";
  let enabled = true;
  try {
    const load = options?.getSettings ?? getNotificationSettings;
    enabled = (await load()).agentEndPushEnabled;
  } catch (err) {
    log.warn("approval push: failed to read settings, defaulting to enabled", {
      sessionId: input.sessionId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  const decision = shouldPushAgentEnd({
    configured: key.length > 0,
    enabled,
    hasBaseUrl: input.deepLinkBaseUrl.length > 0,
    aliveClients: 0,
    // 审批不受 presence 抑制：需要用户动作的事必须响铃
    presenceSuppress: false,
  });
  if (!decision.push) {
    log.debug("approval push skipped", { sessionId: input.sessionId, reason: decision.reason });
    if (input.requestId) pushedRequestIds.delete(input.requestId);
    return decision;
  }

  const { title, body } = buildApprovalNotification(input);
  const token = serverConfig.authToken ?? "";
  const link = buildSessionDeepLink(input.deepLinkBaseUrl, input.sessionId, token);
  const payload = {
    title,
    body,
    url: link,
    mode: "normal" as const,
    group: "pi-chat",
    threadId: input.sessionId,
    isArchive: 1,
  };
  const delivered = await deliverToDrel(payload, input.sessionId, "approval");
  if (!delivered.push && input.requestId) {
    pushedRequestIds.delete(input.requestId);
  }
  return delivered;
}
