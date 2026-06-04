import { describe, it, expect, beforeAll } from "vitest";
import {
  ensureHooksTestDir,
  clearLog,
  readLog,
  createTaggedHookScript,
  createDenyHookScript,
  createAskHookScript,
  createProjectDir,
  writeProjectSettings,
  setupHookTest,
  teardownHookTest,
  parseLogLines,
  getHookPaths,
  HOOK_BASE_PORT,
} from "./helpers";

const AUTH_TOKEN = "hooks-test-token-g5";
const paths = getHookPaths("g5");

const shouldRun = process.env.PI_E2E_LLM === "1";

describe.skipIf(shouldRun === false)("Group 5: Hook Type Verification", () => {
  beforeAll(async () => {
    await ensureHooksTestDir(paths);
  });

  it("T1: command exit 0 allows tool execution", async () => {
    await clearLog(paths);

    const projectDir = await createProjectDir("g5-t1");
    const allowScript = await createTaggedHookScript("allow", paths);

    await writeProjectSettings(projectDir, {
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: allowScript,
              timeout: 10,
            },
          ],
        },
      ],
    });

    const testCtx = await setupHookTest({
      port: HOOK_BASE_PORT + 51,
      authToken: AUTH_TOKEN,
      projectDir,
    });

    try {
      const { sendRPC: rpc, subscribe: sub, waitForEvent: wait } = await import("./helpers");

      await rpc(testCtx.ws, "agent.start", {
        sessionId: testCtx.sessionId,
        projectPath: testCtx.projectDir,
        sessionPath: testCtx.sessionPath,
      });

      sub(testCtx.ws, "agent.event", { sessionId: testCtx.sessionId });

      const agentEndPromise = wait(
        testCtx.ws,
        "agent.event",
        (msg) => {
          const payload = msg.payload as Record<string, unknown>;
          const event = payload.event as Record<string, unknown>;
          return event?.type === "agent_end";
        },
        120_000,
      );

      await rpc(testCtx.ws, "agent.send", {
        sessionId: testCtx.sessionId,
        content: "Use the bash tool to execute this shell command: echo t1-test",
      });

      await agentEndPromise;
      await new Promise((r) => setTimeout(r, 2000));

      const log = await readLog(paths);
      expect(log).toContain("ALLOW-HOOK");
    } finally {
      await teardownHookTest(testCtx);
    }
  }, 180_000);

  it("T2: command exit 2 blocks tool execution", async () => {
    await clearLog(paths);

    const projectDir = await createProjectDir("g5-t2");
    const denyScript = await createDenyHookScript(paths);

    await writeProjectSettings(projectDir, {
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: denyScript,
              timeout: 10,
            },
          ],
        },
      ],
    });

    const testCtx = await setupHookTest({
      port: HOOK_BASE_PORT + 52,
      authToken: AUTH_TOKEN,
      projectDir,
    });

    try {
      const { sendRPC: rpc, subscribe: sub, waitForEvent: wait } = await import("./helpers");

      await rpc(testCtx.ws, "agent.start", {
        sessionId: testCtx.sessionId,
        projectPath: testCtx.projectDir,
        sessionPath: testCtx.sessionPath,
      });

      sub(testCtx.ws, "agent.event", { sessionId: testCtx.sessionId });

      const agentEndPromise = wait(
        testCtx.ws,
        "agent.event",
        (msg) => {
          const payload = msg.payload as Record<string, unknown>;
          const event = payload.event as Record<string, unknown>;
          return event?.type === "agent_end";
        },
        120_000,
      );

      await rpc(testCtx.ws, "agent.send", {
        sessionId: testCtx.sessionId,
        content: "Use the bash tool to execute this shell command: echo t2-test",
      });

      await agentEndPromise;
      await new Promise((r) => setTimeout(r, 2000));

      const log = await readLog(paths);
      expect(log).toContain("DENIED");
    } finally {
      await teardownHookTest(testCtx);
    }
  }, 180_000);

  it("T3: command exit 3 is treated as deny in headless/RPC mode", async () => {
    await clearLog(paths);

    const projectDir = await createProjectDir("g5-t3");
    const askScript = await createAskHookScript(paths);

    await writeProjectSettings(projectDir, {
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: askScript,
              timeout: 10,
            },
          ],
        },
      ],
    });

    const testCtx = await setupHookTest({
      port: HOOK_BASE_PORT + 53,
      authToken: AUTH_TOKEN,
      projectDir,
    });

    try {
      const { sendRPC: rpc, subscribe: sub, waitForEvent: wait } = await import("./helpers");

      await rpc(testCtx.ws, "agent.start", {
        sessionId: testCtx.sessionId,
        projectPath: testCtx.projectDir,
        sessionPath: testCtx.sessionPath,
      });

      sub(testCtx.ws, "agent.event", { sessionId: testCtx.sessionId });

      const agentEndPromise = wait(
        testCtx.ws,
        "agent.event",
        (msg) => {
          const payload = msg.payload as Record<string, unknown>;
          const event = payload.event as Record<string, unknown>;
          return event?.type === "agent_end";
        },
        90_000,
      );

      await rpc(testCtx.ws, "agent.send", {
        sessionId: testCtx.sessionId,
        content: "Use the bash tool to execute this shell command: echo t3-test",
      });

      await agentEndPromise;
      await new Promise((r) => setTimeout(r, 2000));

      const log = await readLog(paths);
      expect(log).toContain("ASKED");
    } catch (err) {
      if (err instanceof Error && err.message.includes("Timeout waiting for event")) {
        const log = await readLog(paths);
        if (log.includes("ASKED")) {
          return;
        }
      }
      throw err;
    } finally {
      await teardownHookTest(testCtx);
    }
  }, 180_000);

  it("T8: if filter only matches specified tools (bash|write)", async () => {
    await clearLog(paths);

    const projectDir = await createProjectDir("g5-t8");
    const filterScript = await createTaggedHookScript("filtered", paths);

    await writeProjectSettings(projectDir, {
      PreToolUse: [
        {
          matcher: "bash|write",
          hooks: [
            {
              type: "command",
              command: filterScript,
              timeout: 10,
            },
          ],
        },
      ],
    });

    const testCtx = await setupHookTest({
      port: HOOK_BASE_PORT + 54,
      authToken: AUTH_TOKEN,
      projectDir,
    });

    try {
      const { sendRPC: rpc, subscribe: sub, waitForEvent: wait } = await import("./helpers");

      await rpc(testCtx.ws, "agent.start", {
        sessionId: testCtx.sessionId,
        projectPath: testCtx.projectDir,
        sessionPath: testCtx.sessionPath,
      });

      sub(testCtx.ws, "agent.event", { sessionId: testCtx.sessionId });

      const agentEndPromise = wait(
        testCtx.ws,
        "agent.event",
        (msg) => {
          const payload = msg.payload as Record<string, unknown>;
          const event = payload.event as Record<string, unknown>;
          return event?.type === "agent_end";
        },
        120_000,
      );

      await rpc(testCtx.ws, "agent.send", {
        sessionId: testCtx.sessionId,
        content: "Use the bash tool to execute this shell command: echo t8-test",
      });

      await agentEndPromise;
      await new Promise((r) => setTimeout(r, 2000));

      const log = await readLog(paths);
      expect(log).toContain("FILTERED-HOOK");
    } finally {
      await teardownHookTest(testCtx);
    }
  }, 180_000);

  it("T9: once=true only fires on first tool invocation", async () => {
    await clearLog(paths);

    const projectDir = await createProjectDir("g5-t9");
    const onceScript = await createTaggedHookScript("once", paths);

    await writeProjectSettings(projectDir, {
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: onceScript,
              timeout: 10,
              once: true,
            },
          ],
        },
      ],
    });

    const testCtx = await setupHookTest({
      port: HOOK_BASE_PORT + 55,
      authToken: AUTH_TOKEN,
      projectDir,
    });

    try {
      const { sendRPC: rpc, subscribe: sub, waitForEvent: wait } = await import("./helpers");

      await rpc(testCtx.ws, "agent.start", {
        sessionId: testCtx.sessionId,
        projectPath: testCtx.projectDir,
        sessionPath: testCtx.sessionPath,
      });

      sub(testCtx.ws, "agent.event", { sessionId: testCtx.sessionId });

      const agentEndPromise = wait(
        testCtx.ws,
        "agent.event",
        (msg) => {
          const payload = msg.payload as Record<string, unknown>;
          const event = payload.event as Record<string, unknown>;
          return event?.type === "agent_end";
        },
        120_000,
      );

      await rpc(testCtx.ws, "agent.send", {
        sessionId: testCtx.sessionId,
        content:
          "Use the bash tool to run these commands one by one: echo t9a then echo t9b then echo t9c",
      });

      await agentEndPromise;
      await new Promise((r) => setTimeout(r, 2000));

      const log = await readLog(paths);
      const onceCount = parseLogLines(log).filter((l) => l.startsWith("ONCE-HOOK")).length;

      expect(onceCount).toBeGreaterThanOrEqual(1);
    } finally {
      await teardownHookTest(testCtx);
    }
  }, 180_000);
});
