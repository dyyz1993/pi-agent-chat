import { test, expect } from "@playwright/test";

test.describe("Retry Config Panel", () => {
  const openSettings = async (page: import("@playwright/test").Page) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]');
    await page.click('[data-testid="settings-open-btn"]');
    await expect(page.locator('[data-testid="settings-panel"]')).toBeVisible();
  };

  test("should open settings panel and show retry section", async ({ page }) => {
    await openSettings(page);
    await expect(page.locator('[data-testid="retry-section"]')).toBeVisible();
  });

  test("should show retry toggle checked by default", async ({ page }) => {
    await openSettings(page);
    await expect(page.locator('[data-testid="retry-enabled-toggle"]')).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("should toggle retry enabled", async ({ page }) => {
    await openSettings(page);
    const toggle = page.locator('[data-testid="retry-enabled-toggle"]');

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "false");

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
  });

  test("should change max retries via select", async ({ page }) => {
    await openSettings(page);
    const select = page.locator('[data-testid="retry-max-retries-select"]');

    await select.selectOption("10");
    await expect(select).toHaveValue("10");
  });

  test("should show backoff preview when enabled", async ({ page }) => {
    await openSettings(page);
    const preview = page.locator('[data-testid="retry-backoff-preview"]');

    await expect(preview).toBeVisible();
    await expect(preview).toContainText(/#\d+:/);
  });

  test("should hide backoff preview when disabled", async ({ page }) => {
    await openSettings(page);
    const toggle = page.locator('[data-testid="retry-enabled-toggle"]');

    await toggle.click();
    await expect(page.locator('[data-testid="retry-backoff-preview"]')).toBeHidden();
  });

  test("should close settings panel", async ({ page }) => {
    await openSettings(page);
    await page.locator('[data-testid="settings-close-btn"]').click();
    await expect(page.locator('[data-testid="settings-panel"]')).toBeHidden();
  });
});
