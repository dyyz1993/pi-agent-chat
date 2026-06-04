import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  ensureHooksTestDir,
  clearLog,
  readLog,
  createTaggedHookScript,
  createProjectDir,
  writeGlobalSettings,
  setupHookTest,
  teardownHookTest,
  getHookPaths,
  type HookTestContext,
  HOOK_BASE_PORT,
} from "./helpers";

const PORT = HOOK_BASE_PORT + 20;
const AUTH_TOKEN = "hooks-test-token-g2";
const paths = getHookPaths("g2");

const shouldRun = process.env.PI_E2E_LLM === "1" && !!process.env.PI_CLI_PATH;

describe.skipIf(shouldRun === false)("Group 2: Global Settings Hooks", () => {
  let ctx: HookTestContext;
  let globalHookScript: string;

  beforeAll(async () => {
    await ensureHooksTestDir(paths);
    globalHookScript = await createTaggedHookScript("global", paths);
    await clearLog(paths);

    const projectDir = await createProjectDir("g2-global");

    ctx = await setupHookTest({
      port: PORT,
      authToken: AUTH_TOKEN,
      projectDir,
    });

    const isolatedHome = ctx.server.tmpDir + "/home";
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
  }, 40_000);

  afterAll(async () => {
    await teardownHookTest(ctx);
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

    const log = await readLog(paths);
    expect(log).toContain("GLOBAL-HOOK");
    expect(log).toContain("tool=bash");
  });

  it("G2: global hook fires on read tool", async () => {
    await clearLog(paths);

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

    const log = await readLog(paths);
    expect(log).toContain("GLOBAL-HOOK");
  });
});
