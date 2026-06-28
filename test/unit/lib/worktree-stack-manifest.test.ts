import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

const envBackup = {
  PI_WORKTREE_STATE_DIR: process.env.PI_WORKTREE_STATE_DIR,
  PI_WORKTREE_REGISTRY_DIR: process.env.PI_WORKTREE_REGISTRY_DIR,
};

const testRoot = join(tmpdir(), `pi-worktree-manifest-${process.pid}`);
const testStateDir = join(testRoot, "state");
const testRegistryDir = join(testStateDir, "registry");

describe("worktree stack manifest", () => {
  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    process.env.PI_WORKTREE_STATE_DIR = testStateDir;
    process.env.PI_WORKTREE_REGISTRY_DIR = testRegistryDir;
    vi.resetModules();
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    process.env.PI_WORKTREE_STATE_DIR = envBackup.PI_WORKTREE_STATE_DIR;
    process.env.PI_WORKTREE_REGISTRY_DIR = envBackup.PI_WORKTREE_REGISTRY_DIR;
    vi.resetModules();
  });

  it("reads a manifest from the default stack path", async () => {
    const { getWorktreeStackId, readWorktreeStackManifest } =
      await import("../../../src/shared/lib/worktree-stack-manifest");
    const projectPath = "/tmp/demo-app";
    const stackId = getWorktreeStackId(projectPath);
    const manifestPath = join(testStateDir, stackId, "manifest.json");

    await mkdir(join(testStateDir, stackId), { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          id: stackId,
          kind: "paired-worktree-stack",
          name: "demo-app",
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          repos: [],
          services: [],
          appConfigDir: join(testStateDir, stackId),
          agentDir: join(testStateDir, stackId, "agent"),
          runtime: { piCliPath: "" },
          orchestration: {
            leaderSessionId: null,
            batches: [],
            issues: [],
            workers: [],
            cleanup: { removeWorktrees: false, removeRegistry: false },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await readWorktreeStackManifest(projectPath);
    expect(result.manifestPath).toBe(manifestPath);
    expect(result.manifest?.id).toBe(stackId);
    expect(result.manifest?.orchestration.cleanup.removeRegistry).toBe(false);
  });

  it("falls back to the registry CONFIG_DIR when the manifest lives outside the default state path", async () => {
    const { getWorktreeStackId, readWorktreeStackManifest } =
      await import("../../../src/shared/lib/worktree-stack-manifest");
    const projectPath = "/tmp/demo-app-registry";
    const stackId = getWorktreeStackId(projectPath);
    const externalConfigDir = join(testRoot, "external-config");
    const externalManifestPath = join(externalConfigDir, "manifest.json");

    await mkdir(testRegistryDir, { recursive: true });
    await mkdir(externalConfigDir, { recursive: true });
    await writeFile(
      join(testRegistryDir, `${stackId}.env`),
      `CONFIG_DIR=${externalConfigDir}\n`,
      "utf8",
    );
    await writeFile(
      externalManifestPath,
      JSON.stringify(
        {
          version: 1,
          id: stackId,
          kind: "paired-worktree-stack",
          name: "demo-app-registry",
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          repos: [],
          services: [],
          appConfigDir: externalConfigDir,
          agentDir: join(externalConfigDir, "agent"),
          runtime: { piCliPath: "" },
          orchestration: {
            leaderSessionId: null,
            batches: [],
            issues: [],
            workers: [],
            cleanup: { removeWorktrees: false, removeRegistry: false },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await readWorktreeStackManifest(projectPath);
    expect(result.manifestPath).toBe(externalManifestPath);
    expect(result.manifest?.appConfigDir).toBe(externalConfigDir);
  });

  it("updates orchestration state in place", async () => {
    const { getWorktreeStackId, updateWorktreeStackOrchestration } =
      await import("../../../src/shared/lib/worktree-stack-manifest");
    const projectPath = "/tmp/demo-app-update";
    const stackId = getWorktreeStackId(projectPath);
    const manifestDir = join(testStateDir, stackId);
    const manifestPath = join(manifestDir, "manifest.json");

    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      manifestPath,
      JSON.stringify(
        {
          version: 1,
          id: stackId,
          kind: "paired-worktree-stack",
          name: "demo-app-update",
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          repos: [],
          services: [],
          appConfigDir: manifestDir,
          agentDir: join(manifestDir, "agent"),
          runtime: { piCliPath: "" },
          orchestration: {
            leaderSessionId: null,
            batches: [],
            issues: [],
            workers: [],
            cleanup: { removeWorktrees: false, removeRegistry: false },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await updateWorktreeStackOrchestration(projectPath, {
      leaderSessionId: "leader-1",
      upsertBatches: [
        {
          id: "batch-a",
          title: "Leader batch A",
          status: "active",
          issueIds: ["issue-59"],
        },
      ],
      upsertIssues: [
        {
          id: "issue-59",
          title: "Wire manifest into leader",
          status: "ready",
          repo: "both",
          priority: "high",
          batchId: "batch-a",
        },
      ],
      upsertWorkers: [
        {
          id: "worker-1",
          agent: "pi-worktree-dev",
          status: "running",
          issueId: "issue-59",
          worktreePath: projectPath,
        },
      ],
      cleanup: { removeRegistry: true },
    });

    expect(existsSync(manifestPath)).toBe(true);
    expect(result.manifest?.orchestration.leaderSessionId).toBe("leader-1");
    expect(result.manifest?.orchestration.batches).toHaveLength(1);
    expect(result.manifest?.orchestration.issues).toHaveLength(1);
    expect(result.manifest?.orchestration.workers).toHaveLength(1);
    expect(result.manifest?.orchestration.batches[0]).toMatchObject({
      id: "batch-a",
      issueIds: ["issue-59"],
      status: "active",
    });
    expect(result.manifest?.orchestration.issues[0]).toMatchObject({
      id: "issue-59",
      status: "in_progress",
      priority: "high",
      batchId: "batch-a",
      assigneeWorkerId: "worker-1",
    });
    expect(result.manifest?.orchestration.workers[0]).toMatchObject({
      id: "worker-1",
      issueId: "issue-59",
      status: "running",
      repo: "both",
    });
    expect(result.manifest?.orchestration.cleanup).toEqual({
      removeWorktrees: false,
      removeRegistry: true,
    });
  });

  it("supports batch planning metadata and dependency validation", async () => {
    const { getWorktreeStackId, updateWorktreeStackOrchestration } =
      await import("../../../src/shared/lib/worktree-stack-manifest");
    const projectPath = "/tmp/demo-app-batches";
    const stackId = getWorktreeStackId(projectPath);
    const manifestDir = join(testStateDir, stackId);

    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          id: stackId,
          kind: "paired-worktree-stack",
          name: "demo-app-batches",
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          repos: [],
          services: [],
          appConfigDir: manifestDir,
          agentDir: join(manifestDir, "agent"),
          runtime: { piCliPath: "" },
          orchestration: {
            leaderSessionId: null,
            batches: [],
            issues: [],
            workers: [],
            cleanup: { removeWorktrees: false, removeRegistry: false },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = await updateWorktreeStackOrchestration(projectPath, {
      upsertBatches: [
        {
          id: "batch-1",
          title: "Fork batch",
          status: "planned",
          issueIds: ["issue-a"],
        },
        {
          id: "batch-2",
          title: "App batch",
          status: "planned",
          issueIds: ["issue-b"],
        },
      ],
      upsertIssues: [
        {
          id: "issue-a",
          title: "Prepare runtime change",
          status: "ready",
          repo: "fork",
          priority: "high",
          batchId: "batch-1",
        },
        {
          id: "issue-b",
          title: "Wire app integration",
          status: "planned",
          repo: "app",
          priority: "medium",
          batchId: "batch-2",
          dependsOnIssueIds: ["issue-a"],
        },
      ],
    });

    expect(result.manifest?.orchestration.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "issue-a",
          batchId: "batch-1",
          priority: "high",
          dependsOnIssueIds: [],
        }),
        expect.objectContaining({
          id: "issue-b",
          batchId: "batch-2",
          priority: "medium",
          dependsOnIssueIds: ["issue-a"],
        }),
      ]),
    );
    expect(result.manifest?.orchestration.batches).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "batch-1",
          issueIds: ["issue-a"],
          status: "active",
        }),
        expect.objectContaining({
          id: "batch-2",
          issueIds: ["issue-b"],
          status: "planned",
        }),
      ]),
    );
  });

  it("rejects invalid status transitions and missing dependencies", async () => {
    const { getWorktreeStackId, updateWorktreeStackOrchestration } =
      await import("../../../src/shared/lib/worktree-stack-manifest");
    const projectPath = "/tmp/demo-app-invalid";
    const stackId = getWorktreeStackId(projectPath);
    const manifestDir = join(testStateDir, stackId);

    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          id: stackId,
          kind: "paired-worktree-stack",
          name: "demo-app-invalid",
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          repos: [],
          services: [],
          appConfigDir: manifestDir,
          agentDir: join(manifestDir, "agent"),
          runtime: { piCliPath: "" },
          orchestration: {
            leaderSessionId: null,
            batches: [],
            issues: [
              {
                id: "issue-a",
                title: "Already done",
                status: "done",
                priority: "medium",
                repo: "app",
                batchId: null,
                dependsOnIssueIds: [],
                assigneeWorkerId: null,
                branch: null,
                note: null,
                createdAt: "2026-06-28T00:00:00.000Z",
                updatedAt: "2026-06-28T00:00:00.000Z",
              },
            ],
            workers: [],
            cleanup: { removeWorktrees: false, removeRegistry: false },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    await expect(
      updateWorktreeStackOrchestration(projectPath, {
        upsertIssues: [{ id: "issue-a", status: "blocked" }],
      }),
    ).rejects.toThrow("Invalid issue status transition");

    await expect(
      updateWorktreeStackOrchestration(projectPath, {
        upsertIssues: [{ id: "issue-b", dependsOnIssueIds: ["missing-issue"] }],
      }),
    ).rejects.toThrow("depends on missing issue");

    await expect(
      updateWorktreeStackOrchestration(projectPath, {
        upsertIssues: [{ id: "issue-b", batchId: "missing-batch" }],
      }),
    ).rejects.toThrow("references missing batch");
  });

  it("builds execution context for the assigned worker and target repos", async () => {
    const { getWorktreeStackId, getWorktreeStackExecutionContext } =
      await import("../../../src/shared/lib/worktree-stack-manifest");
    const projectPath = "/tmp/demo-app-context";
    const stackId = getWorktreeStackId(projectPath);
    const manifestDir = join(testStateDir, stackId);

    await mkdir(manifestDir, { recursive: true });
    await writeFile(
      join(manifestDir, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          id: stackId,
          kind: "paired-worktree-stack",
          name: "demo-app-context",
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          repos: [
            {
              name: "pi-agent-chat",
              role: "app",
              repoPath: "/repo/app",
              worktreePath: "/worktree/app",
              branch: "codex/issue-context",
            },
            {
              name: "pi-momo-fork",
              role: "runtime-fork",
              repoPath: "/repo/fork",
              worktreePath: "/worktree/fork",
              branch: "codex/issue-context",
            },
          ],
          services: [
            {
              name: "pi-agent-chat-api",
              role: "api",
              cwd: "/worktree/app",
              command: "bun --bun src/server.ts",
              port: 3102,
              healthUrl: "http://localhost:3102/health",
            },
            {
              name: "pi-agent-chat-vite",
              role: "web",
              cwd: "/worktree/app",
              command: "vite",
              port: 5175,
              healthUrl: "http://localhost:5175/",
            },
          ],
          appConfigDir: manifestDir,
          agentDir: join(manifestDir, "agent"),
          runtime: { piCliPath: "/worktree/fork/packages/coding-agent/dist/cli.js" },
          orchestration: {
            leaderSessionId: "leader-1",
            batches: [
              {
                id: "batch-a",
                title: "Runtime + app",
                status: "active",
                issueIds: ["issue-fork"],
                note: null,
                createdAt: "2026-06-28T00:00:00.000Z",
                updatedAt: "2026-06-28T00:00:00.000Z",
              },
            ],
            issues: [
              {
                id: "issue-fork",
                title: "Touch both repos",
                status: "in_progress",
                priority: "high",
                repo: "both",
                batchId: "batch-a",
                dependsOnIssueIds: [],
                assigneeWorkerId: "worker-1",
                branch: "codex/issue-context",
                note: null,
                createdAt: "2026-06-28T00:00:00.000Z",
                updatedAt: "2026-06-28T00:00:00.000Z",
              },
            ],
            workers: [
              {
                id: "worker-1",
                agent: "pi-worktree-dev",
                status: "running",
                issueId: "issue-fork",
                sessionId: "session-worker-1",
                repo: "both",
                branch: "codex/issue-context",
                worktreePath: "/worktree/app",
                note: null,
                createdAt: "2026-06-28T00:00:00.000Z",
                updatedAt: "2026-06-28T00:00:00.000Z",
              },
            ],
            cleanup: { removeWorktrees: false, removeRegistry: false },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const context = await getWorktreeStackExecutionContext({
      projectPath,
      issueId: "issue-fork",
    });

    expect(context.issue?.id).toBe("issue-fork");
    expect(context.batch?.id).toBe("batch-a");
    expect(context.worker?.id).toBe("worker-1");
    expect(context.targetRepoRoles).toEqual(["app", "runtime-fork"]);
    expect(context.targetAppWorktreePath).toBe("/worktree/app");
    expect(context.targetRuntimeForkWorktreePath).toBe("/worktree/fork");
    expect(context.apiService?.port).toBe(3102);
    expect(context.webService?.port).toBe(5175);
  });
});
