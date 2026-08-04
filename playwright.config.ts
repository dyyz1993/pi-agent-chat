import { defineConfig, devices } from "@playwright/test";

const e2eHost = process.env.E2E_HOST ?? "127.0.0.1";
const appPort = process.env.E2E_APP_PORT ?? "5173";
const apiPort = process.env.E2E_API_PORT ?? "3100";
const authToken = process.env.E2E_AUTH_TOKEN ?? "test-ci-token";
const appBaseUrl = `http://${e2eHost}:${appPort}`;
const apiBaseUrl = `http://${e2eHost}:${apiPort}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 3 : undefined,
  reporter: process.env.CI ? "html" : "list",
  use: {
    baseURL: appBaseUrl,
    trace: "on-first-retry",
    headless: true,
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          executablePath:
            process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
        },
      },
    },
  ],
  webServer: [
    {
      command: `PORT=${apiPort} AUTH_TOKEN=${authToken} bun src/server.ts`,
      url: `${apiBaseUrl}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 15000,
      env: {
        PORT: apiPort,
        AUTH_TOKEN: authToken,
      },
    },
    {
      command: `VITE_API_TARGET=${apiBaseUrl} VITE_AUTH_TOKEN=${authToken} npx vite --host ${e2eHost} --port ${appPort} --strictPort`,
      url: appBaseUrl,
      reuseExistingServer: !process.env.CI,
      timeout: 30000,
    },
  ],
});
