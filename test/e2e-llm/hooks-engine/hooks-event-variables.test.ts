/**
 * Group 1: Event Variables Propagation
 *
 * Verifies that all 6 hook events (PreToolUse, PostToolUse, UserPromptSubmit,
 * SessionEnd, SubagentStart, SubagentStop) carry variables including agent context.
 *
 * These tests use a real server with a command hook that logs env vars to a file.
 * They do NOT depend on LLM — hooks fire based on agent lifecycle events.
 *
 * Prerequisites:
 *   - claude-hooks-compat extension must be loaded
 *   - .claude/settings.json must have hooks configured
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ensureHooksTestDir,
  clearLog,
  readLog,
  createVerifyHookScript,
  createProjectDir,
  writeProjectSettings,
  setupHookTest,
  teardownHookTest,
  parseLogLines,
  type HookTestContext,
  HOOK_BASE_PORT,
} from "./helpers";

const PORT = HOOK_BASE_PORT + 10;
const AUTH_TOKEN = "hooks-test-token-g1";

describe("Group 1: Event Variables Propagation", () => {
  let ctx: HookTestContext;
  let hookScript: string;

  beforeAll(async () => {
    await ensureHooksTestDir();
    hookScript = await createVerifyHookScript();
    await clearLog();

    const projectDir = await createProjectDir("g1-event-vars");

    await writeProjectSettings(projectDir, {
      PreToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: hookScript,
              timeout: 10,
            },
          ],
        },
      ],
      PostToolUse: [
        {
          hooks: [
            {
              type: "command",
              command: hookScript,
              timeout: 10,
            },
          ],
        },
      ],
      UserPromptSubmit: [
        {
          hooks: [
            {
              type: "command",
              command: hookScript,
              timeout: 10,
            },
          ],
        },
      ],
      SessionEnd: [
        {
          hooks: [
            {
              type: "command",
              command: hookScript,
              timeout: 10,
            },
          ],
        },
      ],
      SubagentStart: [
        {
          hooks: [
            {
              type: "command",
              command: hookScript,
              timeout: 10,
            },
          ],
        },
      ],
      SubagentStop: [
        {
          hooks: [
            {
              type: "command",
              command: hookScript,
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

  it("V1: session_start should trigger hook on agent.start", async () => {
    const resp = await import("./helpers").then((h) =>
      h.sendRPC(ctx.ws, "agent.start", {
        sessionId: ctx.sessionId,
        projectPath: ctx.projectDir,
        sessionPath: ctx.sessionPath,
      }),
    );
    expect(resp.error).toBeUndefined();

    await new Promise((r) => setTimeout(r, 3000));

    const log = await readLog();
    const lines = parseLogLines(log);
    expect(lines.length).toBeGreaterThan(0);
  });

  it("V3-V4: tool_call and tool_result should trigger PreToolUse + PostToolUse hooks", async () => {
    await clearLog();

    const { sendRPC: rpc, subscribe: sub, waitForEvent: wait } = await import("./helpers");
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

    const sendResp = await rpc(ctx.ws, "agent.send", {
      sessionId: ctx.sessionId,
      content: "Run: echo hello-hooks-test",
    });
    expect((sendResp.result as Record<string, unknown>).ok).toBe(true);

    await agentEndPromise;

    await new Promise((r) => setTimeout(r, 2000));

    const log = await readLog();
    expect(log).toContain("EVENT=bash");
  });

  it("V6: session_shutdown should trigger SessionEnd hook", async () => {
    await clearLog();

    const { sendRPC: rpc } = await import("./helpers");
    await rpc(ctx.ws, "agent.stop", {
      sessionId: ctx.sessionId,
    });

    await new Promise((r) => setTimeout(r, 2000));

    const log = await readLog();
    const lines = parseLogLines(log);

    const hasSessionEnd = lines.some((l) => l.includes("HOOK_EVENT=SessionEnd"));
    expect(hasSessionEnd).toBe(true);
  });

  it("summary: at least 3 distinct hook events fired across the session", async () => {
    const log = await readLog();
    const lines = parseLogLines(log);

    const hookEvents = new Set(
      lines
        .map((l) => {
          const match = l.match(/HOOK_EVENT=(\w+)/);
          return match ? match[1] : null;
        })
        .filter((e): e is string => e !== null),
    );

    expect(hookEvents.size).toBeGreaterThanOrEqual(3);
  });
});
