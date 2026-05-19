/**
 * Group 3: Project-Level Settings Hooks
 *
 * Verifies that hooks in <project>/.claude/settings.json are loaded
 * and merged with global hooks (global first, then project appended).
 *
 * Key cases:
 * - P1: Execution order is GLOBAL → PROJECT
 * - P2: Project deny blocks tool (project hook runs after global allow)
 * - P3: Global deny short-circuits before project hook runs
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
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
  HOOK_BASE_PORT,
} from "./helpers";

const PORT = HOOK_BASE_PORT + 30;
const AUTH_TOKEN = "hooks-test-token-g3";

describe("Group 3: Project-Level Settings Hooks", () => {
  let globalHookScript: string;
  let projectHookScript: string;
  let savedGlobalSettings: string | null = null;

  beforeAll(async () => {
    await ensureHooksTestDir();
    globalHookScript = await createTaggedHookScript("global");
    projectHookScript = await createTaggedHookScript("project");
  });

  afterAll(async () => {
    const homeDir = process.env.HOME ?? "";
    const globalSettingsPath = join(homeDir, ".claude", "settings.json");

    if (savedGlobalSettings !== null) {
      writeFileSync(globalSettingsPath, savedGlobalSettings);
    } else if (existsSync(globalSettingsPath)) {
      try {
        unlinkSync(globalSettingsPath);
      } catch {
        // ignore
      }
    }
  }, 15_000);

  it("P1: execution order is GLOBAL then PROJECT", async () => {
    await clearLog();

    const projectDir = await createProjectDir("g3-p1");

    const homeDir = process.env.HOME ?? "";
    const globalSettingsPath = join(homeDir, ".claude", "settings.json");
    if (existsSync(globalSettingsPath)) {
      savedGlobalSettings = readFileSync(globalSettingsPath, "utf-8");
    }

    await writeGlobalSettings({
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
    });

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

      const log = await readLog();
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
    await clearLog();

    const projectDir = await createProjectDir("g3-p3");
    const denyScript = await createDenyHookScript();

    await writeGlobalSettings({
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

      const log = await readLog();
      expect(log).toContain("DENIED");
      expect(log).not.toContain("PROJECT-HOOK");
    } finally {
      await teardownHookTest(testCtx);
    }
  }, 180_000);
});
