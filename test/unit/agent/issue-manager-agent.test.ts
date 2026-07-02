import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readIssueManagerAgent(): string {
  return readFileSync(resolve(process.cwd(), ".pi/agents/issue-manager.md"), "utf8");
}

function frontmatterOf(markdown: string): string {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) throw new Error("Agent file is missing YAML frontmatter");
  return match[1];
}

describe("project issue-manager agent", () => {
  it("defines a project issue intake agent without a tool whitelist", () => {
    const markdown = readIssueManagerAgent();
    const frontmatter = frontmatterOf(markdown);

    expect(frontmatter).toContain("name: issue-manager");
    expect(frontmatter).toContain("permissionMode: always-allow");
    expect(frontmatter).not.toMatch(/^tools:/m);
  });

  it("keeps the main-session role limited to delegated validation and issue filing", () => {
    const markdown = readIssueManagerAgent();

    expect(markdown).toContain("不自己排查代码");
    expect(markdown).toContain("不自己修代码");
    expect(markdown).toContain("session_delegate");
    expect(markdown).toContain("gh issue create");
    expect(markdown).toContain("Validation session");
  });
});
