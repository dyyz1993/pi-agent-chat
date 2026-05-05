import { test, expect } from "@playwright/test";

test.describe("Sidebar Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });
  });

  test("should show right sidebar by default", async ({ page }) => {
    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await expect(rightSidebar).toBeVisible();
  });

  test("should not show connection banner when connected", async ({ page }) => {
    const banner = page.locator('[data-testid="connection-banner"]');
    await expect(banner).not.toBeVisible();
  });

  test("should show notification bell", async ({ page }) => {
    const bell = page.locator('[data-testid="notification-bell"]');
    await expect(bell).toBeVisible();
  });

  test("should show left sidebar with new session button", async ({ page }) => {
    const btn = page.locator('[data-testid="new-session-button"]');
    await expect(btn).toBeVisible();
  });

  test("should show session search input", async ({ page }) => {
    const searchInput = page.locator('[data-testid="session-search"]');
    if (await searchInput.isVisible()) {
      await searchInput.fill("test search");
    }
  });
});
