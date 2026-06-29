import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { sortAgentsForDisplay, useAgentStore } from "../../../src/mainview/stores/use-agent-store";
import { useNotificationStore } from "../../../src/mainview/stores/use-notification-store";

const mockCall = vi.mocked(apiClient.call);

function resetAgentStore() {
  useAgentStore.setState({
    currentAgentBySession: {},
    agents: [],
    switchingBySession: {},
    agentDetailBySession: {},
    allToolsBySession: {},
    liveSystemPromptBySession: {},
    loadingDetail: false,
    loadingSystemPrompt: new Set<string>(),
    loaded: false,
    agentFavorites: new Set<string>(),
  });
}

describe("useAgentStore agent list", () => {
  beforeEach(() => {
    resetAgentStore();
    mockCall.mockReset();
    useNotificationStore.setState({ notifications: [], panelOpen: false });
  });

  it("orders favorite agents before non-favorites while preserving relative order", () => {
    const agents = [
      { name: "build", source: "builtin" as const, filePath: "" },
      { name: "explore", source: "builtin" as const, filePath: "" },
      { name: "pi-expert", source: "user" as const, filePath: "" },
      { name: "reviewer", source: "project" as const, filePath: "" },
    ];

    expect(
      sortAgentsForDisplay(agents, new Set(["pi-expert", "reviewer"])).map((a) => a.name),
    ).toEqual(["pi-expert", "reviewer", "build", "explore"]);
  });

  it("fetches persisted agent favorites and applies them to the agent list", async () => {
    mockCall.mockImplementation(async (method: string) => {
      if (method === "agent.getAgents") {
        return {
          agents: [
            { name: "build", source: "builtin", filePath: "" },
            { name: "pi-expert", source: "user", filePath: "" },
          ],
        };
      }
      if (method === "project.getAgentFavorites") return { favorites: ["pi-expert"] };
      if (method === "agent.getCurrentAgent") return { agentName: "build" };
      if (method === "agent.getAgentDetail") return { agent: { name: "build" } };
      if (method === "agent.getAllTools") return { tools: [] };
      throw new Error(`unexpected method ${method}`);
    });

    await useAgentStore.getState().fetchAgents("sess-1");

    expect(useAgentStore.getState().agents.map((agent) => agent.name)).toEqual([
      "pi-expert",
      "build",
    ]);
    expect([...useAgentStore.getState().agentFavorites]).toEqual(["pi-expert"]);
  });

  it("persists favorite toggles and reorders the existing list", async () => {
    useAgentStore.setState({
      agents: [
        { name: "build", source: "builtin", filePath: "" },
        { name: "pi-expert", source: "user", filePath: "" },
      ],
    });
    mockCall.mockResolvedValue({ added: true, favorites: ["pi-expert"] });

    await useAgentStore.getState().toggleAgentFavorite("pi-expert");

    expect(mockCall).toHaveBeenCalledWith("project.toggleAgentFavorite", {
      agentName: "pi-expert",
    });
    expect(useAgentStore.getState().agents.map((agent) => agent.name)).toEqual([
      "pi-expert",
      "build",
    ]);
  });

  it("surfaces a restart hint when the desktop process is missing the favorites RPC", async () => {
    mockCall.mockRejectedValue(new Error("Method not found: project.toggleAgentFavorite"));

    await useAgentStore.getState().toggleAgentFavorite("pi-expert");

    expect(useNotificationStore.getState().notifications[0]?.message).toBe(
      "Agent 收藏能力尚未加载到当前桌面进程，请重启桌面端后重试。",
    );
  });
});
