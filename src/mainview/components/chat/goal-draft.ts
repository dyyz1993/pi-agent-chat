/**
 * Goal draft markdown builder.
 *
 * Extracted from ChatPanel so the same shape can be reused by tests and
 * other call sites (e.g. quick-create auto-start) without dragging in the
 * 5500-line component.
 */

export interface GoalDraftContext {
  projectName: string;
  projectPath: string;
  sessionTitle: string;
  hint: string;
  messageCount: number;
  hasAttachments: boolean;
}

function normalizeDraftLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function buildGoalDraftObjective(hint: string, projectName: string): string {
  const firstMeaningfulLine = hint
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, "").trim())
    .find(Boolean);
  const fallback = `围绕 ${projectName} 生成一个可执行、可验收的开发目标。`;
  const objective = normalizeDraftLine(firstMeaningfulLine ?? "") || fallback;
  return objective.length > 96 ? `${objective.slice(0, 95)}...` : objective;
}

export function buildGoalDraftMarkdown(context: GoalDraftContext): string {
  const hint = normalizeDraftLine(context.hint);
  const projectName = normalizeDraftLine(context.projectName) || "当前项目";
  const sessionTitle = normalizeDraftLine(context.sessionTitle);
  const objective = buildGoalDraftObjective(context.hint, projectName);
  const source = [
    `项目：${projectName}`,
    context.projectPath ? `路径：${context.projectPath}` : "",
    sessionTitle ? `会话：${sessionTitle}` : "",
    context.messageCount > 0 ? `已参考当前会话 ${context.messageCount} 条消息` : "",
    context.hasAttachments ? "包含当前 composer 附件/上下文" : "",
  ]
    .filter(Boolean)
    .join("\n");

  return [
    `# Target: ${objective}`,
    "",
    "## Target Manifest",
    `- Target Name: ${objective}`,
    "- Target Type: Development Goal",
    `- Project: ${projectName}`,
    `- Entry: ${sessionTitle || "当前会话"}`,
    "- Scheme: Understand -> Implement -> Validate -> Deliver",
    "",
    "## 背景来源",
    source || "当前会话和当前项目。",
    "",
    "## 要解决的问题",
    hint || "当前还没有手写目标描述，需要先把项目上下文转成一个清晰的执行目标。",
    "",
    "## Scope",
    "- In Scope: 目标直接要求的代码、文档、测试和验证流程。",
    "- Out of Scope: 无关重构、批量删除、未确认的合并/发布。",
    "",
    "## Build Phases",
    "- 明确目标范围和不做的事情。",
    "- 检查相关代码、文档和现有测试。",
    "- 按小模块实现，避免混入无关改动。",
    "- 运行自动测试、构建或等价验证命令。",
    "- 对 UI/交互改动执行桌面端和移动端验收；涉及核心链路时先验 RPC/底层，再验 UI。",
    "",
    "## 验收标准",
    "- 目标对应的主要功能可以被用户直接看到或操作。",
    "- 自动测试或构建命令通过，并记录具体命令。",
    "- 至少覆盖一个 happy path 和一个边界/异常场景。",
    "- 如果产生临时预览端口，明确说明它只是预览地址，不是产品功能。",
    "",
    "## 风险与确认点",
    "- 不删除或回滚与本目标无关的未提交改动。",
    "- 遇到危险命令、批量删除、合并或提交前先确认。",
    "- 未覆盖的验收项需要在最终回复中明确说明。",
  ].join("\n");
}
