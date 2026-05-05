import { test, expect } from "@playwright/test";

test.describe("Responsive Layout", () => {
  test("should show mobile layout on small screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const tabBar = page.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible();

    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).not.toBeVisible();
  });

  test("should show desktop layout on large screen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).toBeVisible();

    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await expect(rightSidebar).toBeVisible();
  });

  test("should adapt sidebar visibility when resizing from desktop to mobile", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).toBeVisible();

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    await expect(newSessionBtn).not.toBeVisible();
  });

  test("should restore sidebar when resizing from mobile to desktop", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).not.toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);

    await expect(newSessionBtn).toBeVisible();
  });
});
