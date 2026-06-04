import { describe, it, expect, beforeEach, vi } from "vitest";

const projectMocks = vi.hoisted(() => ({
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
}));
const {
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
} = projectMocks;

vi.mock("../src/shared/lib/session-scanner", () => ({
  scanSessionsForProject: projectMocks.mockScanSessions,
  scanAllProjects: projectMocks.mockScanAllProjects,
  listPiProjects: projectMocks.mockListPiProjects,
  listMergedProjects: projectMocks.mockListMerged,
  findSessionById: projectMocks.mockFindSessionById,
}));

vi.mock("../src/shared/lib/project-config", () => ({
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
}));

vi.mock("../src/shared/lib/native-dialog", () => ({
  openFolder: vi.fn(async () => []),
}));

vi.mock("../src/shared/lib/linked-projects-config", () => ({
  linkProject: projectMocks.mockLinkProject,
  unlinkProject: projectMocks.mockUnlinkProject,
  getLinkedProjects: projectMocks.mockGetLinkedProjects,
}));

import { register } from "../src/shared/handlers/project";

function createMockServer() {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    register: vi.fn((method: string, handler: (params: unknown) => Promise<unknown>) => {
      handlers.set(method, handler);
    }),
    handlers,
    subscriptions: new Map(),
    emitEvent: vi.fn(),
  };
}

type MockServer = ReturnType<typeof createMockServer>;

describe("project handler", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.clearAllMocks();
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
      mockScanSessions.mockResolvedValueOnce([{ id: "s1" }]);

      const result = await handler({ projectPath: "/my/proj" });

      expect(result).toEqual({ sessions: [{ id: "s1" }] });
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
});
