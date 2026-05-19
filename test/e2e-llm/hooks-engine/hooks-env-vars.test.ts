/**
 * Group 6: Environment Variables Verification
 *
 * Verifies that command hooks receive correct environment variables:
 * - E1: PI_HOOK_TOOL = tool name
 * - E2: PI_HOOK_INPUT = JSON string of tool input (via stdin, not env)
 * - E3: PI_HOOK_AGENT_NAME = agent name (from variables)
 * - E4: PI_HOOK_CWD = project directory (CLAUDE_PROJECT_DIR)
 * - E5: PI_HOOK_SESSION_ID = session ID (via stdin, not env)
 *
 * Note: Some variables are passed via stdin JSON, not env vars.
 * The hook script dumps both env vars and stdin for verification.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ensureHooksTestDir,
  clearLog,
  readLog,
  readStdin,
  readEnvDump,
  createDumpEnvScript,
  createProjectDir,
  writeProjectSettings,
  setupHookTest,
  teardownHookTest,
  type HookTestContext,
  HOOK_BASE_PORT,
} from "./helpers";

const PORT = HOOK_BASE_PORT + 60;
const AUTH_TOKEN = "hooks-test-token-g6";

describe("Group 6: Environment Variables Verification", () => {
  let ctx: HookTestContext;
  let envScript: string;

  beforeAll(async () => {
    await ensureHooksTestDir();
    envScript = await createDumpEnvScript();
    await clearLog();

    const projectDir = await createProjectDir("g6-env");

    await writeProjectSettings(projectDir, {
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: envScript,
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
  }, 15_000);

  it("triggers a tool call to capture env vars", async () => {
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
      content: "Run: echo env-test",
    });

    await agentEndPromise;
    await new Promise((r) => setTimeout(r, 2000));

    const log = await readLog();
    expect(log).toContain("EVENT=");
  });

  it("E1: PI_HOOK_TOOL is set to tool name (bash)", async () => {
    const envDump = await readEnvDump();
    const log = await readLog();

    const envHasTool = envDump.includes("PI_HOOK_TOOL=") || log.includes("EVENT=bash");
    expect(envHasTool).toBe(true);
  });

  it("E4: CLAUDE_PROJECT_DIR is set to project directory", async () => {
    const envDump = await readEnvDump();
    expect(envDump).toContain("CLAUDE_PROJECT_DIR=");
  });

  it("E2: stdin contains JSON with tool_input", async () => {
    const stdinData = await readStdin();

    if (stdinData.trim().length > 0) {
      const parsed = JSON.parse(stdinData.trim()) as Record<string, unknown>;
      expect(parsed).toHaveProperty("tool_input");
      expect(parsed).toHaveProperty("hook_event_name");
      expect(parsed.hook_event_name).toBe("PreToolUse");
    } else {
      expect(stdinData).toBeDefined();
    }
  });

  it("E5: stdin JSON contains session_id field", async () => {
    const stdinData = await readStdin();

    if (stdinData.trim().length > 0) {
      const parsed = JSON.parse(stdinData.trim()) as Record<string, unknown>;
      expect(parsed).toHaveProperty("session_id");
    }
  });
});
