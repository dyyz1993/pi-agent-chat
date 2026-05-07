import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/screenshots',
  fullyParallel: true,
  retries: 0,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'on',
    viewport: { width: 393, height: 852 },
  },
  projects: [
    {
      name: 'mobile-chrome',
      use: {
        ...devices['Pixel 8'],
        screenshot: 'on',
      },
    },
    {
      name: 'mobile-safari',
      use: {
        ...devices['iPhone 15 Pro'],
        screenshot: 'on',
      },
    },
    {
      name: 'tablet',
      use: {
        ...devices['iPad Pro'],
        screenshot: 'on',
      },
    },
  ],
  webServer: {
    command: 'bun run hmr',
    port: 5173,
    reuseExistingServer: true,
  },
});
