import { defineConfig } from "vitest/config";

/**
 * 默认测试配置 — 覆盖 test/unit/**, test/integration/**, test/regression/**, test/smoke/**
 * 排除 test/e2e-llm/** (由 vitest.config.e2e.ts 单独处理)
 * 排除 rpc-client / session-ready / refresh-recovery-integration 等需要在真实服务器上跑的测试
 */
export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 180000,
    hookTimeout: 30000,
    include: [
      "test/unit/**/*.test.{ts,tsx}",
      "test/integration/**/*.test.{ts,tsx}",
      "test/regression/**/*.test.{ts,tsx}",
      "test/smoke/**/*.test.{ts,tsx}",
    ],
    exclude: [
      "**/e2e-llm/**",
      "**/node_modules/**",
      "**/rpc-client*",
      "**/session-ready*",
      "**/refresh-recovery-integration*",
    ],
    coverage: {
      provider: "v8",
      reporter: ["html", "text-summary"],
      reportsDirectory: "./coverage",
      include: [
        "src/mainview/lib/proxy.ts",
        "src/gateway/proxy-register.ts",
        "src/gateway/http-routes.ts",
        "src/mainview/lib/api-client.ts",
      ],
    },
  },
});
