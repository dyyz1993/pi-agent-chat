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
  getHookPaths,
  type HookTestContext,
  HOOK_BASE_PORT,
} from "./helpers";

const PORT = HOOK_BASE_PORT + 10;
const AUTH_TOKEN = "hooks-test-token-g1";
const paths = getHookPaths("g1");

describe("Group 1: Event Variables Propagation", () => {
  let ctx: HookTestContext;
  let hookScript: string;

  beforeAll(async () => {
    await ensureHooksTestDir(paths);
    hookScript = await createVerifyHookScript(paths);
    await clearLog(paths);

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

  it("V1: start agent and verify hooks infrastructure", async () => {
    // Start the agent — this is required before agent.send can work.
    // session_start hooks are loaded during session creation (in setupHookTest),
    // so we don't assert log content here. V3-V4 will verify tool hooks.
    const resp = await import("./helpers").then((h) =>
      h.sendRPC(ctx.ws, "agent.start", {
        sessionId: ctx.sessionId,
        projectPath: ctx.projectDir,
        sessionPath: ctx.sessionPath,
      }),
    );
    expect(resp.error).toBeUndefined();

    // Wait for agent to initialize
    await new Promise((r) => setTimeout(r, 3000));
  });

  it("V3-V4: tool_call and tool_result should trigger PreToolUse + PostToolUse hooks", async () => {
    await clearLog(paths);

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

    const log = await readLog(paths);
    expect(log).toContain("EVENT=bash");
  });

  it("V6: session_shutdown should trigger SessionEnd hook", async () => {
    // Don't clearLog — let V3-V4 events accumulate so summary can check >= 3
    const { sendRPC: rpc } = await import("./helpers");
    await rpc(ctx.ws, "agent.stop", {
      sessionId: ctx.sessionId,
    });

    await new Promise((r) => setTimeout(r, 2000));

    const log = await readLog(paths);
    const lines = parseLogLines(log);

    const hasSessionEnd = lines.some((l) => l.includes("HOOK_EVENT=SessionEnd"));
    expect(hasSessionEnd).toBe(true);
  });

  it("summary: at least 3 distinct hook events fired across the session", async () => {
    const log = await readLog(paths);
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
