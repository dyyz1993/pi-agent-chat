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
export async function fetchIonSessionStatuses(socketPath?: string): Promise<Map<string, IonSessionRuntimeStatus>> {
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
