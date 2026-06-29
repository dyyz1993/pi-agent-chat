import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentPanel } from "../../../src/mainview/components/agent-panel/AgentPanel";
import { useLayoutStore } from "../../../src/mainview/layouts/use-layout-store";
import { useAgentStore } from "../../../src/mainview/stores/use-agent-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useSubagentStore } from "../../../src/mainview/stores/use-subagent-store";

describe("AgentPanel refresh", () => {
  const fetchAgents = vi.fn();
  const fetchAgentDetail = vi.fn();
  const fetchAllTools = vi.fn();
  const fetchSystemPrompt = vi.fn();
  const originalAgentActions = {
    fetchAgents: useAgentStore.getState().fetchAgents,
    fetchAgentDetail: useAgentStore.getState().fetchAgentDetail,
    fetchAllTools: useAgentStore.getState().fetchAllTools,
    fetchSystemPrompt: useAgentStore.getState().fetchSystemPrompt,
  };
  const originalActivePanelTab = useLayoutStore.getState().activePanelTab;

  beforeEach(() => {
    fetchAgents.mockReset();
    fetchAgentDetail.mockReset();
    fetchAllTools.mockReset();
    fetchSystemPrompt.mockReset();
    useSessionStore.setState({ activeSessionId: "sess-1" });
    useSubagentStore.setState({ activeSubsessionId: null });
    useLayoutStore.setState({ activePanelTab: "changeReview" });
    useAgentStore.setState({
      agents: [{ name: "build", source: "builtin", filePath: "" }],
      currentAgentBySession: { "sess-1": "build" },
      agentDetailBySession: {
        "sess-1": {
          name: "build",
          description: "Build things",
          systemPrompt: "You build.",
          source: "builtin",
          filePath: "",
        },
      },
      allToolsBySession: { "sess-1": [] },
      liveSystemPromptBySession: {},
      loadingDetail: false,
      fetchAgents,
      fetchAgentDetail,
      fetchAllTools,
      fetchSystemPrompt,
    });
  });

  afterEach(() => {
    cleanup();
    useAgentStore.setState(originalAgentActions);
    useLayoutStore.setState({ activePanelTab: originalActivePanelTab });
  });

  it("refreshes the agent list as well as agent detail data", () => {
    render(<AgentPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(fetchAgents).toHaveBeenCalledWith("sess-1");
    expect(fetchAgentDetail).toHaveBeenCalledWith("sess-1");
    expect(fetchAllTools).toHaveBeenCalledWith("sess-1");
    expect(fetchSystemPrompt).toHaveBeenCalledWith("sess-1");
  });

  it("auto-refreshes the agent list when the agent panel tab becomes active", () => {
    useLayoutStore.setState({ activePanelTab: "agent" });

    render(<AgentPanel />);

    expect(fetchAgents).toHaveBeenCalledWith("sess-1");
    expect(fetchAgentDetail).toHaveBeenCalledWith("sess-1");
    expect(fetchAllTools).toHaveBeenCalledWith("sess-1");
    expect(fetchSystemPrompt).toHaveBeenCalledWith("sess-1");
  });

  it("follows the visible subagent session when one is active", () => {
    useSessionStore.setState({ activeSessionId: "parent-session" });
    useSubagentStore.setState({ activeSubsessionId: "child-session" });
    useLayoutStore.setState({ activePanelTab: "agent" });
    useAgentStore.setState({
      currentAgentBySession: { "child-session": "build" },
      agentDetailBySession: {
        "child-session": {
          name: "build",
          description: "Child build",
          systemPrompt: "You build in the child.",
          source: "builtin",
          filePath: "",
        },
      },
      allToolsBySession: { "child-session": [] },
    });

    render(<AgentPanel />);

    expect(fetchAgents).toHaveBeenCalledWith("child-session");
    expect(fetchAgentDetail).toHaveBeenCalledWith("child-session");
    expect(fetchAllTools).toHaveBeenCalledWith("child-session");
    expect(fetchSystemPrompt).toHaveBeenCalledWith("child-session");
    expect(fetchAgents).not.toHaveBeenCalledWith("parent-session");
  });
});
