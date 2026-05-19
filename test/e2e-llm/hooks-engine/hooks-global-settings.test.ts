/**
 * Group 2: Global Settings Hooks
 *
 * Verifies that hooks defined in ~/.claude/settings.json (global user settings)
 * are loaded and executed when tools are invoked.
 *
 * These tests do NOT depend on LLM directly — they verify hook execution
 * via command hook scripts that write to log files.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import {
  ensureHooksTestDir,
  clearLog,
  readLog,
  createTaggedHookScript,
  createProjectDir,
  writeGlobalSettings,
  setupHookTest,
  teardownHookTest,
  type HookTestContext,
  HOOK_BASE_PORT,
} from "./helpers";

const PORT = HOOK_BASE_PORT + 20;
const AUTH_TOKEN = "hooks-test-token-g2";

describe("Group 2: Global Settings Hooks", () => {
  let ctx: HookTestContext;
  let globalHookScript: string;
  let savedGlobalSettings: string | null = null;

  beforeAll(async () => {
    await ensureHooksTestDir();
    globalHookScript = await createTaggedHookScript("global");
    await clearLog();

    const projectDir = await createProjectDir("g2-global");

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

    ctx = await setupHookTest({
      port: PORT,
      authToken: AUTH_TOKEN,
      projectDir,
    });
  }, 40_000);

  afterAll(async () => {
    await teardownHookTest(ctx);

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

  it("G1: global hook fires on bash tool via PreToolUse", async () => {
    const { sendRPC: rpc, subscribe: sub, waitForEvent: wait } = await import("./helpers");

    await rpc(ctx.ws, "agent.start", {
      sessionId: ctx.sessionId,
      projectPath: ctx.projectDir,
      sessionPath: ctx.sessionPath,
    });

    sub(ctx.ws, "agent.event", { sessionId: ctx.sessionId });

    const agentEndPromise = wait(
      ctx.ws,
      "agent.event",
      (msg) => {
        const payload = msg.payload as Record<string, unknown>;
        const event = payload.event as Record<string, unknown>;
        return event?.type === "agent_end";
      },
      120_000,
    );

    await rpc(ctx.ws, "agent.send", {
      sessionId: ctx.sessionId,
      content: "Run: echo g1-test",
    });

    await agentEndPromise;
    await new Promise((r) => setTimeout(r, 2000));

    const log = await readLog();
    expect(log).toContain("GLOBAL-HOOK");
    expect(log).toContain("tool=bash");
  });

  it("G2: global hook fires on read tool", async () => {
    await clearLog();

    const { sendRPC: rpc, subscribe: sub, waitForEvent: wait } = await import("./helpers");

    await rpc(ctx.ws, "agent.start", {
      sessionId: ctx.sessionId,
      projectPath: ctx.projectDir,
      sessionPath: ctx.sessionPath,
    });

    sub(ctx.ws, "agent.event", { sessionId: ctx.sessionId });

    const agentEndPromise = wait(
      ctx.ws,
      "agent.event",
      (msg) => {
        const payload = msg.payload as Record<string, unknown>;
        const event = payload.event as Record<string, unknown>;
        return event?.type === "agent_end";
      },
      120_000,
    );

    await rpc(ctx.ws, "agent.send", {
      sessionId: ctx.sessionId,
      content: "Read the file README.md",
    });

    await agentEndPromise;
    await new Promise((r) => setTimeout(r, 2000));

    const log = await readLog();
    expect(log).toContain("GLOBAL-HOOK");
  });
});
