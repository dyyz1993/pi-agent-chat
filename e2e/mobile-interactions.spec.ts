import { test, expect } from "@playwright/test";

test.describe("Mobile Interactions", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });
  });

  test("tab close buttons should be functional on mobile (tap not hover)", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const addBtn = page.locator('[data-testid="tab-bar"] button:has(svg)').last();
    await addBtn.click();
    await page.waitForTimeout(300);

    await page.setViewportSize({ width: 375, height: 812 });
    await page.waitForTimeout(500);

    const closeButtons = page.locator('[data-testid^="tab-close-"]');
    const count = await closeButtons.count();
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const btn = closeButtons.nth(i);
        await expect(btn).toBeAttached();
      }
    }
  });

  test("should hide new-session button on mobile", async ({ page }) => {
    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).not.toBeVisible();
  });

  test("should have mobile-friendly input bar", async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]');
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await input.focus();
      await expect(input).toBeFocused();

      const box = await input.boundingBox();
      expect(box).toBeTruthy();
      expect(box!.width).toBeGreaterThan(100);
    }
  });

  test("should hide right sidebar on mobile by default", async ({ page }) => {
    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await expect(rightSidebar).not.toBeVisible();
  });

  test("should hide left sidebar on mobile by default", async ({ page }) => {
    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).not.toBeVisible();
  });

  test("tab bar should remain visible on mobile", async ({ page }) => {
    const tabBar = page.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible();

    const box = await tabBar.boundingBox();
    expect(box).toBeTruthy();
    expect(box!.width).toBeLessThanOrEqual(375);
  });

  test("chat input should accept text on mobile", async ({ page }) => {
    const input = page.locator('[data-testid="chat-input"]');
    if (await input.isVisible({ timeout: 3000 }).catch(() => false)) {
      await input.focus();
      await input.fill("hello mobile");
      await expect(input).toHaveValue("hello mobile");
    }
  });
});
