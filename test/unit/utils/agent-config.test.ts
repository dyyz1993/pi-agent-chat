import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

const AGENTS_DIR = "/Users/xuyingzhou/.pi/agent/agents/";

const VALID_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "bash",
  "grep",
  "find",
  "ls",
  "glob",
  "session_delegate",
  "session_delegate_send",
  "session_delegate_status",
  "session_delegate_stop",
  "session_delegate_remove",
  "session_delegate_clear_stopped",
  "session_delegate_fork",
  "subagent",
  "subagent_resume",
  "ask-confirm",
  "ask-select",
  "ask-input",
  "ask-notify",
  "ask-editor",
  "todo",
  "lsp",
  "rules_list",
  "rules_show",
  "rules_match",
]);

const VALID_MODES = new Set(["all", "subagent", "primary"]);

const READ_ONLY_TOOLS = new Set(["read", "grep", "find", "ls"]);

const DELEGATE_TOOLS = new Set([
  "session_delegate",
  "session_delegate_send",
  "session_delegate_status",
  "session_delegate_stop",
  "session_delegate_remove",
  "session_delegate_clear_stopped",
  "session_delegate_fork",
]);

const SUBAGENT_TOOLS = new Set(["subagent", "subagent_resume"]);

const KEBAB_CASE_RE = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;

interface AgentFrontmatter {
  name: string;
  description: string;
  tools?: string[];
  model?: string;
  mode: string;
  permissionMode?: string;
}

interface ParsedAgent {
  filePath: string;
  fileName: string;
  frontmatter: AgentFrontmatter;
  systemPrompt: string;
  rawFrontmatter: string;
}

function parseFrontmatter(raw: string): {
  frontmatter: Record<string, unknown>;
  systemPrompt: string;
  rawFrontmatter: string;
} {
  const trimmed = raw.trimStart();
  if (!trimmed.startsWith("---")) {
    throw new Error("File does not start with frontmatter delimiter ---");
  }

  const firstClose = trimmed.indexOf("\n---", 3);
  if (firstClose === -1) {
    throw new Error("No closing --- found for frontmatter");
  }

  const rawFrontmatter = trimmed.slice(3, firstClose).trim();
  const systemPrompt = trimmed.slice(firstClose + 4).trimStart();

  const lines = rawFrontmatter.split("\n");
  const result: Record<string, string | string[]> = {};
  let currentKey = "";
  let inList = false;
  let listItems: string[] = [];

  for (const line of lines) {
    if (inList) {
      const listMatch = line.match(/^\s+-\s+(.+)$/);
      if (listMatch) {
        listItems.push(listMatch[1].trim());
        continue;
      } else {
        result[currentKey] = listItems;
        inList = false;
        listItems = [];
      }
    }

    const kvMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (kvMatch) {
      currentKey = kvMatch[1];
      const value = kvMatch[2].trim();
      if (value === "") {
        inList = true;
        listItems = [];
      } else {
        result[currentKey] = value;
      }
    }
  }

  if (inList) {
    result[currentKey] = listItems;
  }

  return { frontmatter: result, systemPrompt, rawFrontmatter };
}

function parseTools(toolsRaw: string | string[] | undefined): string[] {
  if (toolsRaw === undefined) return [];
  if (Array.isArray(toolsRaw)) return toolsRaw;
  return toolsRaw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

function loadAllAgents(): ParsedAgent[] {
  const files = fs
    .readdirSync(AGENTS_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  return files.map((fileName) => {
    const filePath = path.join(AGENTS_DIR, fileName);
    const raw = fs.readFileSync(filePath, "utf-8");
    const { frontmatter, systemPrompt, rawFrontmatter } = parseFrontmatter(raw);

    const tools = parseTools(frontmatter.tools as string | string[] | undefined);

    return {
      filePath,
      fileName,
      frontmatter: {
        name: frontmatter.name as string,
        description: frontmatter.description as string,
        tools,
        model: frontmatter.model as string | undefined,
        mode: frontmatter.mode as string,
        permissionMode: frontmatter.permissionMode as string | undefined,
      },
      systemPrompt,
      rawFrontmatter,
    };
  });
}

function countStrayDelimiters(content: string): number {
  let count = 0;
  let inCodeBlock = false;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }
    if (!inCodeBlock && trimmed === "---") {
      count++;
    }
  }

  return count;
}

function isReadOnlyTools(tools: string[]): boolean {
  return tools.length > 0 && tools.every((t) => READ_ONLY_TOOLS.has(t));
}

const agents = loadAllAgents();

describe("Agent Config Validation", () => {
  describe("1. Frontmatter Parsing", () => {
    it("should discover agent .md files", () => {
      expect(agents.length).toBeGreaterThanOrEqual(15);
    });

    agents.forEach((agent) => {
      describe(`[${agent.fileName}]`, () => {
        it("should have parseable YAML frontmatter", () => {
          expect(agent.frontmatter).toBeDefined();
          expect(typeof agent.frontmatter).toBe("object");
        });

        it("should have a 'name' field in kebab-case", () => {
          expect(agent.frontmatter.name).toBeDefined();
          expect(typeof agent.frontmatter.name).toBe("string");
          expect(agent.frontmatter.name).toMatch(KEBAB_CASE_RE);
        });

        it("should have a non-empty 'description' field", () => {
          expect(agent.frontmatter.description).toBeDefined();
          expect(typeof agent.frontmatter.description).toBe("string");
          expect(agent.frontmatter.description.trim().length).toBeGreaterThan(0);
        });

        it("should have a valid 'mode' field", () => {
          expect(agent.frontmatter.mode).toBeDefined();
          expect(VALID_MODES.has(agent.frontmatter.mode)).toBe(true);
        });

        it("should have a 'model' field or be a trusted/orchestrator agent", () => {
          const hasPermission = agent.frontmatter.permissionMode === "always-allow";
          const hasDelegateTools = (agent.frontmatter.tools ?? []).some((t) =>
            DELEGATE_TOOLS.has(t),
          );

          if (hasPermission || hasDelegateTools) {
            return;
          }

          expect(agent.frontmatter.model).toBeDefined();
          expect(typeof agent.frontmatter.model).toBe("string");
          expect(agent.frontmatter.model!.trim().length).toBeGreaterThan(0);
        });
      });
    });
  });

  describe("2. Tools Validation", () => {
    agents.forEach((agent) => {
      describe(`[${agent.fileName}]`, () => {
        it("should only contain valid tool names", () => {
          const tools = agent.frontmatter.tools ?? [];
          if (tools.length === 0 && agent.frontmatter.permissionMode === "always-allow") {
            return;
          }

          for (const tool of tools) {
            expect(VALID_TOOLS.has(tool)).toBe(true);
            expect(tool).not.toContain(" ");
          }
        });

        it("should document missing tools field (means all tools)", () => {
          if (agent.frontmatter.tools === undefined || agent.frontmatter.tools.length === 0) {
            expect(
              agent.frontmatter.permissionMode === "always-allow" ||
                agent.frontmatter.tools === undefined,
            ).toBe(true);
          }
        });

        it("should not have bash without write (security check)", () => {
          if (agent.frontmatter.permissionMode === "always-allow") {
            return;
          }

          const tools = agent.frontmatter.tools ?? [];
          if (tools.includes("bash")) {
            expect(tools).toContain("write");
          }
        });
      });
    });
  });

  describe("3. No Stray Frontmatter Delimiters", () => {
    agents.forEach((agent) => {
      it(`[${agent.fileName}] should have no stray --- delimiters outside code blocks`, () => {
        const strayCount = countStrayDelimiters(agent.systemPrompt);
        expect(strayCount).toBe(0);
      });
    });
  });

  describe("4. Duplicate Name Check", () => {
    it("should have no duplicate agent names", () => {
      const names = agents.map((a) => a.frontmatter.name);
      const uniqueNames = new Set(names);
      expect(uniqueNames.size).toBe(names.length);

      const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
      if (duplicates.length > 0) {
        expect.fail(`Duplicate agent names found: ${duplicates.join(", ")}`);
      }
    });
  });

  describe("5. Consistency Checks", () => {
    agents.forEach((agent) => {
      describe(`[${agent.fileName}]`, () => {
        it("if mode is subagent, should NOT have delegate tools", () => {
          if (agent.frontmatter.mode !== "subagent") return;

          const tools = agent.frontmatter.tools ?? [];
          const hasDelegate = tools.some((t) => DELEGATE_TOOLS.has(t));
          expect(hasDelegate).toBe(false);
        });

        it("if mode is primary, should NOT have subagent tools", () => {
          if (agent.frontmatter.mode !== "primary") return;

          const tools = agent.frontmatter.tools ?? [];
          const hasSubagent = tools.some((t) => SUBAGENT_TOOLS.has(t));
          expect(hasSubagent).toBe(false);
        });

        it("if agent has only read-only tools and mode is subagent, systemPrompt should mention read-only constraints", () => {
          const tools = agent.frontmatter.tools ?? [];
          if (!isReadOnlyTools(tools)) return;
          if (agent.frontmatter.mode !== "subagent") return;

          const prompt = agent.systemPrompt.toLowerCase();
          const mentionsConstraint =
            prompt.includes("read-only") ||
            prompt.includes("read only") ||
            prompt.includes("cannot modify") ||
            prompt.includes("cannot execute") ||
            prompt.includes("只读") ||
            prompt.includes("不能修改") ||
            prompt.includes("不能执行") ||
            prompt.includes("not make any changes") ||
            prompt.includes("do not modify") ||
            prompt.includes("不会修改") ||
            prompt.includes("无法修改") ||
            prompt.includes("cannot run") ||
            prompt.includes("you cannot") ||
            prompt.includes("you must not");

          expect(mentionsConstraint).toBe(true);
        });
      });
    });
  });

  describe("6. File Naming Convention", () => {
    agents.forEach((agent) => {
      it(`[${agent.fileName}] file name should match the agent name field`, () => {
        const expectedFileName = `${agent.frontmatter.name}.md`;
        expect(agent.fileName).toBe(expectedFileName);
      });
    });
  });

  describe("7. SystemPrompt Quality", () => {
    agents.forEach((agent) => {
      describe(`[${agent.fileName}]`, () => {
        it("systemPrompt should be non-empty (at least 50 chars)", () => {
          expect(agent.systemPrompt.length).toBeGreaterThanOrEqual(50);
        });

        it("systemPrompt should not contain TODO or FIXME placeholders", () => {
          const prompt = agent.systemPrompt;
          expect(prompt).not.toMatch(/\bTODO\b/);
          expect(prompt).not.toMatch(/\bFIXME\b/);
        });

        it("systemPrompt should end with a period, closing marker, or meaningful content", () => {
          const trimmed = agent.systemPrompt.trimEnd();
          if (trimmed.length === 0) {
            expect.fail("systemPrompt is empty");
          }

          const lastChar = trimmed[trimmed.length - 1];
          const validEndings = [
            ".",
            "。",
            "：",
            "！",
            "？",
            "?",
            ")",
            "]",
            "}",
            "-",
            ">",
            "|",
            "`",
          ];

          const endsWithCodeBlock = trimmed.endsWith("```");
          const endsWithList = trimmed.endsWith("-") || trimmed.endsWith(">");
          const endsWithTable = trimmed.endsWith("|");
          const endsNormally = validEndings.includes(lastChar);
          const endsWithCJK = /[\u4e00-\u9fff\u3000-\u303f]$/.test(trimmed);
          const endsWithWord = /[a-zA-Z0-9/]$/.test(trimmed);

          expect(
            endsWithCodeBlock ||
              endsWithList ||
              endsWithTable ||
              endsNormally ||
              endsWithCJK ||
              endsWithWord,
          ).toBe(true);
        });
      });
    });
  });
});
