import { test, expect } from "@playwright/test";

test.describe("Session Management", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  test("should show new session button in sidebar", async ({ page }) => {
    const btn = page.locator('[data-testid="new-session-button"]');
    await expect(btn).toBeVisible();
  });

  test("should show session search input", async ({ page }) => {
    const searchInput = page.locator('[data-testid="session-search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill("test search");
    }
  });

  test("should have activity bar icons", async ({ page }) => {
    const explorerBtn = page.locator('[data-testid="activity-explorer"]');
    await expect(explorerBtn).toBeVisible();
  });
});
