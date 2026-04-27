import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./test/setup.ts"],
    testTimeout: 180000,
    hookTimeout: 30000,
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
