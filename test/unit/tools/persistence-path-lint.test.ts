import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractPersistenceContract,
  lintPersistencePaths,
  type PersistenceAllowlistEntry,
} from "../../../tools/persistence-path-lint";

const AGENTS_FIXTURE = `
### 持久化路径变量

| 变量 | 生成规则 | 说明 |
| --- | --- | --- |
| \`<PI_AGENT_DIR>\` | \`~/.pi/agent\` | agent root |
| \`<PROJECT_USER_STATE_DIR>\` | \`<PI_AGENT_DIR>/projects/<PROJECT_KEY>\` | project state |

### Extension 存储 API 现状

ignore this section

### 写入路径注册表（沙盒/挂载依据）

| 类别 | 路径 | 谁写入/读取 | 语义与约束 |
| --- | --- | --- | --- |
| Agent 认证/模型 | \`<PI_AGENT_DIR>/auth.json\`, \`<PI_AGENT_DIR>/models.json\` | auth | registered |
| Project-scoped 用户态 | \`<PROJECT_USER_STATE_DIR>/trust.json\`, \`<PROJECT_USER_STATE_DIR>/path-permissions.json\` | trust | registered |

写入规则：
`;

describe("persistence-path-lint", () => {
  it("extracts persistence variables and registered json files from AGENTS.md", () => {
    const contract = extractPersistenceContract(AGENTS_FIXTURE);

    expect(contract.pathVariables).toContain("PI_AGENT_DIR");
    expect(contract.pathVariables).toContain("PROJECT_USER_STATE_DIR");
    expect(contract.registeredJsonFiles).toContain("auth.json");
    expect(contract.registeredJsonFiles).toContain("models.json");
    expect(contract.registeredJsonFiles).toContain("trust.json");
  });

  it("blocks new hardcoded pi roots and undocumented json persistence paths", () => {
    const root = createFixtureRepo({
      "src/bad.ts": `
        import { join } from "node:path";
        import { homedir } from "node:os";
        export const badRoot = join(homedir(), ".pi", "agent", "new-feature");
        export const badJson = join(badRoot, "new-feature-state.json");
      `,
    });

    const report = lintPersistencePaths({ root });

    expect(report.blockingFindings.map((finding) => finding.ruleId)).toEqual(
      expect.arrayContaining(["hardcoded-pi-agent-root", "undocumented-json-path"]),
    );
    expect(report.allowedFindings).toHaveLength(0);
  });

  it("allows registered json names", () => {
    const root = createFixtureRepo({
      "src/good.ts": `
        import { join } from "node:path";
        export const trustPath = join("/tmp/project-state", "trust.json");
      `,
    });

    const report = lintPersistencePaths({ root });

    expect(report.findings).toHaveLength(0);
  });

  it("allowlists only the exact legacy finding and keeps new findings blocking", () => {
    const allowlist: PersistenceAllowlistEntry[] = [
      {
        ruleId: "hardcoded-pi-agent-root",
        file: "src/legacy.ts",
        excerptIncludes: "legacyRoot",
        reason: "legacy compatibility",
      },
    ];
    const root = createFixtureRepo(
      {
        "src/legacy.ts": `
          import { join } from "node:path";
          import { homedir } from "node:os";
          export const legacyRoot = join(homedir(), ".pi", "agent", "legacy");
          export const newRoot = join(homedir(), ".pi", "agent", "new");
        `,
      },
      allowlist,
    );

    const report = lintPersistencePaths({ root });

    expect(report.allowedFindings).toHaveLength(1);
    expect(report.allowedFindings[0]?.excerpt).toContain("legacyRoot");
    expect(report.blockingFindings).toHaveLength(1);
    expect(report.blockingFindings[0]?.excerpt).toContain("newRoot");
  });
});

function createFixtureRepo(
  files: Record<string, string>,
  allowlist: PersistenceAllowlistEntry[] = [],
): string {
  const root = mkdtempSync(join(tmpdir(), "pi-persistence-lint-"));
  mkdirSync(join(root, "tools"), { recursive: true });
  writeFileSync(join(root, "AGENTS.md"), AGENTS_FIXTURE);
  writeFileSync(
    join(root, "tools", "persistence-path-lint-allowlist.json"),
    JSON.stringify({ entries: allowlist }, null, 2),
  );

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = join(root, relativePath);
    mkdirSync(absolutePath.slice(0, absolutePath.lastIndexOf("/")), { recursive: true });
    writeFileSync(absolutePath, content);
  }

  return root;
}
