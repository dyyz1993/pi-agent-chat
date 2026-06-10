import { defineConfig } from "vitest/config";

/**
 * E2E LLM 测试配置 — 跑需要真实 LLM API 的测试，顺序执行以避免:
 * 1. 端口冲突 (每个测试在独立端口启动真实服务器)
 * 2. 共享 ~/.claude/settings.json 互踩 (global hooks)
 * 3. 资源竞争 (LLM API 限流)
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
