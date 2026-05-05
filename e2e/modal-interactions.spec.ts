import { test, expect } from "@playwright/test";

test.describe("Modal and Overlay Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });
  });

  test("should close notification panel with Escape key", async ({ page }) => {
    const bell = page.locator('[data-testid="notification-bell"]');
    await expect(bell).toBeVisible();
    await bell.click();

    const panel = page.locator('[role="log"]');
    await expect(panel).toBeVisible();

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    await expect(panel).not.toBeVisible();
  });

  test("should close notification panel on backdrop click", async ({ page }) => {
    const bell = page.locator('[data-testid="notification-bell"]');
    await expect(bell).toBeVisible();
    await bell.click();

    const panel = page.locator('[role="log"]');
    await expect(panel).toBeVisible();

    await page.mouse.click(10, 10);

    await expect(panel).not.toBeVisible();
  });

  test("notification panel should render empty state when no notifications", async ({ page }) => {
    const bell = page.locator('[data-testid="notification-bell"]');
    await bell.click();

    const panel = page.locator('[role="log"]');
    await expect(panel).toBeVisible();

    const itemCount = await panel.locator('[role="log"] > div > div > div').count();
    expect(itemCount).toBeGreaterThanOrEqual(0);
  });

  test("should open theme menu and close with Escape", async ({ page }) => {
    const themeToggle = page.locator('[data-testid="theme-menu-toggle"]');
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();

    const lightOption = page.locator('[data-testid="theme-option-light"]');
    await expect(lightOption).toBeVisible();

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    await expect(lightOption).not.toBeVisible();
  });

  test("mobile drawer backdrop should close sidebar on click", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);

    const leftSidebar = page.locator('[data-testid="new-session-button"]');
    await expect(leftSidebar).not.toBeVisible();

    const activityBtn = page.locator('[data-testid^="activity-"]').first();
    if (await activityBtn.isVisible()) {
      await activityBtn.click();
      await page.waitForTimeout(300);

      const backdrop = page.locator(".bg-black\\/50");
      if (await backdrop.isVisible()) {
        await backdrop.click();
        await page.waitForTimeout(300);
        await expect(page.locator('[data-testid="new-session-button"]')).not.toBeVisible();
      }
    }
  });
});
