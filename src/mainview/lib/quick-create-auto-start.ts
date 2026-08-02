import type { GoalDraftContract, GoalVendorStatus } from "../../shared/modules/goal";

export interface QuickCreateAutoStartPlan {
  goal: string;
  techStack: string[];
  steps: string[];
  testing: string;
}

export interface QuickCreateAutoStart {
  requirement: string;
  description?: string;
  plan?: QuickCreateAutoStartPlan | null;
}

export interface QuickCreateAutoStartDeps {
  createNewSession: (projectPath: string) => Promise<{ sessionId: string; sessionPath?: string }>;
  startAgent?: (
    sessionId: string,
    projectPath: string,
    sessionPath: string,
  ) => Promise<{ status: "started" | "already_running" }>;
  setInputText: (text: string) => void;
  sendMessage: () => Promise<void>;
  startSetup: (
    sessionId: string,
    objective: string,
  ) => Promise<{ started: boolean; error?: string }>;
  submitContract?: (
    sessionId: string,
    contract: GoalDraftContract,
  ) => Promise<{ submitted: boolean; goalId?: string; status?: string; error?: string }>;
  fetchGoalStatus?: (sessionId: string) => Promise<GoalVendorStatus | null>;
  approveContract?: (sessionId: string) => Promise<{ approved: boolean; error?: string }>;
  addLog?: (message: string) => void;
}

export interface QuickCreateAutoStartOptions {
  waitMs?: (ms: number) => Promise<void>;
  maxGoalSetupAttempts?: number;
  maxContractApprovalAttempts?: number;
  signal?: AbortSignal;
}

function buildNumberedList(items: string[]): string[] {
  return items.map((item, index) => `${index + 1}. ${item}`);
}

export function buildQuickCreateGoalObjective(
  projectName: string,
  quickStart: QuickCreateAutoStart,
): string {
  const requirement = quickStart.requirement.trim();
  const plan = quickStart.plan ?? null;
  const trimmedGoal = plan?.goal?.trim() ?? "";
  const goal = trimmedGoal.length > 0 ? trimmedGoal : requirement;

  const lines = [
    "请直接开始完成这个快速创建项目，不需要再次询问我是否确认目标。",
    "",
    `项目名：${projectName}`,
    "",
    "目标：",
    goal,
  ];

  if (requirement && requirement !== goal) {
    lines.push("", "原始需求：", requirement);
  }

  const description = quickStart.description?.trim();
  if (description) {
    lines.push("", "项目说明：", description);
  }

  if (plan?.techStack?.length) {
    lines.push("", "建议技术栈：", plan.techStack.join(", "));
  }

  if (plan?.steps?.length) {
    lines.push("", "实施步骤：", ...buildNumberedList(plan.steps));
  }

  if (plan?.testing?.trim()) {
    lines.push("", "验收/测试要求：", plan.testing.trim());
  }

  lines.push(
    "",
    "Goal 合同规则：",
    "快速创建的 Goal 必须避免在合同的 authorities、phase commands 或 verification checks 中声明 `npm install`、`npm add`、`pnpm add`、`yarn add`、publish、login 等 package registry/install 动作；goal-vendor 会拒绝这类合同。优先使用无需安装依赖的实现，或只声明 build/test/run 等已存在脚本的验证。若确实需要安装依赖，执行阶段按普通权限策略处理，不要把它写进 Goal 合同。",
    "",
    "交付要求：",
    "完成一个可运行项目；按项目文档执行自动测试、构建检查和必要的 UI 验收；最后给出 validation packet，包含已测内容、证据、边界场景和未测风险。若建议技术栈需要未安装依赖，则优先交付无安装依赖的等效方案。",
    "",
    "执行边界：",
    "优先使用 read/write/edit 等结构化工具；需要 shell 时只运行单条简单命令，避免 `cd ... && ...`、管道、重定向、环境变量展开、`git -C`、`git branch` 等会触发 typed command 边界的形式。若只需查看 Git 状态，使用 `git status --short`。",
  );

  return lines.join("\n");
}

export function buildQuickCreateGoalContract(
  projectPath: string,
  projectName: string,
  quickStart: QuickCreateAutoStart,
): GoalDraftContract {
  const objective = buildQuickCreateGoalObjective(projectName, quickStart);
  const requirement = quickStart.requirement.trim();
  const root = projectPath.replace(/\/+$/, "");
  const verificationChecks: GoalDraftContract["verificationChecks"] = [
    {
      id: "VC1",
      kind: "file_exists",
      label: "README documents how to run and validate the project",
      path: `${root}/README.md`,
    },
    {
      id: "VC2",
      kind: "file_exists",
      label: "Quick-create delivery protocol exists",
      path: `${root}/QUICK_CREATE_DELIVERY.md`,
    },
    {
      id: "VC3",
      kind: "file_contains",
      label: "README records the requested project theme",
      path: `${root}/README.md`,
      pattern: projectName,
      regex: false,
    },
    {
      id: "VC4",
      kind: "command_exit",
      label: "Zero-dependency automated tests pass",
      executable: "node",
      args: ["test/runner.mjs"],
      cwd: root,
      expectedExitCode: 0,
      timeoutMs: 30_000,
    },
  ];

  return {
    outcome: objective,
    workspaceRoots: [projectPath],
    criteria: [
      `完成满足原始需求的可运行项目：${requirement}`,
      "主要交互流程完整，包含 happy path、边界场景和错误状态处理",
      "提供自动检查、人工验收证据、浏览器/UI 证据和残余风险记录",
    ],
    phases: [
      {
        id: "P1",
        title: "Inspect generated project context",
        description: "Read the generated README and delivery protocol, then choose a no-surprise implementation path.",
        criterionIds: ["AC1"],
      },
      {
        id: "P2",
        title: "Implement the project",
        description: "Create or update the project files needed for the requested runnable experience.",
        dependsOn: ["P1"],
        criterionIds: ["AC1", "AC2"],
      },
      {
        id: "P3",
        title: "Validate and document delivery",
        description: "Run available checks, perform UI acceptance, and write the validation packet.",
        dependsOn: ["P2"],
        criterionIds: ["AC3"],
      },
    ],
    verificationChecks,
    authorities: [
      {
        id: "AUTH_NODE_TEST",
        label: "Run zero-dependency unit tests via node",
        actionClass: "local_process",
        toolName: "bash",
        targets: [
          { path: "command.executable", equals: "node" },
          { path: "cwd", equals: root },
        ],
        command: {
          executable: "node",
          argsPrefix: ["test/runner.mjs"],
          trailingArgs: "none",
        },
        maxUses: 10,
      },
      {
        id: "AUTH_NODE_CHECK",
        label: "Syntax-check workspace source files via node --check",
        actionClass: "local_process",
        toolName: "bash",
        targets: [
          { path: "command.executable", equals: "node" },
          { path: "cwd", equals: root },
        ],
        command: {
          executable: "node",
          argsPrefix: ["--check"],
          trailingArgs: "workspace_paths",
        },
        maxUses: 20,
      },
    ],
    constraints: [
      "Do not declare package registry/install, publication, login, or credential actions in the Goal contract.",
      "Prefer no-install implementation paths when the request allows it.",
      "Do not delete generated files, lockfiles, dependency directories, git history, or files outside the project without explicit user approval.",
    ],
    nonGoals: ["Publishing, deployment, account login, or trademark work unless explicitly requested."],
  };
}

export async function runQuickCreateAutoStart(
  projectPath: string,
  projectName: string,
  quickStart: QuickCreateAutoStart,
  deps: QuickCreateAutoStartDeps,
  options: QuickCreateAutoStartOptions = {},
): Promise<{ sessionId: string; goalStarted: boolean; error?: string }> {
  const objective = buildQuickCreateGoalObjective(projectName, quickStart);
  const waitMs =
    options.waitMs ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const maxGoalSetupAttempts = options.maxGoalSetupAttempts ?? 5;
  const maxContractApprovalAttempts = options.maxContractApprovalAttempts ?? 30;
  const signal = options.signal;
  const cancelled = "cancelled by user";

  const { sessionId, sessionPath } = await deps.createNewSession(projectPath);
  if (deps.startAgent && deps.submitContract && deps.approveContract && sessionPath) {
    await deps.startAgent(sessionId, projectPath, sessionPath);
    const contract = buildQuickCreateGoalContract(projectPath, projectName, quickStart);
    let lastSubmitError: string | undefined;
    for (let attempt = 0; attempt < maxGoalSetupAttempts; attempt++) {
      if (signal?.aborted) {
        deps.addLog?.(`Quick create cancelled: ${projectName}`);
        return { sessionId, goalStarted: false, error: cancelled };
      }
      await waitMs(1000);
      const submission = await deps.submitContract(sessionId, contract);
      if (submission.submitted) {
        if (signal?.aborted) {
          deps.addLog?.(`Quick create cancelled: ${projectName}`);
          return { sessionId, goalStarted: false, error: cancelled };
        }
        deps.addLog?.(`Quick create goal contract submitted: ${projectName}`);
        const approval = await deps.approveContract(sessionId);
        if (approval.approved) {
          deps.addLog?.(`Quick create goal contract approved: ${projectName}`);
          return { sessionId, goalStarted: true };
        }
        const error = approval.error ?? "goal.approveContract failed";
        deps.addLog?.(`Quick create goal contract auto-approval failed: ${error}`);
        return { sessionId, goalStarted: false, error };
      }
      lastSubmitError = submission.error;
    }
    const error = lastSubmitError ?? "goal.submitContract did not become ready";
    deps.addLog?.(`Quick create project opened, but goal contract did not submit: ${error}`);
    return { sessionId, goalStarted: false, error };
  }

  deps.setInputText(objective);
  await deps.sendMessage();
  deps.setInputText("");

  let lastError: string | undefined;
  for (let attempt = 0; attempt < maxGoalSetupAttempts; attempt++) {
    if (signal?.aborted) {
      deps.addLog?.(`Quick create cancelled: ${projectName}`);
      return { sessionId, goalStarted: false, error: cancelled };
    }
    await waitMs(1000);
    const result = await deps.startSetup(sessionId, objective);
    if (result.started) {
      deps.addLog?.(`Quick create goal started: ${projectName}`);
      if (deps.fetchGoalStatus && deps.approveContract) {
        if (signal?.aborted) {
          return { sessionId, goalStarted: false, error: cancelled };
        }
        for (
          let approvalAttempt = 0;
          approvalAttempt < maxContractApprovalAttempts;
          approvalAttempt++
        ) {
          const status = await deps.fetchGoalStatus(sessionId);
          if (status?.rawStatus === "awaiting_approval") {
            const approval = await deps.approveContract(sessionId);
            if (approval.approved) {
              deps.addLog?.(`Quick create goal contract approved: ${projectName}`);
              return { sessionId, goalStarted: true };
            }
            const error = approval.error ?? "goal.approveContract failed";
            deps.addLog?.(`Quick create goal contract auto-approval failed: ${error}`);
            return {
              sessionId,
              goalStarted: false,
              error,
            };
          }
          if (
            status?.state === "running" ||
            status?.state === "checking" ||
            status?.rawStatus === "approved"
          ) {
            return { sessionId, goalStarted: true };
          }
          if (signal?.aborted) {
            deps.addLog?.(`Quick create cancelled: ${projectName}`);
            return { sessionId, goalStarted: false, error: cancelled };
          }
          await waitMs(1000);
        }

        deps.addLog?.("Quick create goal contract did not become ready for approval");
        return {
          sessionId,
          goalStarted: false,
          error: "goal contract did not become ready for approval",
        };
      }
      return { sessionId, goalStarted: true };
    }
    lastError = result.error;
  }

  const error = lastError ?? "goal.startSetup did not become ready";
  deps.addLog?.(`Quick create project opened, but goal setup did not start: ${error}`);
  return { sessionId, goalStarted: false, error };
}
