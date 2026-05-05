import { test, expect } from "@playwright/test";

test.describe("App", () => {
  test("should load the main page", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await expect(page.locator("#root")).toBeAttached();
  });

  test("should have correct title", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    const title = await page.title();
    expect(title).toBe("Pi Agent Chat");
  });

  test("should transition from loading to main layout", async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    const tabBar = page.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible({ timeout: 15000 });
  });
});
