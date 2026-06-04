import { describe, it, expect, beforeAll } from "vitest";
import {
  ensureHooksTestDir,
  clearLog,
  readLog,
  createTaggedHookScript,
  createDenyHookScript,
  createProjectDir,
  writeGlobalSettings,
  writeProjectSettings,
  setupHookTest,
  teardownHookTest,
  parseLogLines,
  getHookPaths,
  HOOK_BASE_PORT,
} from "./helpers";

const PORT = HOOK_BASE_PORT + 40;
const AUTH_TOKEN = "hooks-test-token-g4";
const paths = getHookPaths("g4");

const shouldRun = process.env.PI_E2E_LLM === "1" && !!process.env.PI_CLI_PATH;

describe.skipIf(shouldRun === false)("Group 4: Multi-Level Hooks Merge", () => {
  let globalHookScript: string;
  let projectHookScript: string;

  beforeAll(async () => {
    await ensureHooksTestDir(paths);
    globalHookScript = await createTaggedHookScript("global", paths);
    projectHookScript = await createTaggedHookScript("project", paths);
    await createTaggedHookScript("agent", paths);
  });

  it("M1: execution order is GLOBAL → PROJECT → AGENT", async () => {
    await clearLog(paths);

    const projectDir = await createProjectDir("g4-m1");

    await writeProjectSettings(projectDir, {
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: projectHookScript,
              timeout: 10,
            },
          ],
        },
      ],
    });

    const testCtx = await setupHookTest({
      port: PORT,
      authToken: AUTH_TOKEN,
      projectDir,
    });

    const isolatedHome = testCtx.server.tmpDir + "/home";
    await writeGlobalSettings(
      {
        PreToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: globalHookScript,
                timeout: 10,
              },
            ],
          },
        ],
      },
      isolatedHome,
    );

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
        content: "Run: echo m1-test",
      });

      await agentEndPromise;
      await new Promise((r) => setTimeout(r, 2000));

      const log = await readLog(paths);
      const lines = parseLogLines(log);

      const globalIdx = lines.findIndex((l) => l.startsWith("GLOBAL-HOOK"));
      const projectIdx = lines.findIndex((l) => l.startsWith("PROJECT-HOOK"));

      expect(globalIdx).toBeGreaterThanOrEqual(0);
      expect(projectIdx).toBeGreaterThanOrEqual(0);
      expect(globalIdx).toBeLessThan(projectIdx);
    } finally {
      await teardownHookTest(testCtx);
    }
  }, 180_000);

  it("M2: global deny prevents project and agent hooks from running", async () => {
    await clearLog(paths);

    const projectDir = await createProjectDir("g4-m2");
    const denyScript = await createDenyHookScript(paths);

    await writeProjectSettings(projectDir, {
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: projectHookScript,
              timeout: 10,
            },
          ],
        },
      ],
    });

    const testCtx = await setupHookTest({
      port: PORT,
      authToken: AUTH_TOKEN,
      projectDir,
    });

    const isolatedHome = testCtx.server.tmpDir + "/home";
    await writeGlobalSettings(
      {
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
      },
      isolatedHome,
    );

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
        content: "Run: echo m2-test",
      });

      await agentEndPromise;
      await new Promise((r) => setTimeout(r, 2000));

      const log = await readLog(paths);
      expect(log).toContain("DENIED");
      expect(log).not.toContain("PROJECT-HOOK");
    } finally {
      await teardownHookTest(testCtx);
    }
  }, 180_000);

  it("M3: global allow + project deny prevents agent hooks", async () => {
    await clearLog(paths);

    const projectDir = await createProjectDir("g4-m3");
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
      port: PORT,
      authToken: AUTH_TOKEN,
      projectDir,
    });

    const isolatedHome = testCtx.server.tmpDir + "/home";
    await writeGlobalSettings(
      {
        PreToolUse: [
          {
            hooks: [
              {
                type: "command",
                command: globalHookScript,
                timeout: 10,
              },
            ],
          },
        ],
      },
      isolatedHome,
    );

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
        content: "Run: echo m3-test",
      });

      await agentEndPromise;
      await new Promise((r) => setTimeout(r, 2000));

      const log = await readLog(paths);
      expect(log).toContain("GLOBAL-HOOK");
      expect(log).toContain("DENIED");
    } finally {
      await teardownHookTest(testCtx);
    }
  }, 180_000);
});
