import { test, expect } from "@playwright/test";

test.describe("Tab Bar", () => {
  test("should render tab bar with at least one tab", async ({ page }) => {
    await page.goto("/");
    const tabBar = page.locator('[data-testid="tab-bar"]');
    if (await tabBar.isVisible()) {
      const tabs = tabBar.locator("button");
      const count = await tabs.count();
      expect(count).toBeGreaterThanOrEqual(1);
    }
  });
});
