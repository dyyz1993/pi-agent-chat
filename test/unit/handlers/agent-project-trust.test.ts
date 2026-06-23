import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdir, readFile, realpath, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const agentMocks = vi.hoisted(() => ({
  start: vi.fn(async (sessionId: string) => ({ agentId: sessionId, status: "started" as const })),
  callChannel: vi.fn(async () => ({ ok: true })),
  stop: vi.fn(async () => true),
  getRemoteProjectByLocalPath: vi.fn(async () => null),
}));

vi.mock("../../../src/shared/agent/process-manager", () => ({
  AgentProcessManager: class {
    removeServer = vi.fn();
    updateServer = vi.fn();
    serverCount = vi.fn(() => 1);
    start = agentMocks.start;
    callChannel = agentMocks.callChannel;
    stop = agentMocks.stop;
  },
}));

vi.mock("../../../src/shared/lib/project-config", () => ({
  listDisabledSkills: vi.fn(async () => []),
  setDisabledSkill: vi.fn(async () => []),
  listDisabledPlugins: vi.fn(async () => []),
  setDisabledPlugin: vi.fn(async () => []),
  getRemoteProjectByLocalPath: agentMocks.getRemoteProjectByLocalPath,
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

  it("configures remote ssh runtime before returning from agent.start", async () => {
    const projectPath = join(tempDir, "remote-shadow");
    const sessionPath = join(tempDir, "session.jsonl");
    agentMocks.getRemoteProjectByLocalPath.mockResolvedValueOnce({
      id: "remote-id",
      name: "remote-project",
      runtime: "ssh",
      profileId: "profile-id",
      host: "xyz-mac",
      remotePath: "/tmp/remote-project",
      localPath: projectPath,
      sshArgs: ["-o", "BatchMode=yes"],
      shell: "/bin/bash",
      createdAt: 1,
      lastOpened: 1,
    });
    agentMocks.callChannel.mockResolvedValueOnce({ ok: true, enabled: true, configured: true });

    const start = server.handlers.get("agent.start")!;
    await expect(
      start({ sessionId: "session-1", projectPath, sessionPath, forceNewProcess: true }),
    ).resolves.toEqual({ agentId: "session-1", status: "started" });

    expect(agentMocks.callChannel).toHaveBeenCalledWith("session-1", "remote-ssh", "configure", {
      enabled: true,
      host: "xyz-mac",
      remoteCwd: "/tmp/remote-project",
      sshArgs: ["-o", "BatchMode=yes"],
      shell: "/bin/bash",
      persist: false,
    });
    expect(agentMocks.stop).not.toHaveBeenCalled();
  });

  it("fails agent.start instead of falling back to local tools when remote ssh configure fails", async () => {
    const projectPath = join(tempDir, "remote-shadow-fail");
    const sessionPath = join(tempDir, "session-fail.jsonl");
    agentMocks.getRemoteProjectByLocalPath.mockResolvedValueOnce({
      id: "remote-id",
      name: "remote-project",
      runtime: "ssh",
      profileId: "profile-id",
      host: "xyz-mac",
      remotePath: "/tmp/remote-project",
      localPath: projectPath,
      createdAt: 1,
      lastOpened: 1,
    });
    agentMocks.callChannel.mockResolvedValueOnce({
      ok: false,
      enabled: false,
      configured: false,
      error: "ssh unreachable",
    });

    const start = server.handlers.get("agent.start")!;
    await expect(
      start({ sessionId: "session-fail", projectPath, sessionPath, forceNewProcess: true }),
    ).rejects.toThrow(
      "Failed to configure SSH remote runtime for /tmp/remote-project: ssh unreachable",
    );
    expect(agentMocks.stop).toHaveBeenCalledWith("session-fail");
  });
});
