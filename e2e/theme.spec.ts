import { test, expect } from "@playwright/test";

test.describe("Theme", () => {
  test("should default to dark theme", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/, { timeout: 10000 });
  });

  test("should open theme menu and switch to light", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const themeMenuToggle = page.locator('[data-testid="theme-menu-toggle"]');
    await themeMenuToggle.click();

    const lightOption = page.locator('[data-testid="theme-option-light"]');
    await expect(lightOption).toBeVisible();
    await lightOption.click();

    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);
    await expect(html).toHaveClass(/light/);
  });

  test("should show theme and language options in menu", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const themeMenuToggle = page.locator('[data-testid="theme-menu-toggle"]');
    await themeMenuToggle.click();

    await expect(page.locator('[data-testid="theme-option-light"]')).toBeVisible();
    await expect(page.locator('[data-testid="theme-option-dark"]')).toBeVisible();
    await expect(page.locator('[data-testid="theme-option-system"]')).toBeVisible();
    await expect(page.locator('[data-testid="lang-option-en"]')).toBeVisible();
    await expect(page.locator('[data-testid="lang-option-zh-CN"]')).toBeVisible();
  });

  test("should switch language via theme menu", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const themeMenuToggle = page.locator('[data-testid="theme-menu-toggle"]');
    await themeMenuToggle.click();

    const enOption = page.locator('[data-testid="lang-option-en"]');
    await expect(enOption).toBeVisible();
    await enOption.click();

    await page.waitForTimeout(500);

    const toggleText = await themeMenuToggle.textContent();
    expect(toggleText).toBeTruthy();
  });
});
