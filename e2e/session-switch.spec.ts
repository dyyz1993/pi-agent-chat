import { test, expect } from "@playwright/test";

test.describe("Session Switch Basic", () => {
  test("should show session sidebar after loading", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]');

    await expect(page.locator('[data-testid="new-session-button"]')).toBeAttached();
  });

  test("should show chat input area", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]');

    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible();
  });
});
