import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { useEffectiveSessionResourceSync } from "../../../src/mainview/hooks/use-effective-session-resource-sync";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useSubagentStore } from "../../../src/mainview/stores/use-subagent-store";
import type { SessionMeta } from "../../../src/mainview/types";

const initialSessionState = useSessionStore.getState();
const initialSubagentState = useSubagentStore.getState();
const apiCall = apiClient.call as unknown as ReturnType<typeof vi.fn>;

function session(overrides: Partial<SessionMeta>): SessionMeta {
  return {
    sessionId: "session-1",
    name: "Session",
    sessionPath: "/tmp/session-1.jsonl",
    projectPath: "/project",
    parentSessionPath: null,
    delegateParentSessionId: null,
    delegateType: null,
    messageCount: 1,
    firstMessage: "",
    createdAt: 1,
    updatedAt: 1,
    status: "idle",
    ...overrides,
  };
}

describe("useEffectiveSessionResourceSync", () => {
  afterEach(() => {
    useSessionStore.setState(initialSessionState, true);
    useSubagentStore.setState(initialSubagentState, true);
    apiCall.mockReset();
    vi.clearAllMocks();
  });

  it("refreshes resources for the active subagent session instead of the parent", () => {
    const fetchInitialState = vi.fn();
    useSessionStore.setState({
      activeSessionId: "parent-session",
      fetchInitialState,
    });
    useSubagentStore.setState({ activeSubsessionId: "child-session" });

    renderHook(() => useEffectiveSessionResourceSync());

    expect(fetchInitialState).toHaveBeenCalledTimes(1);
    expect(fetchInitialState).toHaveBeenCalledWith("child-session");
  });

  it("starts an inactive subagent runtime before refreshing panel state", async () => {
    apiCall.mockResolvedValue({ status: "started" });
    const fetchInitialState = vi.fn();
    useSessionStore.setState({
      activeSessionId: "parent-session",
      activeProjectId: "project-tab",
      projectTabs: [{ id: "project-tab", name: "Project", path: "/project" }],
      sessionsByProject: {
        "/project": [session({ sessionId: "parent-session", sessionPath: "/tmp/parent.jsonl" })],
      },
      fetchInitialState,
    });
    useSubagentStore.setState({
      activeSubsessionId: "child-session",
      subsessionsByParent: {
        "/tmp/parent.jsonl": [
          {
            sessionId: "child-session",
            sessionPath: "/tmp/child.jsonl",
            description: "Child task",
            instruction: "Do work",
            startedAt: 1,
            completedAt: 2,
          },
        ],
      },
    });

    renderHook(() => useEffectiveSessionResourceSync());

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith("agent.start", {
        sessionId: "child-session",
        projectPath: "/project",
        sessionPath: "/tmp/child.jsonl",
        forceNewProcess: true,
      });
    });
    await waitFor(() => {
      expect(fetchInitialState).toHaveBeenCalledWith("child-session");
    });
  });

  it("starts the selected subagent once its session path is loaded later", async () => {
    apiCall.mockResolvedValue({ status: "started" });
    useSessionStore.setState({
      activeSessionId: "parent-session",
      fetchInitialState: vi.fn(),
    });
    useSubagentStore.setState({ activeSubsessionId: "child-session" });

    renderHook(() => useEffectiveSessionResourceSync());

    expect(apiCall).not.toHaveBeenCalledWith("agent.start", expect.anything());

    act(() => {
      useSessionStore.setState({
        activeProjectId: "project-tab",
        projectTabs: [{ id: "project-tab", name: "Project", path: "/project" }],
        sessionsByProject: {
          "/project": [
            session({ sessionId: "parent-session", sessionPath: "/tmp/parent.jsonl" }),
          ],
        },
      });
      useSubagentStore.setState({
        subsessionsByParent: {
          "/tmp/parent.jsonl": [
            {
              sessionId: "child-session",
              sessionPath: "/tmp/child.jsonl",
              description: "Child task",
              instruction: "Do work",
              startedAt: 1,
              completedAt: 2,
            },
          ],
        },
      });
    });

    await waitFor(() => {
      expect(apiCall).toHaveBeenCalledWith("agent.start", {
        sessionId: "child-session",
        projectPath: "/project",
        sessionPath: "/tmp/child.jsonl",
        forceNewProcess: true,
      });
    });
  });

  it("refreshes the parent session again after leaving a subagent view", () => {
    const fetchInitialState = vi.fn();
    useSessionStore.setState({
      activeSessionId: "parent-session",
      fetchInitialState,
    });
    useSubagentStore.setState({ activeSubsessionId: "child-session" });

    renderHook(() => useEffectiveSessionResourceSync());
    const initialCallCount = fetchInitialState.mock.calls.length;

    act(() => {
      useSubagentStore.setState({ activeSubsessionId: null });
    });

    expect(fetchInitialState.mock.calls.length).toBeGreaterThan(initialCallCount);
    expect(fetchInitialState).toHaveBeenLastCalledWith("parent-session");
  });
});
