import { test, expect } from "@playwright/test";

test.describe("Session Management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });
  });

  test("should show new session button", async ({ page }) => {
    const btn = page.locator('[data-testid="new-session-button"]');
    await expect(btn).toBeVisible();
  });

  test("should show tab bar", async ({ page }) => {
    const tabBar = page.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible();
  });
});
