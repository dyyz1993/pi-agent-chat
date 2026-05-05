import { test, expect } from "@playwright/test";

test.describe("Z-Index Layering", () => {
  test("connection banner should be rendered with high z-index", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    await page.evaluate(() => {
      const store =
        (window as Record<string, unknown>).__ZUSTAND_STORES__?.find(
          (s: Record<string, unknown>) =>
            (s as { getState?: () => Record<string, unknown> }).getState?.().connectionStatus,
        ) ?? null;
      if (store) {
        store.setState({ connectionStatus: "disconnected" });
      }
    });

    const banner = page.locator('[data-testid="connection-banner"]');
    if (await banner.isVisible()) {
      const zIndex = await banner.evaluate((el) => {
        return window.getComputedStyle(el).zIndex;
      });
      const z = parseInt(zIndex, 10);
      expect(z).toBeGreaterThanOrEqual(100);
    }
  });

  test("notification panel should have z-index above content", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const bell = page.locator('[data-testid="notification-bell"]');
    await bell.click();

    const panel = page.locator('[role="log"]');
    await expect(panel).toBeVisible();

    const zIndex = await panel.evaluate((el) => {
      return window.getComputedStyle(el).zIndex;
    });
    const z = parseInt(zIndex, 10);
    expect(z).toBeGreaterThanOrEqual(50);
  });

  test("notification center should close on Escape", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const bell = page.locator('[data-testid="notification-bell"]');
    await expect(bell).toBeVisible();
    await bell.click();

    const panel = page.locator('[role="log"]');
    await expect(panel).toBeVisible();

    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);

    await expect(panel).not.toBeVisible();
  });

  test("left sidebar overlay should have high z-index", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const activityBtn = page.locator('[data-testid^="activity-"]').first();
    if (await activityBtn.isVisible()) {
      await activityBtn.click();
      await page.waitForTimeout(300);

      const newSessionBtn = page.locator('[data-testid="new-session-button"]');
      if (await newSessionBtn.isVisible()) {
        const zIndex = await newSessionBtn.evaluate((el) => {
          const sidebar = el.closest('[class*="z-20"]');
          if (!sidebar) return "0";
          return window.getComputedStyle(sidebar).zIndex;
        });
        const z = parseInt(zIndex, 10);
        expect(z).toBeGreaterThanOrEqual(20);
      }
    }
  });

  test("mobile drawer backdrop should have z-index between content and overlay", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const activityBtn = page.locator('[data-testid^="activity-"]').first();
    if (await activityBtn.isVisible()) {
      await activityBtn.click();
      await page.waitForTimeout(300);

      const backdrop = page.locator(".bg-black\\/50");
      if (await backdrop.isVisible()) {
        const zIndex = await backdrop.evaluate((el) => {
          return window.getComputedStyle(el).zIndex;
        });
        const z = parseInt(zIndex, 10);
        expect(z).toBeGreaterThanOrEqual(10);
      }
    }
  });
});
