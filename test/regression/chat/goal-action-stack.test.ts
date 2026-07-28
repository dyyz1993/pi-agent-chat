import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function readSource(path: string): string {
  return readFileSync(join(root, path), "utf-8");
}

describe("Goal action stack regression", () => {
  it("renders the Goal card above queued and pending action cards", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");
    const goalIndex = source.indexOf("<GoalActionCard");
    const queueIndex = source.indexOf("<QueueCards");
    const pendingIndex = source.indexOf("<ProjectRuntimePendingRequests");

    expect(goalIndex).toBeGreaterThan(-1);
    expect(queueIndex).toBeGreaterThan(goalIndex);
    expect(pendingIndex).toBeGreaterThan(queueIndex);
  });

  it("creates a goal and starts an agent turn only when the session is idle", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");

    // handleCreateGoal is a separate code path that calls setGoal.
    // It is triggered by onSend when goalMode is true
    const handleCreateGoalIndex = source.indexOf("const handleCreateGoal");
    const setGoalCallIndex = source.indexOf("await setGoal(activeSessionId, objective)", handleCreateGoalIndex);
    // Current implementation uses a `needsBootstrap` flag (idle or undefined)
    // to decide whether to bootstrap the subprocess with sendMessage first,
    // then retry setGoal, vs. setting the goal first then sending.
    const needsBootstrapIndex = source.indexOf("needsBootstrap", handleCreateGoalIndex);
    const idleCheckIndex = source.indexOf('effectiveStatus === "idle"', handleCreateGoalIndex);
    const bootstrapSendIndex = source.indexOf("await sendMessage()", handleCreateGoalIndex);
    const goalModeDispatchIndex = source.indexOf("goalMode ? handleCreateGoal : handleSend");

    expect(handleCreateGoalIndex).toBeGreaterThan(-1);
    expect(setGoalCallIndex).toBeGreaterThan(handleCreateGoalIndex);
    expect(needsBootstrapIndex).toBeGreaterThan(handleCreateGoalIndex);
    expect(idleCheckIndex).toBeGreaterThan(handleCreateGoalIndex);
    expect(bootstrapSendIndex).toBeGreaterThan(handleCreateGoalIndex);
    expect(goalModeDispatchIndex).toBeGreaterThan(-1);

    // handleSend still handles the normal chat path.
    const handleSendIndex = source.indexOf("const handleSend");
    const handleSendMatch = source.indexOf("await sendMessage()", handleSendIndex);
    const sendSteerMatch = source.indexOf("await sendSteer()");

    expect(handleSendMatch).toBeGreaterThan(handleSendIndex);
    expect(sendSteerMatch).toBeGreaterThan(-1);
  });

  it("routes desktop and mobile Goal buttons into composer mode", () => {
    const chatPanel = readSource("src/mainview/components/chat/ChatPanel.tsx");
    const attachmentButtons = readSource("src/mainview/components/chat/FileAttachment.tsx");
    const quickActionToolbar = readSource("src/mainview/components/chat/QuickActionToolbar.tsx");

    expect(chatPanel).toContain("layout=\"compact\"");
    expect(chatPanel).toContain("onGoalClick={() => startGoalMode()}");
    expect(chatPanel).toContain("<QuickActionToolbar onGoalClick={() => startGoalMode()} />");
    expect(attachmentButtons).toContain("if (onGoalClick)");
    expect(quickActionToolbar).toContain("if (onGoalClick)");
    expect(attachmentButtons).toContain("<Target");
    expect(quickActionToolbar).toContain("<Target");
    expect(attachmentButtons).not.toContain("<Shield");
    expect(quickActionToolbar).not.toContain("<Shield");
  });

  it("uses supervisor GoalState status and startedAt fields for card state and duration", () => {
    const goalCard = readSource("src/mainview/components/chat/GoalActionCard.tsx");

    expect(goalCard).toContain("goal.status");
    expect(goalCard).toContain("goal.startedAt");
    expect(goalCard).not.toContain("goal.state ===");
    expect(goalCard).not.toContain("goal.createdAt)");
  });

  it("uses a check-record icon for the Goal details action", () => {
    const goalCard = readSource("src/mainview/components/chat/GoalActionCard.tsx");

    expect(goalCard).toContain("ListChecks");
    expect(goalCard).not.toContain("ExternalLink");
  });

  it("shows supervisor check count instead of raw continuation count on the Goal card", () => {
    const goalCard = readSource("src/mainview/components/chat/GoalActionCard.tsx");

    expect(goalCard).toContain("triggerRecords.filter((record) => record.goalId === goal.id).length");
    expect(goalCard).toContain("status?.lastGoldResult?.goalId === goal.id");
    expect(goalCard).toContain(
      "Math.max(goal.continuationCount ?? 0, triggerCount, lastGoldResult ? 1 : 0)",
    );
    expect(goalCard).toContain("#{checkCount}");
    expect(goalCard).not.toContain("#{goal.continuationCount}");
  });

  it("colors completed Goal entry points with the success tone", () => {
    const attachmentButtons = readSource("src/mainview/components/chat/FileAttachment.tsx");
    const quickActionToolbar = readSource("src/mainview/components/chat/QuickActionToolbar.tsx");

    expect(attachmentButtons).toContain('if (!supervisorStatus?.goal) return "text-text-tertiary"');
    expect(attachmentButtons).toContain('goalStatus === "complete"');
    expect(attachmentButtons).toContain('return "text-status-success"');
    expect(quickActionToolbar).toContain(
      'if (!supervisorStatus?.goal) return "text-text-tertiary border border-transparent"',
    );
    expect(quickActionToolbar).toContain('goalStatus === "complete"');
    expect(quickActionToolbar).toContain(
      "text-status-success border border-status-success/40 bg-status-success/10",
    );
  });

  it("keeps the mobile Goal card compact while exposing panel and cancel actions", () => {
    const goalCard = readSource("src/mainview/components/chat/GoalActionCard.tsx");
    const mobileStart = goalCard.indexOf("sm:hidden flex items-center");
    const desktopStart = goalCard.indexOf("hidden sm:flex items-start");
    const mobileBlock = goalCard.slice(mobileStart, desktopStart);

    expect(mobileStart).toBeGreaterThan(-1);
    expect(desktopStart).toBeGreaterThan(mobileStart);
    expect(mobileBlock).toContain("min-w-0 flex-1");
    expect(mobileBlock).toContain("text-text-tertiary truncate");
    expect(mobileBlock).toContain("text-text-secondary truncate");
    expect(mobileBlock).toContain("goal.state.");
    expect(mobileBlock).toContain("{elapsed}");
    expect(mobileBlock).toContain("#{checkCount}");
    expect(mobileBlock).toContain("${checkSummary.done}/${checkSummary.total}");
    // 触摸目标 ≥ 44px（Apple HIG）：h-11 / min-h-11 均可
    expect(mobileBlock).toMatch(/h-11|min-h-11/);
    expect(mobileBlock).toContain("openGoalPanel");
    expect(mobileBlock).toContain("handleClearGoal");
    expect(mobileBlock).toContain("<MoreHorizontal");
    expect(mobileBlock).toContain("<X");
    expect(goalCard).toContain("const handleClearGoal");
    expect(goalCard).toContain("event?.stopPropagation()");
    expect(goalCard).toContain('clearGoal(sessionId, "user_cancelled")');
    expect(mobileBlock).not.toContain("Pencil");
    expect(mobileBlock).not.toContain("ListChecks");
  });

  it("makes the right panel Goal destination explicit", () => {
    const layoutTypes = readSource("src/mainview/layouts/types.ts");
    const rightSidebar = readSource("src/mainview/components/right-sidebar/RightSidebar.tsx");
    const statusPanel = readSource("src/mainview/components/status-panel/StatusPanel.tsx");
    const supervisorPanel = readSource("src/mainview/components/supervisor-panel/SupervisorPanel.tsx");
    const goalCard = readSource("src/mainview/components/chat/GoalActionCard.tsx");
    const zh = readSource("src/mainview/locales/zh-CN/chat.json");
    const en = readSource("src/mainview/locales/en/chat.json");

    expect(layoutTypes).toContain('{ id: "status", label: "状态" }');
    expect(layoutTypes).toContain('{ id: "supervisor", label: "守护" }');
    expect(rightSidebar).toContain("supervisor: ShieldCheck");
    expect(statusPanel).not.toContain('id === "supervisor"');
    expect(supervisorPanel).toContain('t("supervisor.goldRecords")');
    expect(supervisorPanel).toContain('t("supervisor.gold.empty")');
    expect(goalCard).toContain("event?.stopPropagation()");
    expect(goalCard).toContain('openStatusPanel("supervisor")');
    expect(goalCard).not.toContain('expandStatusSection("supervisor")');
    expect(zh).toContain('"goal.openPanel": "打开守护面板"');
    expect(en).toContain('"goal.openPanel": "Open supervisor panel"');
  });

  it("separates Goal status labels from enable and disable actions", () => {
    const supervisorPanel = readSource("src/mainview/components/supervisor-panel/SupervisorPanel.tsx");
    const zh = readSource("src/mainview/locales/zh-CN/status.json");

    expect(supervisorPanel).toContain('t("supervisor.runtimeState")');
    expect(supervisorPanel).toContain('t("supervisor.action.enable")');
    expect(supervisorPanel).toContain('t("supervisor.action.disable")');
    expect(zh).toContain('"supervisor.action.enable": "启用守护"');
    expect(zh).toContain('"supervisor.action.disable": "禁用守护"');
  });

  it("maps supervisor guard protocol names to user-facing labels", () => {
    const supervisorPanel = readSource("src/mainview/components/supervisor-panel/SupervisorPanel.tsx");
    const zh = readSource("src/mainview/locales/zh-CN/status.json");
    const en = readSource("src/mainview/locales/en/status.json");
    const supervisorTypes = readSource("src/shared/modules/supervisor.ts");

    expect(supervisorPanel).toContain("KNOWN_GUARD_KEYS");
    expect(supervisorPanel).toContain('"incomplete-keywords": "incompleteKeywords"');
    expect(supervisorPanel).toContain("getGuardLabel(t, g.guardName)");
    expect(supervisorPanel).toContain("getGuardLabel(t, g)");
    expect(supervisorPanel).toContain("getGuardLabel(t, tr.guardName)");
    expect(supervisorPanel).toContain("getGuardExecutionLabel");
    expect(supervisorPanel).toContain('t("supervisor.trigger.model")');
    expect(supervisorTypes).toContain("model?: string");
    expect(zh).toContain('"supervisor.continueCount": "自动续执行次数"');
    expect(zh).toContain('"supervisor.activeGuards": "活跃检查项"');
    expect(zh).toContain('"supervisor.guard.incompleteKeywords.label": "未完成标记检查"');
    expect(zh).toContain('"supervisor.guardExecution.keyword": "本地规则"');
    expect(en).toContain('"supervisor.continueCount": "Auto-continue count"');
    expect(en).toContain('"supervisor.activeGuards": "Active checks"');
    expect(en).toContain('"supervisor.guard.incompleteKeywords.label": "Incomplete marker check"');
    expect(en).toContain('"supervisor.guardExecution.keyword": "Local rule"');
  });

  it("loads the full supervisor snapshot on startup and reconnect", () => {
    const initialState = readSource("src/mainview/stores/session-initial-state.ts");
    const subscriptions = readSource("src/mainview/stores/session-subscriptions.ts");
    const supervisorStore = readSource("src/mainview/stores/use-supervisor-store.ts");

    expect(initialState).toContain("supervisorStore.fetchStatus(sessionId)");
    expect(initialState).toContain("supervisorStore.fetchTaskReport(sessionId)");
    expect(initialState).toContain("supervisorStore.fetchTriggerHistory(sessionId, 50)");

    expect(subscriptions).toContain("supervisorStore.fetchStatus(id)");
    expect(subscriptions).toContain("supervisorStore.fetchTaskReport(id)");
    expect(subscriptions).toContain("supervisorStore.fetchTriggerHistory(id, 50)");

    expect(supervisorStore).toContain("function mergeTriggerRecords");
    expect(supervisorStore).toContain("byKey.set(String(record.seq), record)");
    expect(supervisorStore).toContain("mergeTriggerRecords(session.triggerRecords, result.triggers)");
    expect(supervisorStore).toContain("mergeTriggerRecords(session.triggerRecords, [event.record])");
  });
});
