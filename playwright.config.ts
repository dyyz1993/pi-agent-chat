import { defineConfig, devices } from "@playwright/test";

const e2eHost = process.env.E2E_HOST ?? "127.0.0.1";
const appPort = process.env.E2E_APP_PORT ?? "5173";
const apiPort = process.env.E2E_API_PORT ?? "3100";
const authToken = process.env.E2E_AUTH_TOKEN ?? "test-ci-token";
const appBaseUrl = `http://${e2eHost}:${appPort}`;
const apiBaseUrl = `http://${e2eHost}:${apiPort}`;

// Local mac dev uses the system Chromium (playwright browser downloads are
// blocked on this network); PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH overrides, and
// CI/linux falls through to the playwright-managed chromium installed by the
// workflow's `playwright install --with-deps chromium` step.
const launchOptions: { executablePath?: string } = {};
if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
  launchOptions.executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
} else if (process.platform === "darwin") {
  launchOptions.executablePath = "/Applications/Chromium.app/Contents/MacOS/Chromium";
}

const webServer = [
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
];

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
    // L1 smoke: fast (<60s), every commit. Basic page load + UI shell.
    {
      name: "smoke",
      testMatch: /e2e\/smoke\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    // L2 goal flow: real RPC, ~45s. Goal lifecycle + UI sync.
    // Single worker — goal RPC calls collide if parallel.
    {
      name: "goal",
      testMatch: /e2e\/goal\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions },
      workers: 1,
      timeout: 120_000,
    },
    // L3 extensions: extension load smoke, ~12s. Each ext doesn't crash UI.
    {
      name: "extensions",
      testMatch: /e2e\/extensions\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    // L4 LLM: real model, ~10min. Skips without API key.
    {
      name: "llm",
      testMatch: /e2e\/llm\/.*\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions },
      workers: 1,
      timeout: 600_000,
    },
    // Legacy: existing root-level specs (app/input-bar/responsive/etc.)
    {
      name: "legacy",
      testMatch: /e2e\/[^/]+\.spec\.ts/,
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
  ],
  webServer,
});
