import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { register as registerLearning } from "../../../src/shared/handlers/learning";
import type { LearningCandidate, LearningMethods } from "../../../src/shared/modules/learning";
import { createMockServer, type MockServer } from "../../helpers/mock-server";
import { getProjectUserStateDir, normalizeProjectPath } from "../../../src/shared/lib/pi-agent-paths";

vi.mock("../../../src/shared/handlers/agent", () => ({
  getProcessManager: vi.fn(() => null),
}));

let tempDir: string;
let agentDir: string;
let projectPath: string;
let originalAgentDir: string | undefined;
let server: MockServer;

function candidatePath(candidate: LearningCandidate) {
  return join(getProjectUserStateDir(projectPath), "learning", "candidates", `${candidate.id}.json`);
}

async function writeCandidate(candidate: LearningCandidate) {
  await mkdir(join(getProjectUserStateDir(projectPath), "learning", "candidates"), { recursive: true });
  await writeFile(candidatePath(candidate), `${JSON.stringify(candidate, null, 2)}\n`);
}

beforeEach(async () => {
  tempDir = join(tmpdir(), `learning-handler-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  agentDir = join(tempDir, "agent");
  projectPath = join(tempDir, "project");
  await mkdir(agentDir, { recursive: true });
  await mkdir(projectPath, { recursive: true });
  originalAgentDir = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  server = createMockServer();
  registerLearning(
    server as unknown as Parameters<typeof registerLearning>[0],
    {} as Parameters<typeof registerLearning>[1],
  );
});

afterEach(async () => {
  if (originalAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = originalAgentDir;
  }
  await rm(tempDir, { recursive: true, force: true });
});

describe("learning handler fallback", () => {
  it("returns a project-scoped snapshot when no agent process is active", async () => {
    const handler = server.handlers.get("learning.getSnapshot")!;
    const result = (await handler({ projectPath })) as LearningMethods["learning.getSnapshot"]["result"];

    expect(result.projectRoot).toBe(normalizeProjectPath(projectPath));
    expect(result.dirs.learningDir).toContain("/projects/");
    expect(result.config.memory.extractMode).toBe("pending");
    expect(result.config.skills.distillMode).toBe("pending");
    expect(result.config.skills.curatorSchedule.enabled).toBe(false);
    expect(result.memory.entrypoint?.label).toBe("MEMORY.md");
    expect(existsSync(result.memory.entrypoint!.path)).toBe(true);
    expect(await readFile(result.memory.entrypoint!.path, "utf-8")).toContain("# Project Memory");
    expect(result.candidates).toEqual([]);
  });

  it("persists config switches and schedules in project-private learning storage", async () => {
    const handler = server.handlers.get("learning.setConfig")!;
    const result = (await handler({
      projectPath,
      config: {
        memory: {
          extractMode: "off",
          recallEnabled: false,
          curatorMode: "dry-run",
          curatorSchedule: { enabled: true, intervalMinutes: 720 },
        },
        skills: {
          distillMode: "auto",
          curatorMode: "pending",
          curatorSchedule: { enabled: true, intervalMinutes: 60 },
        },
      },
    })) as LearningMethods["learning.setConfig"]["result"];

    expect(result.config.memory.extractMode).toBe("off");
    expect(result.config.memory.recallEnabled).toBe(false);
    expect(result.config.memory.curatorSchedule.intervalMinutes).toBe(720);
    expect(result.config.skills.distillMode).toBe("auto");
    const configPath = join(getProjectUserStateDir(projectPath), "learning", "config.json");
    expect(JSON.parse(await readFile(configPath, "utf-8")).skills.curatorMode).toBe("pending");
    expect(JSON.parse(await readFile(configPath, "utf-8")).skills.curatorSchedule).toEqual({
      enabled: true,
      intervalMinutes: 60,
    });
  });

  it("approves memory candidates into the project memory directory", async () => {
    const candidate: LearningCandidate = {
      version: 1,
      id: "memory-candidate-1",
      domain: "memory",
      action: "create-memory",
      status: "pending",
      title: "Remember Learning UI",
      summary: "Memory and Skills are separate tabs.",
      confidence: "medium",
      createdAt: Date.now(),
      payload: {
        type: "memory",
        filename: "learning-ui.md",
        description: "Learning UI split tabs",
        memoryType: "project",
        content: "Memory and Skills are separate tabs.",
      },
      fileRefs: [],
    };
    await writeCandidate(candidate);

    const handler = server.handlers.get("learning.approveCandidate")!;
    const result = (await handler({
      projectPath,
      candidateId: candidate.id,
    })) as LearningMethods["learning.approveCandidate"]["result"];

    expect(result.memory.files).toHaveLength(1);
    expect(result.memory.entrypoint?.label).toBe("MEMORY.md");
    expect(await readFile(result.memory.files[0]!.filePath, "utf-8")).toContain(
      "separate tabs",
    );
  });

  it("approves skill candidates into a project-private skill package", async () => {
    const candidate: LearningCandidate = {
      version: 1,
      id: "skill-candidate-1",
      domain: "skill",
      action: "create-skill",
      status: "pending",
      title: "Create testing workflow",
      summary: "Harness before UI.",
      confidence: "high",
      createdAt: Date.now(),
      payload: {
        type: "skill",
        name: "testing-workflow",
        description: "Testing workflow",
        body: "Run harness tests before UI screenshots.",
        files: [{ relativePath: "references/checklist.md", content: "Harness first." }],
      },
      fileRefs: [],
    };
    await writeCandidate(candidate);

    const handler = server.handlers.get("learning.approveCandidate")!;
    const result = (await handler({
      projectPath,
      candidateId: candidate.id,
    })) as LearningMethods["learning.approveCandidate"]["result"];

    expect(result.skills.items).toHaveLength(1);
    expect(result.skills.items[0]!.filePath.endsWith("SKILL.md")).toBe(true);
    expect(result.skills.items[0]!.files.some((file) => file.label === "references/checklist.md")).toBe(true);
  });

  it("skill curator pending mode creates archive candidates without moving files", async () => {
    const skillDir = join(getProjectUserStateDir(projectPath), "skills", "unused-workflow");
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      join(skillDir, "SKILL.md"),
      "---\nname: unused-workflow\ndescription: unused\n---\n\nDo work.",
    );

    const handler = server.handlers.get("learning.runCurator")!;
    await handler({ projectPath, domain: "skill", mode: "pending" });
    const snapshotHandler = server.handlers.get("learning.getSnapshot")!;
    const snapshot = (await snapshotHandler({ projectPath })) as LearningMethods["learning.getSnapshot"]["result"];

    expect(snapshot.candidates).toHaveLength(1);
    expect(snapshot.candidates[0]!.action).toBe("archive-skill");
    expect(existsSync(skillDir)).toBe(true);
  });
});
