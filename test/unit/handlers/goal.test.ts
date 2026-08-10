import { beforeEach, describe, expect, it, vi } from "vitest";
import { register } from "../../../src/shared/handlers/goal";
import { createMockServer } from "../../helpers/mock-server";
import type { MockServer } from "../../helpers/mock-server";

const channelMocks = vi.hoisted(() => ({
  forwardToChannel: vi.fn(),
  getProcessManager: vi.fn(),
}));

vi.mock("../../../src/shared/handlers/channel-helpers", () => ({
  forwardToChannel: channelMocks.forwardToChannel,
}));

vi.mock("../../../src/shared/handlers/agent", () => ({
  getProcessManager: channelMocks.getProcessManager,
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

/**
 * Drive a registered RPC handler and return its result.
 */
async function callHandler(server: MockServer, method: string, params: unknown): Promise<unknown> {
  const handler = server.handlers.get(method);
  if (!handler) throw new Error(`handler ${method} not registered`);
  return handler(params);
}

/** Read the routing info from the latest forwardToChannel mock invocation. */
function lastForwardedCall(): { channel: string; method: string; payload: unknown } {
  const calls = channelMocks.forwardToChannel.mock.calls;
  if (calls.length === 0) {
    throw new Error("forwardToChannel was not called");
  }
  const [, channel, method, payload] = calls[calls.length - 1] as [
    unknown,
    string,
    string,
    Record<string, unknown>,
  ];
  return { channel, method, payload };
}

describe("goal handler", () => {
  let server: MockServer;

  beforeEach(() => {
    vi.clearAllMocks();
    channelMocks.forwardToChannel.mockResolvedValue(null);
    channelMocks.getProcessManager.mockReturnValue({
      callChannel: vi.fn(),
    });
    server = createMockServer();
    register(server as unknown as Parameters<typeof register>[0], {} as Parameters<typeof register>[1]);
  });

  describe("routing — each RPC method forwards to the right channel method", () => {
    it("goal.getStatus forwards to goal.getStatus", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({
        enabled: true,
        state: "idle",
        rawStatus: "idle",
        rawPhase: "idle",
        continuationSequence: 0,
        turnCount: 0,
      });
      const result = await callHandler(server, "goal.getStatus", { sessionId: "sess-1" });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "getStatus",
        payload: {},
      });
      expect((result as { state: string }).state).toBe("idle");
    });

    it("goal.startSetup forwards objective to channel", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ started: true, goalId: "g-1" });
      const result = await callHandler(server, "goal.startSetup", {
        sessionId: "sess-1",
        objective: "ship it",
      });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "startSetup",
        payload: { objective: "ship it" },
      });
      expect(result).toEqual({ started: true, goalId: "g-1" });
    });

    it("goal.submitContract forwards contract to channel", async () => {
      const contract = {
        outcome: "ship it",
        criteria: ["Done"],
        phases: [{ title: "Build" }],
        verificationChecks: [{ id: "VC1", kind: "file_exists", label: "Readme", path: "README.md" }],
        authorities: [],
        constraints: [],
        nonGoals: [],
      };
      channelMocks.forwardToChannel.mockResolvedValueOnce({
        submitted: true,
        goalId: "g-1",
        status: "awaiting_approval",
      });
      const result = await callHandler(server, "goal.submitContract", {
        sessionId: "sess-1",
        contract,
      });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "submitContract",
        payload: contract,
      });
      expect(result).toEqual({ submitted: true, goalId: "g-1", status: "awaiting_approval" });
    });

    it("goal.approveContract forwards empty payload", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ approved: true });
      await callHandler(server, "goal.approveContract", { sessionId: "sess-1" });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "approveContract",
        payload: {},
      });
    });

    it("goal.approveAuthorityAmendment forwards empty payload", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ approved: true, count: 2 });
      const result = await callHandler(server, "goal.approveAuthorityAmendment", {
        sessionId: "sess-1",
      });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "approveAuthorityAmendment",
        payload: {},
      });
      expect(result).toEqual({ approved: true, count: 2 });
    });

    it("goal.rejectAuthorityAmendment forwards optional reason", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ rejected: true });
      const result = await callHandler(server, "goal.rejectAuthorityAmendment", {
        sessionId: "sess-1",
        reason: "not needed",
      });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "rejectAuthorityAmendment",
        payload: { reason: "not needed" },
      });
      expect(result).toEqual({ rejected: true });
    });

    it("goal.rejectContract forwards optional reason", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ rejected: true });
      await callHandler(server, "goal.rejectContract", { sessionId: "sess-1", reason: "bad" });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "rejectContract",
        payload: { reason: "bad" },
      });
    });

    it("goal.clearGoal forwards optional reason (undefined when omitted)", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ cleared: true });
      await callHandler(server, "goal.clearGoal", { sessionId: "sess-1" });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "clearGoal",
        payload: { reason: undefined },
      });
    });

    it("goal.forceContinue forwards optional reason", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ triggered: true });
      await callHandler(server, "goal.forceContinue", { sessionId: "sess-1", reason: "manual" });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "forceContinue",
        payload: { reason: "manual" },
      });
    });

    it("goal.disable routes to channel", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ disabled: true });
      await callHandler(server, "goal.disable", { sessionId: "sess-1" });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "disable",
        payload: {},
      });
    });

    it("goal.enable routes to channel", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ enabled: true });
      await callHandler(server, "goal.enable", { sessionId: "sess-1" });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "enable",
        payload: {},
      });
    });

    it("goal.getTaskReport routes to channel", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ tasks: [{ id: "t1" }] });
      await callHandler(server, "goal.getTaskReport", { sessionId: "sess-1" });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "getTaskReport",
        payload: {},
      });
    });

    it("goal.getTriggerHistory forwards optional limit", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ triggers: [] });
      await callHandler(server, "goal.getTriggerHistory", { sessionId: "sess-1", limit: 5 });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "getTriggerHistory",
        payload: { limit: 5 },
      });
    });

    it("goal.checkToolStatus forwards toolName / channelName / method", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({ reachable: true });
      await callHandler(server, "goal.checkToolStatus", {
        sessionId: "sess-1",
        toolName: "bash",
        channelName: "bash",
        method: "exec",
      });
      expect(lastForwardedCall()).toEqual({
        channel: "goal",
        method: "checkToolStatus",
        payload: { toolName: "bash", channelName: "bash", method: "exec" },
      });
    });
  });

  describe("fallback — channel failure returns safe defaults", () => {
    it("goal.getStatus returns disabledStatus when channel returns null", async () => {
      const result = await callHandler(server, "goal.getStatus", { sessionId: "sess-1" });
      expect(result).toMatchObject({ enabled: false, state: "disabled" });
    });

    it("goal.startSetup returns started:false + error on channel failure", async () => {
      const result = await callHandler(server, "goal.startSetup", {
        sessionId: "sess-1",
        objective: "x",
      });
      expect(result).toEqual({ started: false, error: "Channel call failed" });
    });

    it("goal.approveContract returns approved:false on channel failure", async () => {
      const result = await callHandler(server, "goal.approveContract", { sessionId: "sess-1" });
      expect(result).toEqual({ approved: false, error: "Channel call failed" });
    });

    it("goal.rejectContract returns rejected:false on channel failure", async () => {
      const result = await callHandler(server, "goal.rejectContract", { sessionId: "sess-1" });
      expect(result).toEqual({ rejected: false });
    });

    it("goal.clearGoal returns cleared:false on channel failure", async () => {
      const result = await callHandler(server, "goal.clearGoal", { sessionId: "sess-1" });
      expect(result).toEqual({ cleared: false });
    });

    it("goal.forceContinue returns triggered:false on channel failure", async () => {
      const result = await callHandler(server, "goal.forceContinue", { sessionId: "sess-1" });
      expect(result).toEqual({ triggered: false });
    });

    it("goal.disable returns disabled:false on channel failure", async () => {
      const result = await callHandler(server, "goal.disable", { sessionId: "sess-1" });
      expect(result).toEqual({ disabled: false });
    });

    it("goal.enable returns enabled:false on channel failure", async () => {
      const result = await callHandler(server, "goal.enable", { sessionId: "sess-1" });
      expect(result).toEqual({ enabled: false });
    });

    it("goal.getTaskReport returns empty tasks array on channel failure", async () => {
      const result = await callHandler(server, "goal.getTaskReport", { sessionId: "sess-1" });
      expect(result).toEqual({ tasks: [] });
    });

    it("goal.getTriggerHistory returns empty triggers array on channel failure", async () => {
      const result = await callHandler(server, "goal.getTriggerHistory", { sessionId: "sess-1" });
      expect(result).toEqual({ triggers: [] });
    });

    it("goal.checkToolStatus returns reachable:false on channel failure", async () => {
      const result = await callHandler(server, "goal.checkToolStatus", {
        sessionId: "sess-1",
        toolName: "bash",
      });
      expect(result).toMatchObject({ reachable: false });
    });
  });

  describe("refineGoal — channel forwarding path", () => {
    it("returns channel result on success", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce({
        success: true,
        objective: "new obj",
      });

      const result = await callHandler(server, "goal.refineGoal", {
        sessionId: "sess-1",
        objective: "new obj",
      });
      expect(channelMocks.forwardToChannel).toHaveBeenCalledWith(
        { sessionId: "sess-1" },
        "goal",
        "refineGoal",
        { objective: "new obj" },
        expect.any(Number),
        { skipHasSessionCheck: true },
      );
      expect(result).toEqual({ success: true, objective: "new obj" });
    });

    it("returns error result when channel returns null", async () => {
      channelMocks.forwardToChannel.mockResolvedValueOnce(null);

      const result = await callHandler(server, "goal.refineGoal", {
        sessionId: "sess-1",
        objective: "x",
      });
      expect(result).toMatchObject({ success: false });
      expect((result as { error: string }).error).toMatch(/channel call failed/i);
    });
  });
});
