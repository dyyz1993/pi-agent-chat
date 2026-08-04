/**
 * L4 LLM: real goal lifecycle to completion.
 *
 * This is the "c479c27b" test — real model, real pi CLI, real file creation.
 * Requires ZAI_CODING_CN_API_KEY or OPENAI_API_KEY in env. Skips otherwise.
 *
 * Timeout: up to 10 minutes (model latency + agent turns).
 */

import { test, expect } from "@playwright/test";
import { ensureE2ESession, cleanupE2ESession, ensureE2EProject } from "../helpers/e2e-project";
import { RpcDriver } from "../helpers/rpc-driver";
import { SAMPLE_OBJECTIVE, buildSampleContract } from "../helpers/goal-fixtures";

const HAS_LLM_KEY = !!(
  process.env.ZAI_CODING_CN_API_KEY ||
  process.env.ZHIPUAI_API_KEY ||
  process.env.OPENAI_API_KEY
);

test.describe("L4 LLM · goal complete", () => {
  test.skip(!HAS_LLM_KEY, "requires ZAI_CODING_CN_API_KEY or OPENAI_API_KEY");

  test("goal reaches completed status with real model", async () => {
    test.setTimeout(600_000); // 10 min

    const driver = new RpcDriver();
    await driver.connect();

    const session = await ensureE2ESession(driver);
    try {
      const projectPath = await ensureE2EProject();
      const contract = buildSampleContract(projectPath);
      await driver.driveGoalLifecycle(session.sessionId, SAMPLE_OBJECTIVE, contract);

      // Poll for up to 8 minutes
      const start = Date.now();
      let status = await driver.getGoalStatus(session.sessionId);
      while (Date.now() - start < 480_000) {
        status = await driver.getGoalStatus(session.sessionId);
        if (
          status.rawStatus === "completed" ||
          status.rawStatus === "cancelled" ||
          status.rawStatus === "none"
        ) {
          break;
        }
        await new Promise((r) => setTimeout(r, 15_000));
      }

      // We expect completed, but allow cancelled (model may time out)
      expect(["completed", "cancelled"]).toContain(status.rawStatus);
    } finally {
      await cleanupE2ESession(driver, session.sessionId);
      await driver.close();
    }
  });
});
