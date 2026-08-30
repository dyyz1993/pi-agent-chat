/**
 * Goal contract / objective fixtures for E2E tests.
 *
 * The contract is intentionally minimal (file_exists check, no authorities)
 * to avoid the goal-vendor "verification path leaves workspace" / authority
 * mismatches we hit during the c479c27b investigation.
 */

export const SAMPLE_OBJECTIVE = `开发一个可运行的"打飞机"网页小游戏：
- 玩家方向键移动飞机
- 自动发射子弹
- 敌机下落，击落得分
- 碰撞失败
用 vanilla HTML/CSS/JS 实现，浏览器打开即玩。`;

export function buildSampleContract(projectPath: string): {
  outcome: string;
  workspaceRoots: string[];
  criteria: string[];
  phases: Array<{ id: string; title: string; criterionIds: string[]; dependsOn?: string[] }>;
  verificationChecks: Array<{ id: string; kind: string; label: string; path: string }>;
  authorities: unknown[];
  constraints: string[];
  nonGoals: string[];
} {
  return {
    // Must faithfully restate SAMPLE_OBJECTIVE: goal-vendor's contract-hijack
    // guard rejects submissions whose outcome covers <20% of the objective's
    // token/bigram set, and the old terse one-liner scored 7/45 (0.155).
    outcome: `开发一个可运行的"打飞机"网页小游戏：玩家方向键移动飞机，自动发射子弹，敌机下落击落得分，碰撞失败；用 vanilla HTML/CSS/JS 实现，浏览器打开即玩`,
    workspaceRoots: [projectPath],
    criteria: ["完成可运行游戏", "happy path + 边界", "README 说明"],
    phases: [
      { id: "P1", title: "Inspect workspace", criterionIds: ["AC1"] },
      { id: "P2", title: "Implement game", dependsOn: ["P1"], criterionIds: ["AC1", "AC2"] },
      { id: "P3", title: "Validate + README", dependsOn: ["P2"], criterionIds: ["AC3"] },
    ],
    // Use relative paths so goal-vendor resolves them against workspaceRoot
    // — avoids the /var ↔ /private/var symlink mismatch on macOS.
    verificationChecks: [
      { id: "VC1", kind: "file_exists", label: "README exists", path: "README.md" },
    ],
    authorities: [],
    constraints: ["Do not perform npm install or package registry actions", "Use vanilla HTML/CSS/JS"],
    nonGoals: ["Backend, multiplayer, leaderboards"],
  };
}

/** Initial disabled goal status (no goal set). */
export const DISABLED_STATUS = {
  enabled: false,
  state: "disabled" as const,
  rawStatus: "none",
  rawPhase: "none",
  continuationSequence: 0,
  turnCount: 0,
};

/** Goal running status used by mock-rpc to fake the UI into showing the
 *  vendor card with purple Target icon + Loop button pulsing. */
export const RUNNING_STATUS = {
  enabled: true,
  state: "running" as const,
  rawStatus: "running",
  rawPhase: "executing",
  continuationSequence: 1,
  turnCount: 0,
  objective: SAMPLE_OBJECTIVE,
  goalId: "mock-goal-id",
  generation: 1,
};

/** Goal setup status (yellow, "合同协商中"). */
export const SETUP_STATUS = {
  enabled: true,
  state: "setup" as const,
  rawStatus: "setting_up",
  rawPhase: "setup",
  continuationSequence: 0,
  turnCount: 0,
  objective: SAMPLE_OBJECTIVE,
  goalId: "mock-goal-id",
  generation: 1,
};

/** Goal completed status (green, hidden after). */
export const COMPLETED_STATUS = {
  enabled: false,
  state: "idle" as const,
  rawStatus: "completed",
  rawPhase: "done",
  continuationSequence: 1,
  turnCount: 1,
  objective: SAMPLE_OBJECTIVE,
  goalId: "mock-goal-id",
  generation: 1,
};
