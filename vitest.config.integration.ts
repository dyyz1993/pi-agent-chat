import { defineConfig } from "vitest/config";

/**
 * 集成测试配置 — 跑需要真实服务器上下文但不属于 LLM E2E 的测试
 * 例如: session-ready (需要真实 session) / rpc-client (需要 dev server)
 */
export default defineConfig({
  test: {
    testTimeout: 180000,
    hookTimeout: 45000,
    include: [
      "test/integration/session/ready.test.ts",
      "test/integration/agent/refresh-recovery-integration.test.ts",
    ],
  },
});
