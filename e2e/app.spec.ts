import { test, expect } from "@playwright/test";
import { E2E_PAGE_URL, ensureE2EProject } from "./helpers/e2e-project";

test.describe("App", () => {
  test("should load the main page", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await expect(page.locator("#root")).toBeAttached();
  });

  test("should have correct title", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    const title = await page.title();
    expect(title).toBe("Pi Agent Chat");
  });

  test("should transition from loading to main layout", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    const tabBar = page.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible({ timeout: 15000 });
  });
});
