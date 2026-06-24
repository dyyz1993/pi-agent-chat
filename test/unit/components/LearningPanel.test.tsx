import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { LearningSnapshot } from "../../../src/shared/modules/learning";

const { mockApiCall, mockOpenFile } = vi.hoisted(() => ({
  mockApiCall: vi.fn(),
  mockOpenFile: vi.fn(),
}));

const sessionState = {
  activeSessionId: null as string | null,
  projectTabs: [] as Array<{ id: string; name: string; path: string }>,
  activeProjectId: null as string | null,
};

function setSessionState(patch: Partial<typeof sessionState>) {
  Object.assign(sessionState, patch);
}

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: mockApiCall },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => {
  function useSessionStore<T>(selector: (state: typeof sessionState) => T): T {
    return selector(sessionState);
  }
  useSessionStore.getState = () => sessionState;
  useSessionStore.setState = setSessionState;
  return { useSessionStore };
});

vi.mock("../../../src/mainview/stores/use-explorer-store", () => {
  const state = { openFile: mockOpenFile };
  function useExplorerStore<T>(selector: (s: typeof state) => T): T {
    return selector(state);
  }
  useExplorerStore.getState = () => state;
  return { useExplorerStore };
});

import { LearningPanel } from "../../../src/mainview/components/learning-panel/LearningPanel";
import { useLearningStore } from "../../../src/mainview/stores/use-learning-store";
import { useMemoryStore } from "../../../src/mainview/stores/use-memory-store";
import type { MemoryStatusResult } from "../../../src/shared/modules/memory";

const snapshot: LearningSnapshot = {
  version: 1,
  projectRoot: "/tmp/project",
  dirs: {
    learningDir: "/tmp/agent/projects/key/learning",
    memoryDir: "/tmp/agent/projects/key/memory",
    skillsDir: "/tmp/agent/projects/key/skills",
  },
  config: {
    version: 1,
    enabled: true,
    memory: {
      recallEnabled: true,
      extractMode: "pending",
      curatorMode: "dry-run",
      curatorSchedule: { enabled: false, intervalMinutes: 1440 },
    },
    skills: {
      distillMode: "pending",
      curatorMode: "dry-run",
      curatorSchedule: { enabled: false, intervalMinutes: 1440 },
    },
  },
  overview: {
    memoryFiles: 1,
    activeSkills: 1,
    disabledSkills: 0,
    archivedSkills: 0,
    pendingCandidates: 1,
    warnings: 0,
    lastRunAt: Date.now(),
  },
  memory: {
    files: [
      {
        filename: "memory.md",
        filePath: "/tmp/agent/projects/key/memory/memory.md",
        description: "Learning memory",
        type: "project",
        mtimeMs: Date.now(),
        size: 42,
        state: "active",
      },
    ],
    entrypoint: {
      path: "/tmp/agent/projects/key/memory/MEMORY.md",
      label: "MEMORY.md",
      kind: "memory-index",
      exists: true,
      size: 12,
    },
    diagnostics: [],
  },
  skills: {
    items: [
      {
        name: "testing-workflow",
        description: "Harness before UI.",
        scope: "project-private",
        source: "generated",
        state: "active",
        usageCount: 0,
        lastUsedAt: null,
        patchCount: 0,
        filePath: "/tmp/agent/projects/key/skills/testing-workflow/SKILL.md",
        baseDir: "/tmp/agent/projects/key/skills/testing-workflow",
        pinned: false,
        files: [
          {
            path: "/tmp/agent/projects/key/skills/testing-workflow/SKILL.md",
            label: "SKILL.md",
            kind: "skill-entrypoint",
            exists: true,
            size: 20,
          },
        ],
      },
    ],
    diagnostics: [],
  },
  candidates: [
    {
      version: 1,
      id: "candidate-1",
      domain: "skill",
      action: "create-skill",
      status: "pending",
      title: "Create test skill",
      summary: "Harness before UI.",
      confidence: "high",
      createdAt: Date.now(),
      payload: {
        type: "skill",
        name: "test-skill",
        description: "Test skill",
        body: "Run harness first.",
      },
      fileRefs: [],
    },
  ],
  runs: [],
};

const defaultMemoryStatus: MemoryStatusResult = {
  skipRules: { builtin: [], custom: [] },
  guardRules: { builtin: [], custom: [] },
  excludeKeywords: [],
  recentQueries: [],
  dream: { lastRunAt: null },
};

let memoryStatusResponse = defaultMemoryStatus;

beforeEach(() => {
  vi.clearAllMocks();
  memoryStatusResponse = defaultMemoryStatus;
  mockApiCall.mockImplementation((method: string, params?: { filePath?: string }) => {
    if (method === "learning.getSnapshot") return Promise.resolve(snapshot);
    if (method === "memory.getStatus") {
      return Promise.resolve(memoryStatusResponse);
    }
    if (method === "memory.deleteFile") {
      return Promise.resolve({ ok: true });
    }
    if (method === "memory.readFile") {
      if (params?.filePath?.endsWith("MEMORY.md")) {
        return Promise.resolve({
          content: "# Project Memory\n\n- [Learning memory](memory.md) - Learning memory",
          size: 64,
        });
      }
      return Promise.resolve({
        content:
          "---\nname: Learning memory\ndescription: Learning memory\ntype: project\nsourceSession: sess-1\ncreatedAt: 2026-06-24T00:00:00.000Z\n---\n\nMemory and Skills are separate tabs.",
        size: 164,
      });
    }
    if (method === "learning.setConfig") {
      return Promise.resolve({
        ...snapshot,
        config: {
          ...snapshot.config,
          memory: { ...snapshot.config.memory, recallEnabled: false },
        },
      });
    }
    return Promise.resolve(snapshot);
  });
  useLearningStore.setState({
    snapshotsBySession: {},
    loadingBySession: {},
    errorBySession: {},
    activeTabBySession: {},
    collapsedSections: new Set(["diagnostics", "auto-memory-runtime"]),
  });
  useMemoryStore.setState({
    eventsBySession: {},
    statusBySession: {},
  });
  setSessionState({
    activeSessionId: null,
    projectTabs: [],
    activeProjectId: null,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("LearningPanel", () => {
  it("renders empty state without an active session", () => {
    render(<LearningPanel />);
    expect(screen.getByText("无活动会话")).toBeInTheDocument();
  });

  it("loads and renders Learning snapshot tabs", async () => {
    setSessionState({
      activeSessionId: "sess-1",
      projectTabs: [{ id: "project-1", name: "Project", path: "/tmp/project" }],
      activeProjectId: "project-1",
    });

    render(<LearningPanel />);

    expect(await screen.findByText("Learning memory")).toBeInTheDocument();
    expect(screen.getAllByText("记忆").length).toBeGreaterThan(0);
    expect(screen.getAllByText("技能").length).toBeGreaterThan(0);
    expect(screen.getAllByText("候选").length).toBeGreaterThan(0);
    expect(mockApiCall).toHaveBeenCalledWith("learning.getSnapshot", {
      projectPath: "/tmp/project",
      sessionId: "sess-1",
    });
    expect(mockApiCall).toHaveBeenCalledWith("memory.readFile", {
      filePath: "/tmp/agent/projects/key/memory/MEMORY.md",
    });
  });

  it("keeps horizontal overflow scoped inside Learning instead of the whole panel", async () => {
    setSessionState({
      activeSessionId: "sess-1",
      projectTabs: [{ id: "project-1", name: "Project", path: "/tmp/project" }],
      activeProjectId: "project-1",
    });

    render(<LearningPanel />);

    expect(await screen.findByTestId("learning-panel")).toHaveClass("overflow-x-hidden");
    expect(screen.getByTestId("learning-panel-scroll")).toHaveClass("overflow-x-hidden");
  });

  it("opens listed files through Explorer/FileOverlay", async () => {
    setSessionState({
      activeSessionId: "sess-1",
      projectTabs: [{ id: "project-1", name: "Project", path: "/tmp/project" }],
      activeProjectId: "project-1",
    });

    render(<LearningPanel />);
    fireEvent.click(await screen.findByText("memory.md"));

    expect(mockOpenFile).toHaveBeenCalledWith(
      {
        name: "memory.md",
        path: "/tmp/agent/projects/key/memory/memory.md",
        type: "file",
        size: 42,
      },
      false,
    );
  });

  it("deletes memory files after confirmation and refreshes the snapshot", async () => {
    setSessionState({
      activeSessionId: "sess-1",
      projectTabs: [{ id: "project-1", name: "Project", path: "/tmp/project" }],
      activeProjectId: "project-1",
    });
    render(<LearningPanel />);
    fireEvent.click(await screen.findByTitle("删除记忆"));

    expect(screen.getByText("删除记忆「Learning memory」？")).toBeInTheDocument();
    fireEvent.click(screen.getByText("确认删除"));

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith("memory.deleteFile", {
        filePath: "/tmp/agent/projects/key/memory/memory.md",
      });
    });
    await waitFor(() => {
      const refreshCalls = mockApiCall.mock.calls.filter(
        ([method]) => method === "learning.getSnapshot",
      );
      expect(refreshCalls.length).toBeGreaterThanOrEqual(2);
    });
  });

  it("shows candidate creation time and opens candidate records through Explorer/FileOverlay", async () => {
    setSessionState({
      activeSessionId: "sess-1",
      projectTabs: [{ id: "project-1", name: "Project", path: "/tmp/project" }],
      activeProjectId: "project-1",
    });

    render(<LearningPanel />);
    fireEvent.click(await screen.findByText("候选"));

    expect(await screen.findByText("candidate-1.json")).toBeInTheDocument();
    expect(screen.getByText("刚刚")).toBeInTheDocument();
    fireEvent.click(screen.getByText("candidate-1.json"));

    expect(mockOpenFile).toHaveBeenCalledWith(
      {
        name: "candidate-1.json",
        path: "/tmp/agent/projects/key/learning/candidates/candidate-1.json",
        type: "file",
        size: undefined,
      },
      false,
    );
  });

  it("formats MEMORY.md and expandable memory files with type tags", async () => {
    setSessionState({
      activeSessionId: "sess-1",
      projectTabs: [{ id: "project-1", name: "Project", path: "/tmp/project" }],
      activeProjectId: "project-1",
    });

    render(<LearningPanel />);

    expect(await screen.findByText("Learning memory")).toBeInTheDocument();
    expect(screen.getAllByText("memory.md").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /项目 Learning memory/ }));

    expect(await screen.findByText("Memory and Skills are separate tabs.")).toBeInTheDocument();
    expect(screen.getByText("session sess-1")).toBeInTheDocument();
  });

  it("shows AutoMemory runtime status when expanded", async () => {
    setSessionState({
      activeSessionId: "sess-1",
      projectTabs: [{ id: "project-1", name: "Project", path: "/tmp/project" }],
      activeProjectId: "project-1",
    });
    const memoryFile = "/tmp/agent/projects/key/memory/memory.md";
    memoryStatusResponse = {
      skipRules: {
        builtin: [{ pattern: "node_modules", mode: "contains" }],
        custom: [{ pattern: "scratch", mode: "contains" }],
      },
      guardRules: {
        builtin: [{ pattern: "memory", mode: "contains" }],
        custom: [{ pattern: "learning", mode: "contains" }],
      },
      excludeKeywords: ["noise"],
      recentQueries: [
        {
          query: "Learning pipeline",
          selected: [memoryFile],
          skipped: false,
          skip_hits: ["scratch"],
          guard_hits: ["learning"],
          timestamp: Date.now(),
        },
      ],
      dream: { lastRunAt: Date.now() },
    };
    useMemoryStore.setState({
      eventsBySession: {
        "sess-1": [
          {
            id: "event-1",
            customType: "memory_prefetch_result",
            timestamp: Date.now(),
            data: {
              _prefetchQuery: "Learning pipeline",
              layer: "llm",
              durationMs: 23,
              selectedFiles: [memoryFile],
              injectedBytes: 512,
            },
          },
        ],
      },
      statusBySession: { "sess-1": memoryStatusResponse },
    });

    render(<LearningPanel />);

    fireEvent.click(await screen.findByText("AutoMemory"));

    expect(await screen.findByText("最近预取")).toBeInTheDocument();
    expect(screen.getAllByText(/Learning pipeline/).length).toBeGreaterThan(0);
    expect(screen.getByText("skip contains: scratch")).toBeInTheDocument();
    expect(screen.getByText("guard contains: learning")).toBeInTheDocument();
    const memoryLinks = screen.getAllByText("memory.md");
    fireEvent.click(memoryLinks[memoryLinks.length - 1]!);

    expect(mockOpenFile).toHaveBeenLastCalledWith(
      expect.objectContaining({
        name: "memory.md",
        path: memoryFile,
        type: "file",
      }),
      false,
    );
  });

  it("updates settings through learning.setConfig", async () => {
    setSessionState({
      activeSessionId: "sess-1",
      projectTabs: [{ id: "project-1", name: "Project", path: "/tmp/project" }],
      activeProjectId: "project-1",
    });

    render(<LearningPanel />);
    fireEvent.click(await screen.findByText("设置"));
    fireEvent.click(screen.getAllByRole("checkbox")[0]!);

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith("learning.setConfig", {
        projectPath: "/tmp/project",
        sessionId: "sess-1",
        config: {
          memory: {
            recallEnabled: false,
            extractMode: "pending",
            curatorMode: "dry-run",
            curatorSchedule: { enabled: false, intervalMinutes: 1440 },
          },
        },
      });
    });
  });

  it("updates skill curator schedule through learning.setConfig", async () => {
    setSessionState({
      activeSessionId: "sess-1",
      projectTabs: [{ id: "project-1", name: "Project", path: "/tmp/project" }],
      activeProjectId: "project-1",
    });

    render(<LearningPanel />);
    fireEvent.click(await screen.findByText("设置"));
    const scheduleToggles = screen.getAllByLabelText("定时整理");
    fireEvent.click(scheduleToggles[1]!);

    await waitFor(() => {
      expect(mockApiCall).toHaveBeenCalledWith("learning.setConfig", {
        projectPath: "/tmp/project",
        sessionId: "sess-1",
        config: {
          skills: {
            distillMode: "pending",
            curatorMode: "dry-run",
            curatorSchedule: { enabled: true, intervalMinutes: 1440 },
          },
        },
      });
    });
  });
});
