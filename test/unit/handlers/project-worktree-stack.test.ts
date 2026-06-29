import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, rm, writeFile } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

const envBackup = {
  PI_WORKTREE_STATE_DIR: process.env.PI_WORKTREE_STATE_DIR,
  PI_WORKTREE_REGISTRY_DIR: process.env.PI_WORKTREE_REGISTRY_DIR,
};

const testRoot = join(tmpdir(), `pi-project-handler-worktree-${process.pid}`);
const testStateDir = join(testRoot, "state");
const testRegistryDir = join(testStateDir, "registry");

function setupProjectHandlerMocks(): void {
  vi.doMock("child_process", () => ({
    default: {
      execFile: vi.fn(),
    },
    execFile: vi.fn(),
  }));

  vi.doMock("../../../src/shared/lib/project-config", () => ({
    addRecentProject: vi.fn(async () => {}),
    listRecentProjects: vi.fn(async () => []),
    removeRecentProject: vi.fn(async () => {}),
    listConfiguredPaths: vi.fn(async () => []),
    addConfiguredPath: vi.fn(async () => {}),
    removeConfiguredPath: vi.fn(async () => {}),
    syncOpenTabs: vi.fn(async () => {}),
    restoreOpenTabs: vi.fn(async () => ({ tabs: [], activeTabId: null })),
    listDirectory: vi.fn(async () => []),
    removeFavoriteFolder: vi.fn(async () => {}),
    listFavoriteFolders: vi.fn(async () => []),
    toggleFavoriteFolder: vi.fn(async () => ({ added: true, favorites: [] })),
    toggleProjectPin: vi.fn(async () => false),
    getAgentFavorites: vi.fn(async () => []),
    toggleAgentFavorite: vi.fn(async () => ({ added: true, favorites: [] })),
    getModelFavorites: vi.fn(async () => []),
    toggleModelFavorite: vi.fn(async () => ({ added: true, favorites: [] })),
    createDirectory: vi.fn(async () => ({ ok: true, path: "/tmp/created" })),
    listSshProfiles: vi.fn(async () => []),
    getSshProfile: vi.fn(async () => null),
    upsertSshProfile: vi.fn(async () => ({
      id: "ssh-profile",
      name: "ssh-profile",
      host: "host",
      createdAt: 1,
      updatedAt: 1,
    })),
    removeSshProfile: vi.fn(async () => {}),
    openRemoteProject: vi.fn(),
    listRemoteProjects: vi.fn(async () => []),
  }));

  vi.doMock("../../../src/shared/lib/session-scanner", () => ({
    scanSessionsForProject: vi.fn(async () => []),
    scanAllProjects: vi.fn(async () => []),
    listPiProjects: vi.fn(async () => []),
    listMergedProjects: vi.fn(async () => []),
    findSessionById: vi.fn(async () => null),
  }));

  vi.doMock("../../../src/shared/lib/ssh-config", () => ({
    listDetectedSshHosts: vi.fn(async () => []),
  }));

  vi.doMock("../../../src/shared/lib/native-dialog", () => ({
    openFolder: vi.fn(async () => []),
  }));

  vi.doMock("../../../src/shared/lib/linked-projects-config", () => ({
    linkProject: vi.fn(async () => ({ ok: true })),
    unlinkProject: vi.fn(async () => ({ ok: true })),
    getLinkedProjects: vi.fn(async () => []),
  }));

  vi.doMock("../../../src/sandbox/remote-resource-sync", () => ({
    collectRemoteSyncSources: vi.fn(() => []),
    stageRemoteResourceSync: vi.fn(() => ({
      stagingDir: "/tmp/staging",
      hasResources: false,
      manifest: {
        schemaVersion: "remote-resource-sync/v1",
        managedBy: "pi-agent-chat",
        generatedAt: "2026-06-24T00:00:00.000Z",
        localAgentDir: "/tmp/agent",
        hash: "hash",
        resources: [],
        blocked: [],
      },
    })),
    syncRemoteAgentResources: vi.fn(async () => ({
      remoteAgentDir: "/tmp/remote-agent",
      hash: "hash",
      uploaded: false,
      resources: [],
      blocked: [],
    })),
    resolveRemoteSyncedAgentDir: vi.fn(() => "/tmp/remote-agent"),
  }));

  vi.doMock("../../../src/shared/handlers/agent", () => ({
    getProcessManager: () => null,
  }));
}

describe("project worktree stack handlers", () => {
  beforeEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    process.env.PI_WORKTREE_STATE_DIR = testStateDir;
    process.env.PI_WORKTREE_REGISTRY_DIR = testRegistryDir;
    vi.resetModules();
    setupProjectHandlerMocks();
  });

  afterEach(async () => {
    await rm(testRoot, { recursive: true, force: true });
    process.env.PI_WORKTREE_STATE_DIR = envBackup.PI_WORKTREE_STATE_DIR;
    process.env.PI_WORKTREE_REGISTRY_DIR = envBackup.PI_WORKTREE_REGISTRY_DIR;
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("supports manifest-based batch planning and worker assignment through project RPC handlers", async () => {
    const { createMockServer } = await import("../../helpers/mock-server");
    const { register } = await import("../../../src/shared/handlers/project");
    const { getWorktreeStackId } = await import("../../../src/shared/lib/worktree-stack-manifest");

    const projectPath = "/tmp/paired-stack-app";
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
          name: "paired-stack-app",
          createdAt: "2026-06-28T00:00:00.000Z",
          updatedAt: "2026-06-28T00:00:00.000Z",
          repos: [
            {
              name: "pi-agent-chat",
              role: "app",
              repoPath: "/repo/pi-agent-chat",
              worktreePath: projectPath,
              branch: "codex/stack-smoke",
            },
            {
              name: "pi-momo-fork",
              role: "runtime-fork",
              repoPath: "/repo/pi-momo-fork",
              worktreePath: "/tmp/paired-stack-fork",
              branch: "codex/stack-smoke",
            },
          ],
          services: [
            {
              name: "pi-agent-chat-api",
              role: "api",
              cwd: projectPath,
              command: "bun --bun src/server.ts",
              port: 3102,
              healthUrl: "http://localhost:3102/health",
            },
            {
              name: "pi-agent-chat-vite",
              role: "web",
              cwd: projectPath,
              command: "vite",
              port: 5175,
              healthUrl: "http://localhost:5175/",
            },
          ],
          appConfigDir: manifestDir,
          agentDir: join(manifestDir, "agent"),
          runtime: {
            piCliPath: "/tmp/paired-stack-fork/packages/coding-agent/dist/cli.js",
          },
          orchestration: {
            leaderSessionId: null,
            batches: [],
            issues: [],
            workers: [],
            cleanup: {
              removeWorktrees: false,
              removeRegistry: false,
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const server = createMockServer();
    register(
      server as unknown as Parameters<typeof register>[0],
      {
        platform: "desktop",
      } as Parameters<typeof register>[1],
    );

    const getManifest = server.handlers.get("project.getWorktreeStackManifest")!;
    const updateManifest = server.handlers.get("project.updateWorktreeStackOrchestration")!;
    const getExecutionContext = server.handlers.get("project.getWorktreeStackExecutionContext")!;

    const initial = await getManifest({ projectPath });
    expect(initial).toMatchObject({
      manifestPath,
      manifest: {
        orchestration: {
          batches: [],
          issues: [],
          workers: [],
        },
      },
    });

    await updateManifest({
      projectPath,
      leaderSessionId: "leader-session-1",
      upsertBatches: [
        {
          id: "batch-runtime",
          title: "Runtime + app batch",
          status: "planned",
          issueIds: ["issue-runtime"],
        },
      ],
      upsertIssues: [
        {
          id: "issue-runtime",
          title: "Patch paired fork flow",
          status: "ready",
          priority: "high",
          repo: "both",
          batchId: "batch-runtime",
        },
      ],
      upsertWorkers: [
        {
          id: "worker-runtime",
          agent: "pi-worktree-dev",
          status: "assigned",
          issueId: "issue-runtime",
          sessionId: "worker-session-1",
          branch: "codex/stack-smoke",
          worktreePath: projectPath,
        },
      ],
    });

    const assigned = await getManifest({ projectPath });
    expect(assigned).toMatchObject({
      manifest: {
        orchestration: {
          leaderSessionId: "leader-session-1",
          batches: [
            {
              id: "batch-runtime",
              status: "active",
              issueIds: ["issue-runtime"],
            },
          ],
          issues: [
            {
              id: "issue-runtime",
              status: "ready",
              assigneeWorkerId: "worker-runtime",
              batchId: "batch-runtime",
            },
          ],
          workers: [
            {
              id: "worker-runtime",
              status: "assigned",
              issueId: "issue-runtime",
              repo: "both",
            },
          ],
        },
      },
    });

    const inProgress = await updateManifest({
      projectPath,
      upsertWorkers: [
        {
          id: "worker-runtime",
          status: "running",
        },
      ],
    });

    expect(inProgress).toMatchObject({
      manifest: {
        orchestration: {
          leaderSessionId: "leader-session-1",
          batches: [
            {
              id: "batch-runtime",
              status: "active",
              issueIds: ["issue-runtime"],
            },
          ],
          issues: [
            {
              id: "issue-runtime",
              status: "in_progress",
              assigneeWorkerId: "worker-runtime",
              batchId: "batch-runtime",
            },
          ],
          workers: [
            {
              id: "worker-runtime",
              status: "running",
              issueId: "issue-runtime",
              repo: "both",
            },
          ],
        },
      },
    });

    const done = await updateManifest({
      projectPath,
      upsertWorkers: [
        {
          id: "worker-runtime",
          status: "done",
        },
      ],
    });

    expect(done).toMatchObject({
      manifest: {
        orchestration: {
          batches: [
            {
              id: "batch-runtime",
              status: "done",
            },
          ],
          issues: [
            {
              id: "issue-runtime",
              status: "done",
            },
          ],
          workers: [
            {
              id: "worker-runtime",
              status: "done",
            },
          ],
        },
      },
    });

    const context = await getExecutionContext({
      projectPath,
      workerId: "worker-runtime",
    });

    expect(context).toMatchObject({
      manifestPath,
      manifest: {
        appConfigDir: manifestDir,
        agentDir: join(manifestDir, "agent"),
        runtime: {
          piCliPath: "/tmp/paired-stack-fork/packages/coding-agent/dist/cli.js",
        },
      },
      batch: {
        id: "batch-runtime",
      },
      issue: {
        id: "issue-runtime",
        repo: "both",
      },
      worker: {
        id: "worker-runtime",
        sessionId: "worker-session-1",
      },
      appRepo: {
        worktreePath: projectPath,
      },
      runtimeForkRepo: {
        worktreePath: "/tmp/paired-stack-fork",
      },
      apiService: {
        port: 3102,
      },
      webService: {
        port: 5175,
      },
      targetRepoRoles: ["app", "runtime-fork"],
      targetAppWorktreePath: projectPath,
      targetRuntimeForkWorktreePath: "/tmp/paired-stack-fork",
    });
  });
});
