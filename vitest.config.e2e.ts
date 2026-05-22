import { defineConfig } from "vitest/config";

/**
 * E2E test configuration — runs test files sequentially to avoid:
 * 1. Port conflicts (each test spawns a real server on a unique port)
 * 2. Shared ~/.claude/settings.json clobbering (global hooks)
 * 3. Resource contention (LLM API rate limits)
 */
export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 180000,
    hookTimeout: 45000,
    include: ["test/e2e-llm/**/*.test.ts"],
    fileParallelism: false,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
