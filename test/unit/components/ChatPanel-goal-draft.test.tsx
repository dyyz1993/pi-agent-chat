import { describe, expect, it } from "vitest";
import { buildGoalDraftMarkdown } from "../../../src/mainview/components/chat/goal-draft";

describe("ChatPanel goal draft", () => {
  it("builds an Xcode-like target manifest for a goal draft", () => {
    const markdown = buildGoalDraftMarkdown({
      projectName: "pi-agent-chat",
      projectPath: "/tmp/pi-agent-chat",
      sessionTitle: "Goal planning",
      hint: "修复 Goal 草案编辑\n第二行是详细说明，不应该进入标题",
      messageCount: 12,
      hasAttachments: true,
    });

    expect(markdown).toContain("# Target: 修复 Goal 草案编辑");
    expect(markdown).toContain("## Target Manifest");
    expect(markdown).toContain("- Target Name: 修复 Goal 草案编辑");
    expect(markdown).toContain("- Target Type: Development Goal");
    expect(markdown).toContain("- Scheme: Understand -> Implement -> Validate -> Deliver");
    expect(markdown).toContain("## Scope");
    expect(markdown).toContain("## Build Phases");
    expect(markdown).toContain("涉及核心链路时先验 RPC/底层，再验 UI");
    expect(markdown).not.toContain("# Target: 修复 Goal 草案编辑 第二行是详细说明");
  });

  it("falls back to the current project when the user has not typed a hint", () => {
    const markdown = buildGoalDraftMarkdown({
      projectName: "",
      projectPath: "",
      sessionTitle: "",
      hint: "",
      messageCount: 0,
      hasAttachments: false,
    });

    expect(markdown).toContain("# Target: 围绕 当前项目 生成一个可执行、可验收的开发目标。");
    expect(markdown).toContain("- Project: 当前项目");
    expect(markdown).toContain("- Entry: 当前会话");
  });
});
