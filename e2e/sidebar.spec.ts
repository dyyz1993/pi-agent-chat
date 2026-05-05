import { test, expect } from "@playwright/test";

test.describe("Sidebar Interactions", () => {
  test("should toggle right sidebar panels", async ({ page }) => {
    await page.goto("/");
    const explorerBtn = page.locator('[data-testid="activity-explorer"]');
    await explorerBtn.click();
    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await expect(rightSidebar).toBeVisible();
  });

  test("should show connection status indicator", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator('[data-testid="connection-banner"]');
    await expect(banner).not.toBeVisible();
  });

  test("should show notification bell", async ({ page }) => {
    await page.goto("/");
    const bell = page.locator('[data-testid="notification-bell"]');
    await expect(bell).toBeVisible();
  });
});
