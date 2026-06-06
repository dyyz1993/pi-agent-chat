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

  it("creates a goal before sending the objective as the user message", () => {
    const source = readSource("src/mainview/components/chat/ChatPanel.tsx");
    const setGoalIndex = source.indexOf("await setGoal(activeSessionId, objective)");
    const sendMessageIndex = source.indexOf("await sendMessage()", setGoalIndex);
    const sendSteerIndex = source.indexOf("await sendSteer()", setGoalIndex);

    expect(setGoalIndex).toBeGreaterThan(-1);
    expect(sendSteerIndex).toBeGreaterThan(setGoalIndex);
    expect(sendMessageIndex).toBeGreaterThan(setGoalIndex);
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
    expect(mobileBlock).toContain("w-11 h-11");
    expect(mobileBlock).not.toContain("Pencil");
    expect(mobileBlock).not.toContain("ListChecks");
  });

  it("makes the right panel Goal destination explicit", () => {
    const layoutTypes = readSource("src/mainview/layouts/types.ts");
    const rightSidebar = readSource("src/mainview/components/right-sidebar/RightSidebar.tsx");
    const statusPanel = readSource("src/mainview/components/status-panel/StatusPanel.tsx");

    expect(layoutTypes).toContain('{ id: "status", label: "Goal" }');
    expect(rightSidebar).toContain("status: Target");
    expect(statusPanel).toContain('t("supervisor.goldRecords")');
    expect(statusPanel).toContain('t("supervisor.gold.empty")');
  });
});
