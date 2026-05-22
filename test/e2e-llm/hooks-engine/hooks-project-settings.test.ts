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

const PORT = HOOK_BASE_PORT + 30;
const AUTH_TOKEN = "hooks-test-token-g3";
const paths = getHookPaths("g3");

describe("Group 3: Project-Level Settings Hooks", () => {
  let globalHookScript: string;
  let projectHookScript: string;

  beforeAll(async () => {
    await ensureHooksTestDir(paths);
    globalHookScript = await createTaggedHookScript("global", paths);
    projectHookScript = await createTaggedHookScript("project", paths);
  });

  it("P1: execution order is GLOBAL then PROJECT", async () => {
    await clearLog(paths);

    const projectDir = await createProjectDir("g3-p1");

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
        content: "Run: echo p1-test",
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

  it("P3: global deny short-circuits before project hook", async () => {
    await clearLog(paths);

    const projectDir = await createProjectDir("g3-p3");
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
        content: "Run: echo p3-test",
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
});
