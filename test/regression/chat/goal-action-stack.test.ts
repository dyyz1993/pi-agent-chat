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

  it("creates a goal via handleCreateGoal (separate from handleSend)", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");

    // handleCreateGoal is a separate code path that calls setGoal
    // It is triggered by onSend when goalMode is true
    const handleCreateGoalIndex = source.indexOf("const handleCreateGoal");
    const setGoalCallIndex = source.indexOf("await setGoal(activeSessionId, objective)", handleCreateGoalIndex);
    const goalModeDispatchIndex = source.indexOf("goalMode ? handleCreateGoal : handleSend");

    expect(handleCreateGoalIndex).toBeGreaterThan(-1);
    expect(setGoalCallIndex).toBeGreaterThan(handleCreateGoalIndex);
    expect(goalModeDispatchIndex).toBeGreaterThan(-1);

    // handleSend is a separate code path that calls sendMessage or sendSteer
    const handleSendMatch = source.indexOf("await sendMessage()");
    const sendSteerMatch = source.indexOf("await sendSteer()");

    expect(handleSendMatch).toBeGreaterThan(-1);
    expect(sendSteerMatch).toBeGreaterThan(-1);
  });

  it("routes desktop and mobile Goal buttons into composer mode", () => {
    const chatPanel = readSource("src/mainview/components/chat/ChatPanel.tsx");
    const attachmentButtons = readSource("src/mainview/components/chat/FileAttachment.tsx");
    const quickActionToolbar = readSource("src/mainview/components/chat/QuickActionToolbar.tsx");

    expect(chatPanel).toContain("<AttachmentButtons onGoalClick={() => startGoalMode()} />");
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

  it("keeps the mobile Goal card to one compact row with only cancel action", () => {
    const goalCard = readSource("src/mainview/components/chat/GoalActionCard.tsx");
    const mobileStart = goalCard.indexOf("sm:hidden flex items-center");
    const desktopStart = goalCard.indexOf("hidden sm:flex items-start");
    const mobileBlock = goalCard.slice(mobileStart, desktopStart);

    expect(mobileStart).toBeGreaterThan(-1);
    expect(desktopStart).toBeGreaterThan(mobileStart);
    expect(mobileBlock).toContain("truncate min-w-0");
    // 触摸目标 ≥ 44px（Apple HIG）：h-11 / min-h-11 均可
    expect(mobileBlock).toMatch(/h-11|min-h-11/);
    expect(mobileBlock).not.toContain("Pencil");
    expect(mobileBlock).not.toContain("ListChecks");
  });

  it("makes the right panel Goal destination explicit", () => {
    const layoutTypes = readSource("src/mainview/layouts/types.ts");
    const rightSidebar = readSource("src/mainview/components/right-sidebar/RightSidebar.tsx");
    const statusPanel = readSource("src/mainview/components/status-panel/StatusPanel.tsx");
    const goalCard = readSource("src/mainview/components/chat/GoalActionCard.tsx");

    expect(layoutTypes).toContain('{ id: "status", label: "Goal" }');
    expect(rightSidebar).toContain("status: Target");
    expect(statusPanel).toContain('t("supervisor.goldRecords")');
    expect(statusPanel).toContain('t("supervisor.gold.empty")');
    expect(goalCard).toContain('openStatusPanel("status")');
    expect(goalCard).toContain('expandStatusSection("supervisor")');
  });

  it("separates Goal status labels from enable and disable actions", () => {
    const statusPanel = readSource("src/mainview/components/status-panel/StatusPanel.tsx");
    const zh = readSource("src/mainview/locales/zh-CN/status.json");

    expect(statusPanel).toContain('t("supervisor.runtimeState")');
    expect(statusPanel).toContain('t("supervisor.switchState")');
    expect(statusPanel).toContain('t("supervisor.action.enable")');
    expect(statusPanel).toContain('t("supervisor.action.disable")');
    expect(zh).toContain('"supervisor.action.enable": "启用 Goal"');
    expect(zh).toContain('"supervisor.action.disable": "禁用 Goal"');
  });
});
