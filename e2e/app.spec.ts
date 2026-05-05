import { test, expect } from "@playwright/test";

test.describe("App", () => {
  test("should load the main page", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("body")).toBeVisible();
  });

  test("should have correct title", async ({ page }) => {
    await page.goto("/");
    const title = await page.title();
    expect(title).toBe("Pi Agent Chat");
  });

  test("should display connection banner when disconnected", async ({ page }) => {
    await page.goto("/");
    const banner = page.locator('[data-testid="connection-banner"]');
    await expect(banner).not.toBeVisible();
  });
});
