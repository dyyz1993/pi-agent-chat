import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useTierStore } from "../../../src/mainview/stores/use-tier-store";
import { useInitialQcTier } from "../../../src/mainview/components/project-picker/use-initial-qc-tier";

// Regression coverage for issue #172 step 3: the Quick Create default tier
// must follow the user's active session tier rather than a hardcoded "fast".
describe("useInitialQcTier", () => {
  const originalSession = useSessionStore.getState();
  const originalTier = useTierStore.getState();

  beforeEach(() => {
    useSessionStore.setState({
      projectTabs: [],
      activeProjectId: null,
      activeSessionId: null,
    });
    useTierStore.setState({ dataBySession: {} });
  });

  afterEach(() => {
    useSessionStore.setState(originalSession);
    useTierStore.setState(originalTier);
  });

  function setActiveSession(sessionId: string, projectPath: string, tier: "fast" | "pro" | "max" | null) {
    useSessionStore.setState({
      activeSessionId: sessionId,
      activeProjectId: "tab-1",
      projectTabs: [{ id: "tab-1", path: projectPath } as never],
    });
    if (tier) {
      useTierStore.setState({
        dataBySession: {
          [sessionId]: { currentTier: tier, tierModels: null } as never,
        },
      });
    }
  }

  it("returns 'fast' when no session is active", () => {
    const { result } = renderHook(() => useInitialQcTier());
    expect(result.current).toBe("fast");
  });

  it("returns the active session's configured 'pro' tier", () => {
    setActiveSession("sess-1", "/proj", "pro");
    const { result } = renderHook(() => useInitialQcTier());
    expect(result.current).toBe("pro");
  });

  it("returns the active session's configured 'max' tier", () => {
    setActiveSession("sess-2", "/proj", "max");
    const { result } = renderHook(() => useInitialQcTier());
    expect(result.current).toBe("max");
  });

  it("falls back to 'fast' when active session has null currentTier", () => {
    setActiveSession("sess-3", "/proj", null);
    const { result } = renderHook(() => useInitialQcTier());
    expect(result.current).toBe("fast");
  });

  it("reacts to tier changes in the store", () => {
    setActiveSession("sess-4", "/proj", "fast");
    const { result } = renderHook(() => useInitialQcTier());
    expect(result.current).toBe("fast");

    act(() => {
      useTierStore.setState({
        dataBySession: {
          "sess-4": { currentTier: "pro", tierModels: null } as never,
        },
      });
    });
    expect(result.current).toBe("pro");
  });

  it("ignores tier data for a different session id", () => {
    useSessionStore.setState({
      activeSessionId: "active-sess",
      activeProjectId: "tab-1",
      projectTabs: [{ id: "tab-1", path: "/proj" } as never],
    });
    useTierStore.setState({
      dataBySession: {
        "other-sess": { currentTier: "max", tierModels: null } as never,
      },
    });
    const { result } = renderHook(() => useInitialQcTier());
    expect(result.current).toBe("fast");
  });
});
