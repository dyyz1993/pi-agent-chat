import { afterEach, describe, expect, it } from "vitest";
import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useStatusStore } from "../../../src/mainview/stores/use-status-store";
import { useSubagentStore } from "../../../src/mainview/stores/use-subagent-store";

const initialSessionState = useSessionStore.getState();
const initialSubagentState = useSubagentStore.getState();
const initialStatusState = useStatusStore.getState();

describe("status store effective session snapshots", () => {
  afterEach(() => {
    useSessionStore.setState(initialSessionState, true);
    useSubagentStore.setState(initialSubagentState, true);
    useStatusStore.setState(initialStatusState, true);
    localStorage.clear();
  });

  it("does not let a stale parent permission snapshot overwrite the active subagent panel", () => {
    useSessionStore.setState({ activeSessionId: "parent-session" });
    useSubagentStore.setState({ activeSubsessionId: "child-session" });
    useStatusStore.setState({ permissionProfile: "yolo" });

    useStatusStore.getState().applyPermissionProfileSnapshot("normal", "parent-session");

    expect(useStatusStore.getState().permissionProfile).toBe("yolo");
    expect(useStatusStore.getState().getRememberedPermissionProfile("parent-session")).toBe(
      "normal",
    );
  });

  it("applies a permission snapshot when it belongs to the current effective session", () => {
    useSessionStore.setState({ activeSessionId: "parent-session" });
    useSubagentStore.setState({ activeSubsessionId: "child-session" });

    useStatusStore.getState().applyPermissionProfileSnapshot("readonly", "child-session");

    expect(useStatusStore.getState().permissionProfile).toBe("readonly");
    expect(useStatusStore.getState().getRememberedPermissionProfile("child-session")).toBe(
      "readonly",
    );
  });
});
