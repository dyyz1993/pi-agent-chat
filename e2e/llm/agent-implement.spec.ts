/**
 * L4 LLM: agent creates files (airplane game scenario).
 *
 * Similar to goal-complete but verifies the agent actually writes files
 * to the workspace during goal execution.
 */

import { test, expect } from "@playwright/test";
import { existsSync, readdirSync } from "node:fs";
import { ensureE2ESession, cleanupE2ESession, ensureE2EProject } from "../helpers/e2e-project";
import { RpcDriver } from "../helpers/rpc-driver";
import { SAMPLE_OBJECTIVE, buildSampleContract } from "../helpers/goal-fixtures";

const HAS_LLM_KEY = !!(
  process.env.ZAI_CODING_CN_API_KEY ||
  process.env.ZHIPUAI_API_KEY ||
  process.env.OPENAI_API_KEY
);

test.describe("L4 LLM · agent implement", () => {
  test.skip(!HAS_LLM_KEY, "requires LLM API key");

  test("agent creates at least one file during goal execution", async () => {
    test.setTimeout(600_000); // 10 min

    const driver = new RpcDriver();
    await driver.connect();

    const session = await ensureE2ESession(driver);
    try {
      const projectPath = await ensureE2EProject();
      const initialFiles = existsSync(projectPath) ? readdirSync(projectPath).length : 0;

      const contract = buildSampleContract(projectPath);
      await driver.driveGoalLifecycle(session.sessionId, SAMPLE_OBJECTIVE, contract);

      // Wait up to 5 minutes for agent to start creating files
      const start = Date.now();
      let fileCount = initialFiles;
      while (Date.now() - start < 300_000) {
        fileCount = existsSync(projectPath) ? readdirSync(projectPath).length : 0;
        if (fileCount > initialFiles) break;
        await new Promise((r) => setTimeout(r, 10_000));
      }

      expect(fileCount).toBeGreaterThan(initialFiles);
    } finally {
      await cleanupE2ESession(driver, session.sessionId);
      await driver.close();
    }
  });
});
