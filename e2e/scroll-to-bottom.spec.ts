import { test, expect } from "@playwright/test";

test.describe("Scroll to Bottom", () => {
  test("should not show scroll-to-bottom button when at bottom", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]');

    await expect(page.locator('[data-testid="scroll-to-bottom-btn"]')).toBeHidden();
  });

  test("should show settings gear button", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]');

    await expect(page.locator('[data-testid="settings-open-btn"]')).toBeVisible();
  });
});
