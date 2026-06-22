import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, realpath, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("../../../src/shared/agent/process-manager", () => ({
  AgentProcessManager: class {
    removeServer = vi.fn();
    updateServer = vi.fn();
    serverCount = vi.fn(() => 1);
  },
}));

vi.mock("../../../src/shared/lib/project-config", () => ({
  listDisabledSkills: vi.fn(async () => []),
  setDisabledSkill: vi.fn(async () => []),
  listDisabledPlugins: vi.fn(async () => []),
  setDisabledPlugin: vi.fn(async () => []),
}));

import { register } from "../../../src/shared/handlers/agent";
import { createMockServer, type MockServer } from "../../helpers/mock-server";

describe("agent project trust handlers", () => {
  let server: MockServer;
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(
      tmpdir(),
      `agent-trust-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    process.env.PI_CODING_AGENT_DIR = join(tempDir, "agent");
    await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
    server = createMockServer();
    register(
      server as unknown as Parameters<typeof register>[0],
      {} as Parameters<typeof register>[1],
    );
  });

  afterEach(async () => {
    delete process.env.PI_CODING_AGENT_DIR;
    await rm(tempDir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it("stores and reads trust for the exact project path", async () => {
    const projectPath = join(tempDir, "project");
    await mkdir(projectPath, { recursive: true });
    const canonicalProjectPath = await realpath(projectPath);

    const setTrust = server.handlers.get("agent.setProjectTrust")!;
    const getTrust = server.handlers.get("agent.getProjectTrust")!;

    const written = await setTrust({ projectPath, trusted: true });
    expect(written).toMatchObject({
      projectPath: canonicalProjectPath,
      trusted: true,
      decision: true,
      decisionPath: canonicalProjectPath,
    });
    expect((written as { trustStorePath: string }).trustStorePath).toContain(
      join(process.env.PI_CODING_AGENT_DIR!, "projects"),
    );

    const trustFile = JSON.parse(
      await readFile((written as { trustStorePath: string }).trustStorePath, "utf-8"),
    );
    expect(trustFile).toEqual({ decision: true });

    await expect(getTrust({ projectPath })).resolves.toMatchObject({
      projectPath: canonicalProjectPath,
      trusted: true,
      decision: true,
      decisionPath: canonicalProjectPath,
    });
  });

  it("uses the nearest parent trust decision", async () => {
    const projectPath = join(tempDir, "workspace");
    const childPath = join(projectPath, "child");
    await mkdir(childPath, { recursive: true });
    const canonicalProjectPath = await realpath(projectPath);
    const canonicalChildPath = await realpath(childPath);

    const setTrust = server.handlers.get("agent.setProjectTrust")!;
    const getTrust = server.handlers.get("agent.getProjectTrust")!;

    await setTrust({ projectPath, trusted: true });

    await expect(getTrust({ projectPath: childPath })).resolves.toMatchObject({
      projectPath: canonicalChildPath,
      trusted: true,
      decision: true,
      decisionPath: canonicalProjectPath,
    });
  });

  it("reads legacy global trust but writes new trust to project-scoped state", async () => {
    const projectPath = join(tempDir, "legacy-project");
    await mkdir(projectPath, { recursive: true });
    const canonicalProjectPath = await realpath(projectPath);
    const legacyTrustPath = join(process.env.PI_CODING_AGENT_DIR!, "trust.json");
    await writeFile(legacyTrustPath, JSON.stringify({ [canonicalProjectPath]: true }, null, 2));

    const setTrust = server.handlers.get("agent.setProjectTrust")!;
    const getTrust = server.handlers.get("agent.getProjectTrust")!;

    await expect(getTrust({ projectPath })).resolves.toMatchObject({
      projectPath: canonicalProjectPath,
      trusted: true,
      decision: true,
      decisionPath: canonicalProjectPath,
      trustStorePath: legacyTrustPath,
    });

    const written = (await setTrust({ projectPath, trusted: false })) as { trustStorePath: string };
    expect(written.trustStorePath).toContain(join(process.env.PI_CODING_AGENT_DIR!, "projects"));
    expect(JSON.parse(await readFile(legacyTrustPath, "utf-8"))).toEqual({
      [canonicalProjectPath]: true,
    });
    expect(JSON.parse(await readFile(written.trustStorePath, "utf-8"))).toEqual({
      decision: false,
    });
  });
});
