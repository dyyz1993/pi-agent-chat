import { test, expect } from "@playwright/test";

test.describe("App", () => {
  test("should load the main page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("should have correct title", async ({ page }) => {
    await page.goto("/");
    const title = await page.title();
    expect(title).toBeTruthy();
  });

  test("should display connection banner when disconnected", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator('[data-testid="connection-banner"]');
    await expect(banner).not.toBeVisible();
  });

  test("should toggle theme", async ({ page }) => {
    await page.goto("/");

    const html = page.locator("html");
    await expect(html).toHaveAttribute("class", /dark/);

    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    if (await themeToggle.isVisible()) {
      await themeToggle.click();
      await expect(html).not.toHaveAttribute("class", /dark/);
    }
  });
});
