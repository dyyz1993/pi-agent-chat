import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 180000,
    hookTimeout: 45000,
    include: [
      "test/rpc-client.test.ts",
      "test/session-ready.test.ts",
      "test/getfullmessages-diagnostic.test.ts",
    ],
  },
});
