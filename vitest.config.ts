import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 180000,
    hookTimeout: 30000,
    include: ["test/**/*.test.{ts,tsx}"],
    exclude: ["**/rpc-client*", "**/session-ready*", "**/refresh-recovery-integration*"],
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
