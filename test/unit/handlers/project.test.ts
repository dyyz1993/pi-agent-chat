import { describe, it, expect, beforeEach, vi } from "vitest";

const projectMocks = vi.hoisted(() => ({
  mockExecFile: vi.fn(),
  mockScanSessions: vi.fn(async () => []),
  mockScanAllProjects: vi.fn(async () => []),
  mockListPiProjects: vi.fn(async () => []),
  mockListMerged: vi.fn(async () => []),
  mockFindSessionById: vi.fn(async () => null),
  mockAddRecent: vi.fn(async () => {}),
  mockListRecent: vi.fn(async () => []),
  mockRemoveRecent: vi.fn(async () => {}),
  mockListConfigured: vi.fn(async () => []),
  mockAddConfigured: vi.fn(async () => {}),
  mockRemoveConfigured: vi.fn(async () => {}),
  mockSyncOpenTabs: vi.fn(async () => {}),
  mockRestoreOpenTabs: vi.fn(async () => ({ tabs: [], activeTabId: null })),
  mockListDirectory: vi.fn(async () => []),
  mockRemoveFavorite: vi.fn(async () => {}),
  mockListFavorites: vi.fn(async () => []),
  mockToggleFavorite: vi.fn(async () => ({ added: true, favorites: [] })),
  mockTogglePin: vi.fn(async () => false),
  mockLinkProject: vi.fn(async () => ({ ok: true })),
  mockUnlinkProject: vi.fn(async () => ({ ok: true })),
  mockGetLinkedProjects: vi.fn(async () => []),
  mockGetModelFavorites: vi.fn(async () => []),
  mockToggleModelFavorite: vi.fn(async () => ({ added: true, favorites: [] })),
  mockCreateDirectory: vi.fn(async (_parentPath: string, folderName: string) => ({
    ok: true,
    path: `/tmp/${folderName}`,
  })),
  mockSyncRemoteAgentResources: vi.fn(async () => ({
    remoteAgentDir: "~/.pi/agent/remote-runtime/child/agent-resources",
    hash: "abcdef0123456789",
    uploaded: true,
    resources: [{ type: "skills", hash: "hash", files: 1, bytes: 10 }],
    blocked: [],
  })),
  mockCollectRemoteSyncSources: vi.fn(() => [
    { type: "skills", localPath: "/local/.pi/agent/skills" },
    { type: "skills", localPath: "/local/.agents/skills" },
    { type: "agents", localPath: "/local/.pi/agent/agents" },
  ]),
  mockStageRemoteResourceSync: vi.fn(() => ({
    stagingDir: "/tmp/pi-remote-resource-sync-test-staging",
    hasResources: true,
    manifest: {
      schemaVersion: "remote-resource-sync/v1",
      managedBy: "pi-agent-chat",
      generatedAt: "2026-06-24T00:00:00.000Z",
      localAgentDir: "/local/.pi/agent",
      hash: "preview-hash",
      resources: [
        { type: "skills", hash: "skills-hash", files: 3, bytes: 1234 },
        { type: "agents", hash: "agents-hash", files: 2, bytes: 456 },
      ],
      blocked: [{ path: "/local/.agents/skills/private/.env", reason: "blocked sensitive filename" }],
    },
  })),
  mockResolveRemoteSyncedAgentDir: vi.fn(
    () => "~/.pi/agent/remote-runtime/child/agent-resources",
  ),
  mockListSshProfiles: vi.fn(async () => []),
  mockGetSshProfile: vi.fn(async () => null),
  mockUpsertSshProfile: vi.fn(async (profile) => ({
    id: profile.id ?? "ssh-profile",
    name: profile.name,
    host: profile.host,
    createdAt: 1,
    updatedAt: 1,
  })),
  mockRemoveSshProfile: vi.fn(async () => {}),
  mockListRemoteProjects: vi.fn(async () => []),
  mockOpenRemoteProject: vi.fn(async () => ({
    tab: { id: "remote-tab", name: "remote", path: "/tmp/remote", runtime: "ssh" },
    profile: { id: "ssh-profile", name: "remote", host: "host", createdAt: 1, updatedAt: 1 },
    remote: {
      id: "remote-id",
      name: "remote",
      runtime: "ssh",
      profileId: "ssh-profile",
      host: "host",
      remotePath: "/remote",
      localPath: "/tmp/remote",
      createdAt: 1,
      lastOpened: 1,
    },
  })),
}));
const {
  mockExecFile,
  mockScanSessions,
  mockScanAllProjects,
  mockListPiProjects,
  mockListMerged,
  mockFindSessionById,
  mockAddRecent,
  mockListRecent,
  mockRemoveRecent,
  mockSyncOpenTabs,
  mockRestoreOpenTabs,
  mockToggleFavorite,
  mockTogglePin,
  mockLinkProject,
  mockUnlinkProject,
  mockGetLinkedProjects,
  mockSyncRemoteAgentResources,
} = projectMocks;

vi.mock("child_process", () => ({
  default: {
    execFile: projectMocks.mockExecFile,
  },
  execFile: projectMocks.mockExecFile,
}));

vi.mock("../../../src/shared/lib/session-scanner", () => ({
  scanSessionsForProject: projectMocks.mockScanSessions,
  scanAllProjects: projectMocks.mockScanAllProjects,
  listPiProjects: projectMocks.mockListPiProjects,
  listMergedProjects: projectMocks.mockListMerged,
  findSessionById: projectMocks.mockFindSessionById,
}));

vi.mock("../../../src/shared/lib/project-config", () => ({
  addRecentProject: projectMocks.mockAddRecent,
  listRecentProjects: projectMocks.mockListRecent,
  removeRecentProject: projectMocks.mockRemoveRecent,
  listConfiguredPaths: projectMocks.mockListConfigured,
  addConfiguredPath: projectMocks.mockAddConfigured,
  removeConfiguredPath: projectMocks.mockRemoveConfigured,
  syncOpenTabs: projectMocks.mockSyncOpenTabs,
  restoreOpenTabs: projectMocks.mockRestoreOpenTabs,
  listDirectory: projectMocks.mockListDirectory,
  removeFavoriteFolder: projectMocks.mockRemoveFavorite,
  listFavoriteFolders: projectMocks.mockListFavorites,
  toggleFavoriteFolder: projectMocks.mockToggleFavorite,
  toggleProjectPin: projectMocks.mockTogglePin,
  getModelFavorites: projectMocks.mockGetModelFavorites,
  toggleModelFavorite: projectMocks.mockToggleModelFavorite,
  createDirectory: projectMocks.mockCreateDirectory,
  listSshProfiles: projectMocks.mockListSshProfiles,
  getSshProfile: projectMocks.mockGetSshProfile,
  upsertSshProfile: projectMocks.mockUpsertSshProfile,
  removeSshProfile: projectMocks.mockRemoveSshProfile,
  openRemoteProject: projectMocks.mockOpenRemoteProject,
  listRemoteProjects: projectMocks.mockListRemoteProjects,
}));

vi.mock("../../../src/shared/lib/ssh-config", () => ({
  listDetectedSshHosts: vi.fn(async () => []),
}));

vi.mock("../../../src/shared/lib/native-dialog", () => ({
  openFolder: vi.fn(async () => []),
}));

vi.mock("../../../src/shared/lib/linked-projects-config", () => ({
  linkProject: projectMocks.mockLinkProject,
  unlinkProject: projectMocks.mockUnlinkProject,
  getLinkedProjects: projectMocks.mockGetLinkedProjects,
}));

vi.mock("../../../src/sandbox/remote-resource-sync", () => ({
  collectRemoteSyncSources: projectMocks.mockCollectRemoteSyncSources,
  stageRemoteResourceSync: projectMocks.mockStageRemoteResourceSync,
  syncRemoteAgentResources: projectMocks.mockSyncRemoteAgentResources,
  resolveRemoteSyncedAgentDir: projectMocks.mockResolveRemoteSyncedAgentDir,
}));

const fakeProcessManager = {
  batchGetSessionsStatus: vi.fn((ids: string[]) =>
    ids.map((sessionId) => ({ sessionId, status: "idle" as const })),
  ),
};
vi.mock("../../../src/shared/handlers/agent", () => ({
  getProcessManager: () => fakeProcessManager,
}));

import { register } from "../../../src/shared/handlers/project";
import { createMockServer, type MockServer } from "../../helpers/mock-server";

describe("project handler", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecFile.mockImplementation((_command, _args, _options, callback) => {
      callback(null, { stdout: "", stderr: "" });
    });
    server = createMockServer();
    register(
      server as unknown as Parameters<typeof register>[0],
      {
        platform: "desktop",
      } as Parameters<typeof register>[1],
    );
  });

  describe("project.open", () => {
    it("returns empty result for non-existent path", async () => {
      const handler = server.handlers.get("project.open")!;
      const result = await handler({ path: "/no/such/path" });

      expect(result).toEqual({
        projectPath: "/no/such/path",
        name: "",
        sessionCount: 0,
      });
    });

    it("opens existing project and adds to recent", async () => {
      const handler = server.handlers.get("project.open")!;
      mockScanSessions.mockResolvedValueOnce([{ id: "s1" }, { id: "s2" }]);

      const projectPath = process.cwd();
      const result = await handler({ path: projectPath });

      expect(result).toEqual({
        projectPath,
        name: expect.any(String),
        sessionCount: 2,
      });
      expect(mockAddRecent).toHaveBeenCalledWith(projectPath, expect.any(String), 2);
    });
  });

  describe("project.listRecent", () => {
    it("returns saved recent projects", async () => {
      const handler = server.handlers.get("project.listRecent")!;
      mockListRecent.mockResolvedValueOnce([{ path: "/a", name: "a" }]);

      const result = await handler({});

      expect(result).toEqual({ projects: [{ path: "/a", name: "a" }] });
    });

    it("falls back to scanAllProjects when no saved", async () => {
      const handler = server.handlers.get("project.listRecent")!;
      mockListRecent.mockResolvedValueOnce([]);
      mockScanAllProjects.mockResolvedValueOnce([
        { projectPath: "/scanned", sessionCount: 1, sessions: [{ updatedAt: 1000 }] },
      ]);

      const result = (await handler({})) as { projects: Array<{ name: string }> };

      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toBe("scanned");
    });
  });

  describe("project.removeRecent", () => {
    it("removes a recent project", async () => {
      const handler = server.handlers.get("project.removeRecent")!;
      const result = await handler({ projectPath: "/remove/me" });

      expect(result).toEqual({ ok: true });
      expect(mockRemoveRecent).toHaveBeenCalledWith("/remove/me");
    });
  });

  describe("project.scanSessions", () => {
    it("returns sessions for a project", async () => {
      const handler = server.handlers.get("project.scanSessions")!;
      mockScanSessions.mockResolvedValueOnce([{ sessionId: "s1" }]);
      // 当前 processManager mock 默认对所有 sessionId 返回 idle
      // 第一个用例希望验证「有 sessions」+「有 statuses 返回」，不再覆盖空 statuses 路径

      const result = await handler({ projectPath: "/my/proj" });

      expect(result).toEqual({
        sessions: [{ sessionId: "s1" }],
        statuses: [{ sessionId: "s1", status: "idle" }],
      });
    });

    it("boundary：进程池的 stopped 必须在 server handler 映射成 idle，前端不会看到 stopped", async () => {
      const handler = server.handlers.get("project.scanSessions")!;
      mockScanSessions.mockResolvedValueOnce([
        { sessionId: "s1" },
        { sessionId: "s2" },
        { sessionId: "s3" },
        { sessionId: "s4" },
      ]);
      // 进程池返回的是内部 status：包含 "stopped"
      fakeProcessManager.batchGetSessionsStatus.mockImplementationOnce((ids: string[]) =>
        ids.map((sessionId) => {
          if (sessionId === "s1") return { sessionId, status: "streaming" as const };
          if (sessionId === "s2") return { sessionId, status: "stopped" as const };
          if (sessionId === "s3") return { sessionId, status: "idle" as const };
          return { sessionId, status: "stopped" as const };
        }),
      );

      const result = (await handler({ projectPath: "/my/proj" })) as {
        sessions: unknown[];
        statuses: Array<{ sessionId: string; status: string }>;
      };

      // 关键：返回的 statuses 全部都是 SessionStatus，没有 "stopped"
      const statusById: Record<string, string> = {};
      for (const s of result.statuses) statusById[s.sessionId] = s.status;
      expect(statusById["s1"]).toBe("streaming");
      expect(statusById["s2"]).toBe("idle"); // stopped → idle
      expect(statusById["s3"]).toBe("idle");
      expect(statusById["s4"]).toBe("idle"); // stopped → idle
      for (const s of result.statuses) {
        expect(
          ["idle", "streaming", "compacting", "permission", "retrying"],
          `status for ${s.sessionId} must be SessionStatus`,
        ).toContain(s.status);
        expect(s.status).not.toBe("stopped");
      }
    });
  });

  describe("project.findSessionById", () => {
    it("returns session when found", async () => {
      const handler = server.handlers.get("project.findSessionById")!;
      mockFindSessionById.mockResolvedValueOnce({ id: "abc", cwd: "/test" });

      const result = await handler({ sessionId: "abc" });

      expect(result).toEqual({ session: { id: "abc", cwd: "/test" } });
    });

    it("returns null when not found", async () => {
      const handler = server.handlers.get("project.findSessionById")!;
      mockFindSessionById.mockResolvedValueOnce(null);

      const result = await handler({ sessionId: "ghost" });

      expect(result).toEqual({ session: null });
    });
  });

  describe("project.listPiProjects", () => {
    it("returns pi projects", async () => {
      const handler = server.handlers.get("project.listPiProjects")!;
      mockListPiProjects.mockResolvedValueOnce([{ path: "/pi" }]);

      const result = await handler({});

      expect(result).toEqual({ projects: [{ path: "/pi" }] });
    });
  });

  describe("project.listAllProjects", () => {
    it("returns merged projects", async () => {
      const handler = server.handlers.get("project.listAllProjects")!;
      mockListMerged.mockResolvedValueOnce([{ path: "/merged" }]);

      const result = await handler({});

      expect(result).toEqual({ projects: [{ path: "/merged" }] });
    });
  });

  describe("project.syncTabs", () => {
    it("syncs open tabs", async () => {
      const handler = server.handlers.get("project.syncTabs")!;
      const tabs = [{ id: "t1", name: "proj", path: "/p" }];

      const result = await handler({ tabs, activeTabId: "t1" });

      expect(result).toEqual({ ok: true });
      expect(mockSyncOpenTabs).toHaveBeenCalledWith(tabs, "t1");
    });
  });

  describe("project.restoreTabs", () => {
    it("restores tabs", async () => {
      const handler = server.handlers.get("project.restoreTabs")!;
      mockRestoreOpenTabs.mockResolvedValueOnce({ tabs: [], activeTabId: null });

      const result = await handler({});

      expect(result).toEqual({ tabs: [], activeTabId: null });
    });
  });

  describe("project.toggleFavoriteFolder", () => {
    it("toggles favorite folder", async () => {
      const handler = server.handlers.get("project.toggleFavoriteFolder")!;
      mockToggleFavorite.mockResolvedValueOnce({ added: true, favorites: ["/f"] });

      const result = await handler({ folderPath: "/f" });

      expect(result).toEqual({ isFavorite: true, favorites: ["/f"] });
    });
  });

  describe("project.toggleProjectPin", () => {
    it("toggles project pin", async () => {
      const handler = server.handlers.get("project.toggleProjectPin")!;
      mockTogglePin.mockResolvedValueOnce(true);

      const result = await handler({ projectPath: "/p" });

      expect(result).toEqual({ pinned: true });
    });
  });

  describe("project.linkProject", () => {
    it("delegates to linkProject lib", async () => {
      const handler = server.handlers.get("project.linkProject")!;
      const project = {
        id: "dep",
        path: "/dep",
        description: "",
        relationship: "upstream" as const,
        keyPaths: [],
        readonly: true,
      };
      mockLinkProject.mockResolvedValueOnce({ ok: true });

      const result = await handler({ projectRoot: "/root", project });

      expect(result).toEqual({ ok: true });
      expect(mockLinkProject).toHaveBeenCalledWith("/root", project);
    });
  });

  describe("project.unlinkProject", () => {
    it("delegates to unlinkProject lib", async () => {
      const handler = server.handlers.get("project.unlinkProject")!;
      mockUnlinkProject.mockResolvedValueOnce({ ok: true });

      const result = await handler({ projectRoot: "/root", projectId: "dep" });

      expect(result).toEqual({ ok: true });
      expect(mockUnlinkProject).toHaveBeenCalledWith("/root", "dep");
    });
  });

  describe("project.getLinkedProjects", () => {
    it("returns linked projects", async () => {
      const handler = server.handlers.get("project.getLinkedProjects")!;
      mockGetLinkedProjects.mockResolvedValueOnce([{ id: "x" }]);

      const result = await handler({ projectRoot: "/root" });

      expect(result).toEqual({ projects: [{ id: "x" }] });
      expect(mockGetLinkedProjects).toHaveBeenCalledWith("/root");
    });
  });

  describe("project.listSshDirectory", () => {
    it("returns absolute child paths when browsing the remote root", async () => {
      const handler = server.handlers.get("project.listSshDirectory")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, {
          stdout: "/\nroot\nvar\n",
          stderr: "",
        });
      });

      const result = await handler({ host: "xyz-mac", dirPath: "/" });

      expect(result).toMatchObject({
        ok: true,
        path: "/",
        entries: [
          { name: "root", path: "/root", isDirectory: true },
          { name: "var", path: "/var", isDirectory: true },
        ],
      });
    });

    it("normalizes bare directory input to an absolute remote path before cd", async () => {
      const handler = server.handlers.get("project.listSshDirectory")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, {
          stdout: "/var\nlog\n",
          stderr: "",
        });
      });

      await handler({ host: "xyz-mac", dirPath: "var" });

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args.at(-1)).toContain("cd '/var'");
      expect(args.at(-1)).not.toContain("cd 'var'");
    });

    it("expands home-style remote paths without relying on quoted tilde expansion", async () => {
      const handler = server.handlers.get("project.listSshDirectory")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, {
          stdout: "/root/projects\napp\n",
          stderr: "",
        });
      });

      await handler({ host: "xyz-mac", dirPath: "~/projects" });

      const args = mockExecFile.mock.calls[0][1] as string[];
      expect(args.at(-1)).toContain('cd "$HOME"/');
      expect(args.at(-1)).toContain("'projects'");
    });
  });

  describe("project.previewRemoteResourceSync", () => {
    it("returns counts, source paths, and blocked entries for selected resource types", async () => {
      const handler = server.handlers.get("project.previewRemoteResourceSync")!;

      const result = await handler({
        host: "xyz-mac",
        remotePath: "/Users/xyz/project",
        resourceTypes: ["skills", "agents"],
      });

      expect(result).toEqual({
        hash: "preview-hash",
        blocked: [
          {
            path: "/local/.agents/skills/private/.env",
            reason: "blocked sensitive filename",
          },
        ],
        resources: [
          {
            type: "skills",
            files: 3,
            bytes: 1234,
            sources: ["/local/.pi/agent/skills", "/local/.agents/skills"],
          },
          {
            type: "agents",
            files: 2,
            bytes: 456,
            sources: ["/local/.pi/agent/agents"],
          },
        ],
      });
    });
  });

  describe("project.openSshProject", () => {
    it("opens a remote project only after SSH test succeeds and stores remote metadata", async () => {
      const handler = server.handlers.get("project.openSshProject")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, {
          stdout: "pi-agent-chat-ssh-ok\n/Users/xyz/project\n",
          stderr: "",
        });
      });
      projectMocks.mockOpenRemoteProject.mockResolvedValueOnce({
        tab: {
          id: "remote-tab",
          name: "project",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
          runtime: "ssh",
        },
        profile: {
          id: "ssh-profile",
          name: "xyz-mac",
          host: "xyz-mac",
          createdAt: 1,
          updatedAt: 2,
        },
        remote: {
          id: "remote-id",
          name: "project",
          runtime: "ssh",
          profileId: "ssh-profile",
          host: "xyz-mac",
          remotePath: "/Users/xyz/project",
          localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
          createdAt: 1,
          lastOpened: 2,
        },
      });
      mockScanSessions.mockResolvedValueOnce([{ sessionId: "s1" }, { sessionId: "s2" }]);

      const result = await handler({
        host: "xyz-mac",
        remotePath: "/Users/xyz/project",
        projectName: "project",
        profileName: "xyz-mac",
        sshRuntimeKind: "remote-agent-child",
      });

      expect(result).toMatchObject({
        projectPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
        name: "project",
        sessionCount: 2,
        remote: {
          runtime: "ssh",
          host: "xyz-mac",
          remotePath: "/Users/xyz/project",
        },
      });
      expect(projectMocks.mockOpenRemoteProject).toHaveBeenCalledWith(
        expect.objectContaining({
          host: "xyz-mac",
          remotePath: "/Users/xyz/project",
          projectName: "project",
          profileName: "xyz-mac",
          sshRuntimeKind: "remote-agent-child",
        }),
      );
      expect(mockAddRecent).toHaveBeenCalledWith(
        "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
        "project",
        2,
        expect.objectContaining({
          runtime: "ssh",
          remote: expect.objectContaining({
            host: "xyz-mac",
            remotePath: "/Users/xyz/project",
          }),
        }),
      );
      expect(mockSyncRemoteAgentResources).toHaveBeenCalledWith(
        expect.objectContaining({
          target: "xyz-mac",
          remoteAgentDir: "~/.pi/agent/remote-runtime/child/agent-resources",
          remoteShell: "sh -lc",
        }),
      );
    });

    it("does not sync local resources for the quick ssh-command runtime", async () => {
      const handler = server.handlers.get("project.openSshProject")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, {
          stdout: "pi-agent-chat-ssh-ok\n/Users/xyz/project\n",
          stderr: "",
        });
      });
      projectMocks.mockOpenRemoteProject.mockResolvedValueOnce({
        tab: {
          id: "remote-tab",
          name: "project",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
          runtime: "ssh",
        },
        profile: {
          id: "ssh-profile",
          name: "xyz-mac",
          host: "xyz-mac",
          createdAt: 1,
          updatedAt: 2,
        },
        remote: {
          id: "remote-id",
          name: "project",
          runtime: "ssh",
          sshRuntimeKind: "ssh-command",
          profileId: "ssh-profile",
          host: "xyz-mac",
          remotePath: "/Users/xyz/project",
          localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
          createdAt: 1,
          lastOpened: 2,
        },
      });

      await handler({
        host: "xyz-mac",
        remotePath: "/Users/xyz/project",
        projectName: "project",
        profileName: "xyz-mac",
        sshRuntimeKind: "ssh-command",
      });

      expect(mockSyncRemoteAgentResources).not.toHaveBeenCalled();
    });

    it("syncs only the selected remote resource types for standard SSH runtime", async () => {
      const handler = server.handlers.get("project.openSshProject")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, {
          stdout: "pi-agent-chat-ssh-ok\n/Users/xyz/project\n",
          stderr: "",
        });
      });
      projectMocks.mockOpenRemoteProject.mockResolvedValueOnce({
        tab: {
          id: "remote-tab",
          name: "project",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
          runtime: "ssh",
        },
        profile: {
          id: "ssh-profile",
          name: "xyz-mac",
          host: "xyz-mac",
          createdAt: 1,
          updatedAt: 2,
        },
        remote: {
          id: "remote-id",
          name: "project",
          runtime: "ssh",
          sshRuntimeKind: "remote-agent-child",
          profileId: "ssh-profile",
          host: "xyz-mac",
          remotePath: "/Users/xyz/project",
          localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
          createdAt: 1,
          lastOpened: 2,
        },
      });

      await handler({
        host: "xyz-mac",
        remotePath: "/Users/xyz/project",
        projectName: "project",
        profileName: "xyz-mac",
        sshRuntimeKind: "remote-agent-child",
        remoteResourceSync: {
          enabled: true,
          resourceTypes: ["skills", "rules"],
        },
      });

      expect(projectMocks.mockOpenRemoteProject).toHaveBeenCalledWith(
        expect.objectContaining({
          remoteResourceSync: {
            enabled: true,
            resourceTypes: ["skills", "rules"],
          },
        }),
      );
      expect(mockSyncRemoteAgentResources).toHaveBeenCalledWith(
        expect.objectContaining({
          target: "xyz-mac",
          resourceTypes: ["skills", "rules"],
          extraSources: expect.any(Array),
        }),
      );
    });

    it("skips resource sync when standard SSH runtime has no selected resource types", async () => {
      const handler = server.handlers.get("project.openSshProject")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, {
          stdout: "pi-agent-chat-ssh-ok\n/Users/xyz/project\n",
          stderr: "",
        });
      });
      projectMocks.mockOpenRemoteProject.mockResolvedValueOnce({
        tab: {
          id: "remote-tab",
          name: "project",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
          runtime: "ssh",
        },
        profile: {
          id: "ssh-profile",
          name: "xyz-mac",
          host: "xyz-mac",
          createdAt: 1,
          updatedAt: 2,
        },
        remote: {
          id: "remote-id",
          name: "project",
          runtime: "ssh",
          sshRuntimeKind: "remote-agent-child",
          profileId: "ssh-profile",
          host: "xyz-mac",
          remotePath: "/Users/xyz/project",
          localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
          createdAt: 1,
          lastOpened: 2,
        },
      });

      await handler({
        host: "xyz-mac",
        remotePath: "/Users/xyz/project",
        projectName: "project",
        profileName: "xyz-mac",
        sshRuntimeKind: "remote-agent-child",
        remoteResourceSync: {
          enabled: true,
          resourceTypes: [],
        },
      });

      expect(mockSyncRemoteAgentResources).not.toHaveBeenCalled();
    });

    it("opens the remote project even when optional resource sync fails", async () => {
      const handler = server.handlers.get("project.openSshProject")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        callback(null, {
          stdout: "pi-agent-chat-ssh-ok\n/Users/xyz/project\n",
          stderr: "",
        });
      });
      projectMocks.mockOpenRemoteProject.mockResolvedValueOnce({
        tab: {
          id: "remote-tab",
          name: "project",
          path: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
          runtime: "ssh",
        },
        profile: {
          id: "ssh-profile",
          name: "xyz-mac",
          host: "xyz-mac",
          createdAt: 1,
          updatedAt: 2,
        },
        remote: {
          id: "remote-id",
          name: "project",
          runtime: "ssh",
          sshRuntimeKind: "remote-agent-child",
          profileId: "ssh-profile",
          host: "xyz-mac",
          remotePath: "/Users/xyz/project",
          localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
          createdAt: 1,
          lastOpened: 2,
        },
      });
      mockSyncRemoteAgentResources.mockRejectedValueOnce(
        new Error("remote tar command not found"),
      );

      const result = await handler({
        host: "xyz-mac",
        remotePath: "/Users/xyz/project",
        projectName: "project",
        profileName: "xyz-mac",
        sshRuntimeKind: "remote-agent-child",
        remoteResourceSync: {
          enabled: true,
          resourceTypes: ["skills"],
        },
      });

      expect(result).toMatchObject({
        projectPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd/project",
        remote: {
          runtime: "ssh",
          remotePath: "/Users/xyz/project",
        },
      });
      expect(mockAddRecent).toHaveBeenCalled();
    });

    it("does not create a remote project or recent item when SSH test fails", async () => {
      const handler = server.handlers.get("project.openSshProject")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        const error = new Error("ssh failed") as Error & { stdout?: string; stderr?: string };
        error.stdout = "";
        error.stderr = "Permission denied (publickey).";
        callback(error);
      });

      await expect(
        handler({
          host: "xyz-mac",
          remotePath: "/Users/xyz/project",
          projectName: "project",
          profileName: "xyz-mac",
        }),
      ).rejects.toThrow("Permission denied");

      expect(projectMocks.mockOpenRemoteProject).not.toHaveBeenCalled();
      expect(mockAddRecent).not.toHaveBeenCalled();
    });

    it("preserves the remote-path error when the selected remote directory was deleted", async () => {
      const handler = server.handlers.get("project.openSshProject")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        const error = new Error("ssh failed") as Error & { stdout?: string; stderr?: string };
        error.stdout = "";
        error.stderr = "cd: no such file or directory: /Users/xyz/deleted-project\n";
        callback(error);
      });

      await expect(
        handler({
          host: "xyz-mac",
          remotePath: "/Users/xyz/deleted-project",
          projectName: "deleted-project",
          profileName: "xyz-mac",
        }),
      ).rejects.toMatchObject({
        name: "SshConnectionError",
        message: "cd: no such file or directory: /Users/xyz/deleted-project",
        errorCode: "remote-path",
      });

      expect(projectMocks.mockOpenRemoteProject).not.toHaveBeenCalled();
      expect(mockAddRecent).not.toHaveBeenCalled();
    });
  });

  describe("project.testSshProfile", () => {
    it("classifies a missing SSH host without shelling out", async () => {
      const handler = server.handlers.get("project.testSshProfile")!;

      const result = await handler({ host: "" });

      expect(result).toMatchObject({
        ok: false,
        error: "SSH host is required",
        errorCode: "missing-host",
      });
      expect(mockExecFile).not.toHaveBeenCalled();
    });

    it.each([
      {
        stderr: "Permission denied (publickey).\n",
        code: "auth-failed",
      },
      {
        stderr: "ssh: Could not resolve hostname missing-host: nodename nor servname provided\n",
        code: "host-unreachable",
      },
      {
        stderr: "ssh: connect to host 192.168.1.9 port 22: Operation timed out\n",
        code: "timeout",
      },
      {
        stderr: "Host key verification failed.\n",
        code: "host-key",
      },
      {
        stderr: "Bad configuration option: usekeychain\n",
        code: "ssh-config",
      },
      {
        stderr: "cd: no such file or directory: /missing/project\n",
        code: "remote-path",
      },
      {
        stderr: "cd: permission denied: /root/private\n",
        code: "permission-denied",
      },
      {
        stderr: "bash: line 1: zsh: command not found\n",
        code: "command-failed",
      },
    ])("classifies SSH failure: $code", async ({ stderr, code }) => {
      const handler = server.handlers.get("project.testSshProfile")!;
      mockExecFile.mockImplementationOnce((_command, _args, _options, callback) => {
        const error = new Error("ssh failed") as Error & { stdout?: string; stderr?: string };
        error.stdout = "";
        error.stderr = stderr;
        callback(error);
      });

      const result = await handler({ host: "xyz-mac", remotePath: "/project" });

      expect(result).toMatchObject({
        ok: false,
        stderr,
        error: stderr.trim(),
        errorCode: code,
      });
    });
  });
});
