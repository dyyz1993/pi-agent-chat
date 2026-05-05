import { test, expect } from "@playwright/test";

test.describe("Right Sidebar Panel Tabs", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });
  });

  test("should show right sidebar with panel tabs", async ({ page }) => {
    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await expect(rightSidebar).toBeVisible();

    const tabs = rightSidebar.locator("button");
    const count = await tabs.count();
    expect(count).toBeGreaterThanOrEqual(1);
  });

  test("should switch panel tabs", async ({ page }) => {
    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await expect(rightSidebar).toBeVisible();

    const tabButtons = rightSidebar.locator("div.overflow-x-auto button");
    const count = await tabButtons.count();
    if (count >= 2) {
      await tabButtons.nth(1).click();
      await tabButtons.nth(0).click();
    }
  });

  test("should show git panel tab", async ({ page }) => {
    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await expect(rightSidebar).toBeVisible();

    const gitTab = rightSidebar.locator("button", { hasText: /git/i });
    if (await gitTab.isVisible()) {
      await gitTab.click();
    }
  });

  test("should toggle right sidebar visibility via pin button", async ({ page }) => {
    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await expect(rightSidebar).toBeVisible();

    const pinBtn = rightSidebar.locator("button").first();
    if (await pinBtn.isVisible()) {
      await pinBtn.click();
    }
  });

  test("should show theme menu in left sidebar", async ({ page }) => {
    const themeMenuToggle = page.locator('[data-testid="theme-menu-toggle"]');
    await expect(themeMenuToggle).toBeVisible();
  });
});
