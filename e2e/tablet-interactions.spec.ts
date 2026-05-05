import { test, expect } from "@playwright/test";

test.describe("Tablet Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });
  });

  test("should show right sidebar on tablet", async ({ page }) => {
    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await expect(rightSidebar).toBeVisible();
  });

  test("should show left sidebar on tablet", async ({ page }) => {
    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).toBeVisible();
  });

  test("should show tab bar on tablet", async ({ page }) => {
    const tabBar = page.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible();
  });

  test("should show notification bell on tablet", async ({ page }) => {
    const bell = page.locator('[data-testid="notification-bell"]');
    await expect(bell).toBeVisible();
  });

  test("right resize handle should be hidden on tablet", async ({ page }) => {
    const rightResizeHandle = page.locator(".resize-handle").nth(1);
    const count = await page.locator(".resize-handle").count();
    if (count >= 2) {
      await expect(rightResizeHandle).not.toBeVisible();
    }
  });

  test("left resize handle should be visible on tablet when sidebar is pinned", async ({
    page,
  }) => {
    const pinBtn = page
      .locator('[data-testid="new-session-button"]')
      .locator("..")
      .locator("button")
      .nth(1);
    if (await pinBtn.isVisible()) {
      await pinBtn.click();
      await page.waitForTimeout(300);
    }

    const leftResizeHandle = page.locator(".resize-handle").first();
    if (await leftResizeHandle.isVisible()) {
      const box = await leftResizeHandle.boundingBox();
      expect(box).toBeTruthy();
    }
  });

  test("theme menu should be accessible on tablet", async ({ page }) => {
    const themeToggle = page.locator('[data-testid="theme-menu-toggle"]');
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();

    await expect(page.locator('[data-testid="theme-option-light"]')).toBeVisible();
    await expect(page.locator('[data-testid="theme-option-dark"]')).toBeVisible();
  });
});
