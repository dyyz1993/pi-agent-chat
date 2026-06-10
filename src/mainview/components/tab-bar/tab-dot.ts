import type { SessionStatus } from "../../../shared/modules/project";

/**
 * 项目在 TabBar 上的"已知性"：
 * - "unknown"：sessions 还没加载（sessionsByProject[tab.path] === undefined）。
 *   此时不能默认显示 idle 绿色（会和"已加载但都 idle"撞色，造成用户看到
 *   的 strobe 错觉：「明明是绿点却一会儿变绿一会儿变黄」）。
 *   必须用中性色，让"还没加载"和"已加载且 idle"在视觉上区分开。
 * - "loaded"：sessions 已经加载完成。
 */
export type ProjectKnowledge = "unknown" | "loaded";

/**
 * 解析 TabBar 上项目状态点的颜色 / 动画。
 * @param knowledge "unknown" 表示项目 sessions 尚未加载（与"已加载且都 idle"区分开）。
 *                  "loaded" 才进入按 session 状态计算颜色的路径。
 * @param sessions  项目的 session 列表（loaded 时通常非空；空数组也是合法 idle）。
 * @param statusMap sessionId → SessionStatus 的映射（来自 sessionStatusMap）。
 */
export function resolveDotClass(
  knowledge: ProjectKnowledge,
  sessions: { sessionId: string }[],
  statusMap: Record<string, SessionStatus | undefined>,
): string {
  if (knowledge === "unknown") {
    // 中性色（淡灰），与已加载的 idle（绿）明确区分。
    // 这样首次渲染时不会出现"绿→其他色"的视觉跳变。
    return "bg-text-tertiary/40";
  }

  // 两遍扫描：permission/retrying 优先级最高（红色），其次是 streaming/compacting（黄+pulse）。
  // 如果只做单遍且 sessions 顺序中 streaming 在前，permission 会被遮住，
  // 表现为"项目明明有 pending permission 却显示黄色 pulse"的隐性 bug。
  let hasStreaming = false;
  for (const s of sessions) {
    const st = statusMap[s.sessionId];
    if (st === "permission" || st === "retrying") return "bg-status-error";
    if (st === "streaming" || st === "compacting") hasStreaming = true;
  }
  if (hasStreaming) return "bg-status-warning animate-pulse";
  return "bg-status-success";
}

/**
 * 是否需要在该项目 tab 上显示 permission 角标。
 * 未加载的项目（knowledge=unknown）必须返回 false，否则会在加载前误报角标。
 */
export function hasPermissionPending(
  knowledge: ProjectKnowledge,
  sessions: { sessionId: string }[],
  statusMap: Record<string, SessionStatus | undefined>,
): boolean {
  if (knowledge === "unknown") return false;
  return sessions.some((s) => statusMap[s.sessionId] === "permission");
}
