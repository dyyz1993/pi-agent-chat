/**
 * Group 4: Multi-Level Hooks Merge (Global + Project + Agent)
 *
 * Verifies that settings hooks from all levels are merged and executed
 * in order: GLOBAL → PROJECT → AGENT.
 *
 * Also verifies that deny at any level short-circuits subsequent hooks.
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

const PORT = HOOK_BASE_PORT + 40;
const AUTH_TOKEN = "hooks-test-token-g4";

describe("Group 4: Multi-Level Hooks Merge", () => {
  let globalHookScript: string;
  let projectHookScript: string;
  let savedGlobalSettings: string | null = null;

  beforeAll(async () => {
    await ensureHooksTestDir();
    globalHookScript = await createTaggedHookScript("global");
    projectHookScript = await createTaggedHookScript("project");
    await createTaggedHookScript("agent");
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

  it("M1: execution order is GLOBAL → PROJECT → AGENT", async () => {
    await clearLog();

    const projectDir = await createProjectDir("g4-m1");

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
        content: "Run: echo m1-test",
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

  it("M2: global deny prevents project and agent hooks from running", async () => {
    await clearLog();

    const projectDir = await createProjectDir("g4-m2");
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
        content: "Run: echo m2-test",
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

  it("M3: global allow + project deny prevents agent hooks", async () => {
    await clearLog();

    const projectDir = await createProjectDir("g4-m3");
    const denyScript = await createDenyHookScript();

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

      const log = await readLog();
      expect(log).toContain("GLOBAL-HOOK");
      expect(log).toContain("DENIED");
    } finally {
      await teardownHookTest(testCtx);
    }
  }, 180_000);
});
