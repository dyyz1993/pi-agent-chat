import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReturnToSourceSession } from "../../../src/mainview/components/chat/primitives/useReturnToSourceSession";
import { useSessionReturnStore } from "../../../src/mainview/stores/use-session-return-store";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useSubagentStore } from "../../../src/mainview/stores/use-subagent-store";
import type { SessionMeta } from "../../../src/mainview/types";

const initialSessionState = useSessionStore.getState();
const initialSubagentState = useSubagentStore.getState();
const initialReturnState = useSessionReturnStore.getState();

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

describe("useReturnToSourceSession", () => {
  afterEach(() => {
    useSessionStore.setState(initialSessionState, true);
    useSubagentStore.setState(initialSubagentState, true);
    useSessionReturnStore.setState(initialReturnState, true);
  });

  it("returns from an active subagent view to the current main session", () => {
    const setActiveSubsession = vi.fn();
    useSessionStore.setState({ activeSessionId: "main-session" });
    useSubagentStore.setState({
      activeSubsessionId: "sub-session",
      setActiveSubsession,
    });

    const { result } = renderHook(() => useReturnToSourceSession());

    expect(result.current?.kind).toBe("subagent");
    expect(result.current?.targetSessionId).toBe("main-session");

    act(() => result.current?.handleReturn());

    expect(setActiveSubsession).toHaveBeenCalledWith("main-session", null);
  });

  it("uses delegateParentSessionId as the delegate source session when present", async () => {
    const setActiveSession = vi.fn();
    useSessionStore.setState({
      activeSessionId: "delegate-session",
      activeProjectId: "tab-1",
      projectTabs: [{ id: "tab-1", name: "Project", path: "/project" }],
      sessionsByProject: {
        "/project": [
          session({ sessionId: "source-session" }),
          session({
            sessionId: "delegate-session",
            delegateParentSessionId: "source-session",
            delegateType: "coordinator",
          }),
        ],
      },
      setActiveSession,
      setActiveProject: vi.fn(),
    });

    const { result } = renderHook(() => useReturnToSourceSession());

    expect(result.current?.kind).toBe("delegate");
    expect(result.current?.targetSessionId).toBe("source-session");

    await act(async () => {
      result.current?.handleReturn();
      await Promise.resolve();
    });

    expect(setActiveSession).toHaveBeenCalledWith("source-session", true);
  });

  it("treats delegateType=subagent sessions as returning to the main session", () => {
    useSessionStore.setState({
      activeSessionId: "sync-subagent",
      activeProjectId: "tab-1",
      projectTabs: [{ id: "tab-1", name: "Project", path: "/project" }],
      sessionsByProject: {
        "/project": [
          session({ sessionId: "main-session" }),
          session({
            sessionId: "sync-subagent",
            delegateParentSessionId: "main-session",
            delegateType: "subagent",
          }),
        ],
      },
      setActiveSession: vi.fn(),
      setActiveProject: vi.fn(),
    });

    const { result } = renderHook(() => useReturnToSourceSession());

    expect(result.current?.kind).toBe("subagent");
    expect(result.current?.targetSessionId).toBe("main-session");
  });

  it("falls back to the card navigation source when delegate metadata is missing", async () => {
    const setActiveSession = vi.fn();
    useSessionStore.setState({
      activeSessionId: "legacy-delegate",
      activeProjectId: "tab-1",
      projectTabs: [{ id: "tab-1", name: "Project", path: "/project" }],
      sessionsByProject: {
        "/project": [
          session({ sessionId: "source-session" }),
          session({ sessionId: "legacy-delegate", delegateParentSessionId: null }),
        ],
      },
      setActiveSession,
      setActiveProject: vi.fn(),
    });
    useSessionReturnStore.getState().setReturnSource("legacy-delegate", "source-session");

    const { result } = renderHook(() => useReturnToSourceSession());

    expect(result.current?.kind).toBe("source");
    expect(result.current?.targetSessionId).toBe("source-session");

    await act(async () => {
      result.current?.handleReturn();
      await Promise.resolve();
    });

    expect(setActiveSession).toHaveBeenCalledWith("source-session", true);
    expect(useSessionReturnStore.getState().returnSourceBySession["legacy-delegate"]).toBe(
      undefined,
    );
  });

  it("clears stale card navigation source after leaving the target session", () => {
    useSessionReturnStore.getState().setReturnSource("legacy-delegate", "source-session");

    useSessionStore.setState({
      activeSessionId: "legacy-delegate",
      activeProjectId: "tab-1",
      projectTabs: [{ id: "tab-1", name: "Project", path: "/project" }],
      sessionsByProject: {
        "/project": [
          session({ sessionId: "source-session" }),
          session({ sessionId: "legacy-delegate", delegateParentSessionId: null }),
          session({ sessionId: "other-session", delegateParentSessionId: null }),
        ],
      },
    });

    const { result, rerender } = renderHook(() => useReturnToSourceSession());
    expect(result.current?.kind).toBe("source");

    act(() => {
      useSessionStore.setState({ activeSessionId: "other-session" });
    });
    rerender();

    expect(useSessionReturnStore.getState().activeReturnTargetId).toBeNull();
    expect(useSessionReturnStore.getState().returnSourceBySession["legacy-delegate"]).toBe(
      undefined,
    );
  });
});
