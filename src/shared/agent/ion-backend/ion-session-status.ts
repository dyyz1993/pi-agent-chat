/**
 * ion 后端会话运行态富化。
 *
 * 会话登记归属 app（session.create 的文件扫描），运行态真相归属 ion host。
 * scanSessions 时用一次 manager 级 list_sessions 拿全部会话的 Idle/Busy，
 * 弥补进程池只覆盖"本 app 实例启动过"的会话（另一客户端/webui 在跑的会话也能显示 running）。
 *
 * ion 侧已知缺口（contract-matrix）：list_sessions 不含 title、不支持 cwd 过滤
 * ——标题与项目过滤仍来自 app 侧登记文件。
 */

import { IonSocketTransport } from "./ion-socket-transport";

export type IonSessionRuntimeStatus = "idle" | "running";

/** 一次 list_sessions → sessionId → 运行态。host 不可达时返回空 Map（会话列表仍可用）。 */
export async function fetchIonSessionStatuses(
  socketPath?: string,
): Promise<Map<string, IonSessionRuntimeStatus>> {
  const map = new Map<string, IonSessionRuntimeStatus>();
  const transport = new IonSocketTransport(socketPath);
  try {
    if (!(await transport.isHostReachable())) return map;
    const result = await transport.managerCall<Array<Record<string, unknown>>>("list_sessions", {});
    for (const session of result ?? []) {
      const id = session.session_id;
      if (typeof id !== "string") continue;
      const raw = session.status;
      map.set(id, typeof raw === "string" && raw.toLowerCase() === "idle" ? "idle" : "running");
    }
  } catch {
    // host 忙/协议异常：列表状态退回进程池视角，不阻塞 scanSessions
  }
  return map;
}

/** 会话内容元信息（host 直读 get_session_info，零 worker 拉起） */
export interface IonSessionInfo {
  messageCount: number;
  model: string | null;
}

/**
 * 并行取多个会话的内容元信息（messageCount 等）。
 * 用于 scanSessions 富化：ion 后端下 app 侧登记文件不含消息（内容在 ion），
 * 没有这个富化，所有 ion 会话都被当"空白会话"→ 新建会话复用旧会话 +
 * 空白 GC 误删有内容的会话登记（并发测试场景09 实锤）。
 * 单个失败跳过（该会话保持 disk 值），整体超时兜底。
 */
export async function fetchIonSessionInfos(
  sessionIds: string[],
  socketPath?: string,
): Promise<Map<string, IonSessionInfo>> {
  const out = new Map<string, IonSessionInfo>();
  if (sessionIds.length === 0) return out;
  const transport = new IonSocketTransport(socketPath);
  if (!(await transport.isHostReachable())) return out;
  const capped = sessionIds.slice(0, 50);
  await Promise.all(
    capped.map(async (sessionId) => {
      try {
        const info = await transport.sessionCall<{
          message_count?: number;
          model?: string;
        }>(sessionId, "get_session_info", {}, { timeoutMs: 5000 });
        if (info) {
          out.set(sessionId, {
            messageCount: typeof info.message_count === "number" ? info.message_count : 0,
            model: typeof info.model === "string" ? info.model : null,
          });
        }
      } catch {
        // 该会话不可读（如 running 拒读）——保持 disk 元数据
      }
    }),
  );
  return out;
}
