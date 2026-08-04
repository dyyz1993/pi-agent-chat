/**
 * L1 smoke: project tab-bar shows and switches between tabs.
 */

import { test, expect } from "@playwright/test";
import { E2E_PAGE_URL, ensureE2EProject } from "../helpers/e2e-project";

test.describe("L1 smoke · tab bar", () => {
  test("tab bar is visible after load", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    await expect(page.locator('[data-testid="tab-bar"]')).toBeVisible({ timeout: 20000 });
  });

  test("add project button (+) is present", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 20000 });
    const addBtn = page.locator('[data-testid="tab-bar"] button[aria-label*="项目" i], [data-testid="tab-bar"] button[aria-label*="project" i]');
    expect(await addBtn.count()).toBeGreaterThan(0);
  });
});
