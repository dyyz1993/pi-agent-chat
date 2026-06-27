import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock useUIDialogStore so we can assert the parent-side UI request registration
// triggered by a coordinator-relayed child event. Keep the mock minimal: only
// the methods registerCoordinatorChildUiRequest touches.
const registerUIRequest = vi.fn();
const resolveFromRemote = vi.fn();
vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: {
    getState: () => ({ registerUIRequest, resolveFromRemote }),
  },
}));

import {
  registerCoordinatorChildUiRequest,
} from "../../../src/mainview/stores/session-subscriptions";

const CHILD = "child-sess-1";

beforeEach(() => {
  registerUIRequest.mockClear();
  resolveFromRemote.mockClear();
});

describe("registerCoordinatorChildUiRequest (#5)", () => {
  it("registers an interactive permission prompt relayed from a child session", () => {
    registerCoordinatorChildUiRequest(CHILD, {
      type: "extension_ui_request",
      id: "req-1",
      method: "confirm",
      title: "Allow bash?",
      message: "rm -rf /tmp/x",
    });

    expect(registerUIRequest).toHaveBeenCalledTimes(1);
    expect(registerUIRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "req-1",
        sessionId: CHILD,
        method: "confirm",
        title: "Allow bash?",
        message: "rm -rf /tmp/x",
      }),
    );
  });

  it("ignores non-interactive (notify) UI requests", () => {
    registerCoordinatorChildUiRequest(CHILD, {
      type: "extension_ui_request",
      id: "req-2",
      method: "notify",
      message: "hello",
    });

    expect(registerUIRequest).not.toHaveBeenCalled();
  });

  it("ignores UI requests missing id or method", () => {
    registerCoordinatorChildUiRequest(CHILD, { type: "extension_ui_request", method: "confirm" });
    registerCoordinatorChildUiRequest(CHILD, { type: "extension_ui_request", id: "req-3" });
    expect(registerUIRequest).not.toHaveBeenCalled();
  });

  it("resolves a relayed extension_ui_resolved so the parent entry point clears", () => {
    registerCoordinatorChildUiRequest(CHILD, {
      type: "extension_ui_resolved",
      id: "req-1",
      reason: "responded",
    });

    expect(resolveFromRemote).toHaveBeenCalledWith("req-1", "responded");
    expect(registerUIRequest).not.toHaveBeenCalled();
  });

  it("ignores unrelated event types", () => {
    registerCoordinatorChildUiRequest(CHILD, { type: "agent_end" });
    registerCoordinatorChildUiRequest(CHILD, { type: "message_update" });
    expect(registerUIRequest).not.toHaveBeenCalled();
    expect(resolveFromRemote).not.toHaveBeenCalled();
  });
});
