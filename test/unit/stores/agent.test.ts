import { describe, it, expect, beforeEach, vi } from "vitest";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { useAgentStore, type AgentInfo } from "../../../src/mainview/stores/use-agent-store";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn() },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  clearAgentStarted: vi.fn(),
  markAgentStarted: vi.fn(),
  useSessionStore: {
    getState: vi.fn(() => ({
      sessionsByProject: {},
      projectTabs: [],
      activeProjectId: null,
      fetchInitialState: vi.fn(),
    })),
    setState: vi.fn(),
  },
}));

const agents: AgentInfo[] = [
  { name: "frontend-dev", source: "user", filePath: "/agents/frontend-dev.md" },
  { name: "build", source: "builtin", filePath: "" },
  { name: "rules-engine", source: "project", filePath: ".pi/agents/rules-engine.md" },
];

describe("useAgentStore favorites", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentStore.setState({
      currentAgentBySession: {},
      agents: [],
      agentFavorites: new Set(),
      switchingBySession: {},
      loaded: false,
      agentDetailBySession: {},
      allToolsBySession: {},
      liveSystemPromptBySession: {},
      loadingDetail: false,
      loadingSystemPrompt: new Set(),
    });
  });

  it("marks favorite agents and sorts them first", () => {
    useAgentStore.getState().setAgentFavorites(["rules-engine"]);
    useAgentStore.getState().setAgents(agents);

    const sorted = useAgentStore.getState().agents;
    expect(sorted.map((agent) => agent.name)).toEqual(["rules-engine", "build", "frontend-dev"]);
    expect(sorted[0].isFavorite).toBe(true);
  });

  it("toggles favorite agents through project RPC", async () => {
    vi.mocked(apiClient.call).mockResolvedValueOnce({
      added: true,
      favorites: ["frontend-dev"],
    });
    useAgentStore.getState().setAgents(agents);

    await useAgentStore.getState().toggleAgentFavorite("frontend-dev");

    expect(apiClient.call).toHaveBeenCalledWith("project.toggleAgentFavorite", {
      agentName: "frontend-dev",
    });
    expect(useAgentStore.getState().agentFavorites.has("frontend-dev")).toBe(true);
    expect(useAgentStore.getState().agents[0].name).toBe("frontend-dev");
  });
});
