import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => ({
  fetchAgents: vi.fn(),
  fetchInitialState: vi.fn(),
  fetchModelState: vi.fn(),
  fetchTierConfig: vi.fn(),
  switchAgent: vi.fn(),
  toggleAgentFavorite: vi.fn(),
  tierDataBySession: {} as Record<
    string,
    { projectPath: string; tierModels: Record<string, string>; currentTier: string | null }
  >,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        agentSelect: "Agent Select",
        agentBuild: "Build",
        loading: "Loading",
        notLoaded: "Not loaded",
        tierFast: "Fast",
        tierPro: "Pro",
        tierMax: "Max",
        thinkingOff: "Off",
        default: "Default",
        mainWorkspace: "Main workspace",
        notGitRepo: "Not a git repo",
        workspaceSelect: "Workspace Select",
        favorite: "Favorite",
        unfavorite: "Unfavorite",
      };
      return map[key] ?? key;
    },
  }),
}));

const mockSessionState = {
  activeSessionId: "sess-1",
  agentReady: { "sess-1": true },
  currentModel: null,
  modelStateLoading: false,
  currentThinkingLevel: "off",
  thinkingLevelBySession: {},
  availableModels: [],
  setCurrentModel: vi.fn(),
  setThinkingLevel: vi.fn(),
  fetchInitialState: hoisted.fetchInitialState,
  fetchModelState: hoisted.fetchModelState,
  sessionsByProject: {
    "/project": [
      {
        sessionId: "sess-1",
        projectPath: "/project",
        sessionPath: "/project/sess-1.jsonl",
      },
    ],
  },
  projectTabs: [{ id: "tab-1", path: "/project", name: "Project" }],
  activeProjectId: "tab-1",
  addProjectTab: vi.fn(),
  createNewSession: vi.fn(),
  updateSessionProjectPath: vi.fn(),
};

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    vi.fn((selector: (state: typeof mockSessionState) => unknown) => selector(mockSessionState)),
    {
      getState: vi.fn(() => mockSessionState),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-tier-store", () => ({
  TIER_KEYS: ["fast", "pro", "max"],
  useTierStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      dataBySession: hoisted.tierDataBySession,
      globalDefaults: {},
      getCurrentTierForSession: (sessionId: string, projectPath: string) =>
        hoisted.tierDataBySession[sessionId]?.projectPath === projectPath
          ? (hoisted.tierDataBySession[sessionId]?.currentTier ?? null)
          : null,
      getTierModelsForSession: (sessionId: string, projectPath: string) =>
        hoisted.tierDataBySession[sessionId]?.projectPath === projectPath
          ? (hoisted.tierDataBySession[sessionId]?.tierModels ?? {})
          : {},
      switchToTier: vi.fn(),
      fetchTierConfig: hoisted.fetchTierConfig,
      setSessionCurrentTier: vi.fn(),
      syncTierFromModelForSession: vi.fn(),
    }),
  ),
}));

vi.mock("../../../src/mainview/stores/use-git-store", () => ({
  useGitStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      worktrees: [
        {
          path: "/project",
          branch: "main",
          isMain: true,
        },
      ],
      isGitRepo: true,
      fetchWorktrees: vi.fn(),
      refreshAll: vi.fn(),
      addWorktree: vi.fn(),
    }),
  ),
}));

vi.mock("../../../src/mainview/stores/use-agent-store", () => ({
  getSourceLabel: (source: string) => source,
  isGlobalAgent: (source: string) => source === "builtin" || source === "user",
  useAgentStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      currentAgentBySession: { "sess-1": "build" },
      agents: [
        {
          name: "build",
          source: "builtin",
          filePath: "/agents/build.md",
          description: "Build things",
        },
        {
          name: "frontend-dev",
          source: "project",
          filePath: "/project/.pi/agents/frontend-dev.md",
          description: "Frontend helper",
        },
      ],
      agentFavorites: new Set<string>(),
      agentDetailBySession: {},
      switchingBySession: {},
      switchAgent: hoisted.switchAgent,
      fetchAgents: hoisted.fetchAgents,
      toggleAgentFavorite: hoisted.toggleAgentFavorite,
    }),
  ),
}));

vi.mock("../../../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: {
    getState: () => ({
      push: vi.fn(),
    }),
  },
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("../../../src/mainview/components/theme/ThemeMenu", () => ({
  ThemeMenu: () => <div data-testid="theme-menu" />,
}));

vi.mock("../../../src/mainview/components/model-picker/ModelPickerButton", () => ({
  ModelPickerButton: () => <div data-testid="model-picker" />,
}));

vi.mock("../../../src/mainview/components/chat/CopyButton", () => ({
  CopyButton: () => null,
}));

vi.mock("../../../src/mainview/components/primitives", () => ({
  DropdownSelect: () => null,
}));

vi.mock("../../../src/mainview/components/agent-avatar/AgentAvatar", () => ({
  AgentAvatar: () => <div data-testid="agent-avatar" />,
}));

import { SidebarBottomControls } from "../../../src/mainview/components/left-sidebar/SidebarBottomControls";

describe("SidebarBottomControls agent menu", () => {
  beforeEach(() => {
    hoisted.fetchAgents.mockReset();
    hoisted.fetchInitialState.mockReset();
    hoisted.fetchModelState.mockReset();
    hoisted.fetchTierConfig.mockReset();
    hoisted.switchAgent.mockReset();
    hoisted.toggleAgentFavorite.mockReset();
    hoisted.tierDataBySession = {};
    mockSessionState.sessionsByProject = {
      "/project": [
        {
          sessionId: "sess-1",
          projectPath: "/project",
          sessionPath: "/project/sess-1.jsonl",
        },
      ],
    };
    mockSessionState.projectTabs = [{ id: "tab-1", path: "/project", name: "Project" }];
    mockSessionState.activeProjectId = "tab-1";
  });

  afterEach(() => {
    cleanup();
  });

  it("refreshes the agent list when opening the agent dropdown", () => {
    render(<SidebarBottomControls />);

    fireEvent.click(screen.getByRole("button", { name: "Agent Select" }));

    expect(hoisted.fetchAgents).toHaveBeenCalledWith("sess-1");
  });

  it("shows the tier selected for the effective session project after refresh", () => {
    mockSessionState.sessionsByProject = {
      "/worktree/project": [
        {
          sessionId: "sess-1",
          projectPath: "/worktree/project",
          sessionPath: "/worktree/project/sess-1.jsonl",
        },
      ],
    };
    mockSessionState.projectTabs = [{ id: "tab-1", path: "/parent/project", name: "Project" }];
    hoisted.tierDataBySession = {
      "sess-1": {
        projectPath: "/worktree/project",
        tierModels: { fast: "opencode-go/deepseek-v4-flash" },
        currentTier: "fast",
      },
    };

    render(<SidebarBottomControls />);

    expect(screen.getByTitle("Fast").className).toContain("text-accent");
  });
});
