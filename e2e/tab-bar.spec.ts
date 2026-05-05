import { test, expect } from "@playwright/test";

test.describe("Tab Bar", () => {
  test("should render tab bar", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });
    const tabBar = page.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible();
  });
});
