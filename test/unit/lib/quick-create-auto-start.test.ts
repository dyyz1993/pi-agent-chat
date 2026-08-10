import { describe, expect, it, vi } from "vitest";
import {
  buildQuickCreateGoalContract,
  buildQuickCreateGoalObjective,
  runQuickCreateAutoStart,
} from "../../../src/mainview/lib/quick-create-auto-start";

describe("quick create auto start", () => {
  it("builds a goal objective from generated plan details", () => {
    const objective = buildQuickCreateGoalObjective("tetris-game", {
      requirement: "做一个俄罗斯方块游戏",
      description: "一个浏览器里的俄罗斯方块小游戏。",
      plan: {
        goal: "完成一个可玩的俄罗斯方块。",
        techStack: ["React", "Vitest"],
        steps: ["实现方块下落", "实现消行计分"],
        testing: "运行单元测试并手动玩一局。",
      },
    });

    expect(objective).toContain("不需要再次询问我是否确认目标");
    expect(objective).toContain("项目名：tetris-game");
    expect(objective).toContain("完成一个可玩的俄罗斯方块。");
    expect(objective).toContain("原始需求：");
    expect(objective).toContain("做一个俄罗斯方块游戏");
    expect(objective).toContain("React, Vitest");
    expect(objective).toContain("1. 实现方块下落");
    expect(objective).toContain("不要把它写进 Goal 合同");
    expect(objective).toContain("validation packet");
    expect(objective).toContain("git status --short");
    expect(objective).toContain("避免 `cd ... && ...`");
  });

  it("creates a session, sends the objective, and retries goal setup until ready", async () => {
    const createNewSession = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const setInputText = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const startSetup = vi
      .fn()
      .mockResolvedValueOnce({ started: false, error: "channel not ready" })
      .mockResolvedValueOnce({ started: true });
    const addLog = vi.fn();
    const waitMs = vi.fn().mockResolvedValue(undefined);

    const result = await runQuickCreateAutoStart(
      "/tmp/tetris-game",
      "tetris-game",
      {
        requirement: "做一个俄罗斯方块游戏",
        plan: null,
      },
      {
        createNewSession,
        setInputText,
        sendMessage,
        startSetup,
        addLog,
      },
      { waitMs },
    );

    expect(result).toEqual({ sessionId: "session-1", goalStarted: true });
    expect(createNewSession).toHaveBeenCalledWith("/tmp/tetris-game");
    expect(setInputText).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("做一个俄罗斯方块游戏"),
    );
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(setInputText).toHaveBeenLastCalledWith("");
    expect(startSetup).toHaveBeenCalledTimes(2);
    expect(startSetup).toHaveBeenLastCalledWith(
      "session-1",
      expect.stringContaining("做一个俄罗斯方块游戏"),
      expect.anything(),
    );
    expect(addLog).toHaveBeenCalledWith("Quick create goal started: tetris-game");
  });

  it("builds a conservative deterministic contract for web quick-create projects", () => {
    const contract = buildQuickCreateGoalContract("/tmp/tetris-game", "tetris-game", {
      requirement: "做一个无需安装依赖的俄罗斯方块单页游戏",
      plan: null,
    });

    expect(contract.workspaceRoots).toEqual(["/tmp/tetris-game"]);
    expect(contract.criteria[0]).toContain("俄罗斯方块");
    expect(contract.verificationChecks).toContainEqual({
      id: "VC2",
      kind: "file_exists",
      label: "Quick-create delivery protocol exists",
      path: "/tmp/tetris-game/QUICK_CREATE_DELIVERY.md",
    });
    expect(contract.verificationChecks).toContainEqual({
      id: "VC4",
      kind: "command_exit",
      label: "Zero-dependency automated tests pass",
      executable: "node",
      args: ["test/runner.mjs"],
      cwd: "/tmp/tetris-game",
      expectedExitCode: 0,
      timeoutMs: 30000,
    });
    expect(contract.authorities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "AUTH_NODE_TEST",
          actionClass: "local_process",
          command: { executable: "node", argsPrefix: ["test/runner.mjs"], trailingArgs: "none" },
        }),
        expect.objectContaining({
          id: "AUTH_NODE_CHECK",
          actionClass: "local_process",
          command: { executable: "node", argsPrefix: ["--check"], trailingArgs: "workspace_paths" },
        }),
        expect.objectContaining({
          id: "AUTH_NODE_PREVIEW_SERVER",
          actionClass: "local_process",
          command: { executable: "node", argsPrefix: ["scripts/preview-server.mjs"], trailingArgs: "none" },
        }),
      ]),
    );
    expect(JSON.stringify(contract.phases)).not.toMatch(/npm install|pnpm add|yarn add/);
    expect(JSON.stringify(contract.verificationChecks)).not.toMatch(/npm install|pnpm add|yarn add/);
  });

  it("submits and approves a deterministic contract before sending any normal agent message", async () => {
    const createNewSession = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      sessionPath: "/tmp/session.jsonl",
    });
    const startAgent = vi.fn().mockResolvedValue({ status: "started" });
    const setInputText = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const startSetup = vi.fn().mockResolvedValue({ started: true });
    const submitContract = vi.fn().mockResolvedValue({
      submitted: true,
      goalId: "goal-1",
      status: "awaiting_approval",
    });
    const approveContract = vi.fn().mockResolvedValue({ approved: true });
    const addLog = vi.fn();
    const waitMs = vi.fn().mockResolvedValue(undefined);

    const result = await runQuickCreateAutoStart(
      "/tmp/tetris-game",
      "tetris-game",
      {
        requirement: "做一个俄罗斯方块游戏",
        plan: null,
      },
      {
        createNewSession,
        startAgent,
        setInputText,
        sendMessage,
        startSetup,
        submitContract,
        approveContract,
        addLog,
      },
      { waitMs },
    );

    expect(result).toEqual({ sessionId: "session-1", goalStarted: true });
    expect(startAgent).toHaveBeenCalledWith("session-1", "/tmp/tetris-game", "/tmp/session.jsonl");
    expect(submitContract).toHaveBeenCalledWith(
      "session-1",
      expect.objectContaining({ outcome: expect.stringContaining("做一个俄罗斯方块游戏") }),
      expect.anything(),
    );
    expect(approveContract).toHaveBeenCalledWith("session-1", expect.anything());
    expect(sendMessage).not.toHaveBeenCalled();
    expect(startSetup).not.toHaveBeenCalled();
    expect(setInputText).not.toHaveBeenCalled();
  });

  it("auto-approves the generated goal contract when quick create starts", async () => {
    const createNewSession = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const setInputText = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const startSetup = vi.fn().mockResolvedValue({ started: true });
    const fetchGoalStatus = vi
      .fn()
      .mockResolvedValueOnce({
        state: "setup",
        rawStatus: "setting_up",
        rawPhase: "setup",
        enabled: true,
        continuationSequence: 0,
        turnCount: 0,
      })
      .mockResolvedValueOnce({
        state: "setup",
        rawStatus: "awaiting_approval",
        rawPhase: "setup",
        enabled: true,
        continuationSequence: 0,
        turnCount: 0,
      });
    const approveContract = vi.fn().mockResolvedValue({ approved: true });
    const addLog = vi.fn();
    const waitMs = vi.fn().mockResolvedValue(undefined);

    const result = await runQuickCreateAutoStart(
      "/tmp/tetris-game",
      "tetris-game",
      {
        requirement: "做一个俄罗斯方块游戏",
        plan: null,
      },
      {
        createNewSession,
        setInputText,
        sendMessage,
        startSetup,
        fetchGoalStatus,
        approveContract,
        addLog,
      },
      { waitMs },
    );

    expect(result).toEqual({ sessionId: "session-1", goalStarted: true });
    expect(fetchGoalStatus).toHaveBeenCalledTimes(2);
    expect(approveContract).toHaveBeenCalledWith("session-1", expect.anything());
    expect(addLog).toHaveBeenCalledWith("Quick create goal contract approved: tetris-game");
  });

  it("caps contract polling at 30 attempts when status never reaches awaiting_approval", async () => {
    const createNewSession = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const setInputText = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const startSetup = vi.fn().mockResolvedValue({ started: true });
    const fetchGoalStatus = vi.fn().mockResolvedValue({
      state: "setup",
      rawStatus: "setting_up",
      rawPhase: "setup",
      enabled: true,
      continuationSequence: 0,
      turnCount: 0,
    });
    const approveContract = vi.fn().mockResolvedValue({ approved: true });
    const addLog = vi.fn();
    const waitMs = vi.fn().mockResolvedValue(undefined);

    const result = await runQuickCreateAutoStart(
      "/tmp/tetris-game",
      "tetris-game",
      { requirement: "做一个俄罗斯方块游戏", plan: null },
      {
        createNewSession,
        setInputText,
        sendMessage,
        startSetup,
        fetchGoalStatus,
        approveContract,
        addLog,
      },
      { waitMs },
    );

    expect(result.goalStarted).toBe(false);
    expect(result.error).toMatch(/did not become ready|not ready/i);
    expect(fetchGoalStatus.mock.calls.length).toBeLessThanOrEqual(30);
    expect(approveContract).not.toHaveBeenCalled();
  });

  it("aborts polling immediately when signal is already aborted", async () => {
    const createNewSession = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const setInputText = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const startSetup = vi.fn().mockResolvedValue({ started: true });
    const fetchGoalStatus = vi.fn();
    const approveContract = vi.fn();
    const addLog = vi.fn();
    const waitMs = vi.fn().mockResolvedValue(undefined);
    const controller = new AbortController();
    controller.abort();

    const result = await runQuickCreateAutoStart(
      "/tmp/tetris-game",
      "tetris-game",
      { requirement: "做一个俄罗斯方块游戏", plan: null },
      {
        createNewSession,
        setInputText,
        sendMessage,
        startSetup,
        fetchGoalStatus,
        approveContract,
        addLog,
      },
      { waitMs, signal: controller.signal },
    );

    expect(result.goalStarted).toBe(false);
    expect(result.error).toMatch(/cancel/i);
    expect(fetchGoalStatus).not.toHaveBeenCalled();
    expect(approveContract).not.toHaveBeenCalled();
  });

  it("aborts mid-polling when signal fires after a few attempts", async () => {
    const createNewSession = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const setInputText = vi.fn();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    const startSetup = vi.fn().mockResolvedValue({ started: true });
    const controller = new AbortController();
    const fetchGoalStatus = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.resolve({
        state: "setup",
        rawStatus: "setting_up",
        rawPhase: "setup",
        enabled: true,
        continuationSequence: 0,
        turnCount: 0,
      });
    });
    const approveContract = vi.fn();
    const addLog = vi.fn();
    const waitMs = vi.fn().mockResolvedValue(undefined);

    const result = await runQuickCreateAutoStart(
      "/tmp/tetris-game",
      "tetris-game",
      { requirement: "做一个俄罗斯方块游戏", plan: null },
      {
        createNewSession,
        setInputText,
        sendMessage,
        startSetup,
        fetchGoalStatus,
        approveContract,
        addLog,
      },
      { waitMs, signal: controller.signal },
    );

    expect(result.goalStarted).toBe(false);
    expect(result.error).toMatch(/cancel/i);
    expect(fetchGoalStatus.mock.calls.length).toBeLessThanOrEqual(2);
    expect(approveContract).not.toHaveBeenCalled();
  });

  it("aborts between submitContract and approveContract on the startAgent path", async () => {
    const createNewSession = vi.fn().mockResolvedValue({
      sessionId: "session-1",
      sessionPath: "/tmp/session.jsonl",
    });
    const startAgent = vi.fn().mockResolvedValue({ status: "started" });
    const controller = new AbortController();
    const submitContract = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ submitted: true, goalId: "goal-1", status: "awaiting_approval" });
    });
    const approveContract = vi.fn();
    const setInputText = vi.fn();
    const sendMessage = vi.fn();
    const startSetup = vi.fn();
    const addLog = vi.fn();
    const waitMs = vi.fn().mockResolvedValue(undefined);

    const result = await runQuickCreateAutoStart(
      "/tmp/tetris-game",
      "tetris-game",
      { requirement: "做一个俄罗斯方块游戏", plan: null },
      {
        createNewSession,
        startAgent,
        setInputText,
        sendMessage,
        startSetup,
        submitContract,
        approveContract,
        addLog,
      },
      { waitMs, signal: controller.signal },
    );

    expect(result.goalStarted).toBe(false);
    expect(result.error).toMatch(/cancel/i);
    expect(approveContract).not.toHaveBeenCalled();
  });
});
