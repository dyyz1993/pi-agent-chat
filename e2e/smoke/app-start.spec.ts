/**
 * L1 smoke: app starts and renders the basic layout (InputBar + toolbar).
 *
 * Uses the real dev server (auto-started by playwright.config.ts webServer).
 * L1 protects the "page loads" path that every PR must keep working.
 */

import { test, expect } from "@playwright/test";
import { E2E_PAGE_URL, ensureE2EProject } from "../helpers/e2e-project";

test.describe("L1 smoke · app start", () => {
  test("page loads with title", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    await expect(page).toHaveTitle("Pi Agent Chat");
  });

  test("root element renders", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    await expect(page.locator("#root")).toBeAttached({ timeout: 10000 });
  });

  test("InputBar is visible", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    await expect(page.locator('[data-testid="chat-input"]')).toBeVisible({ timeout: 20000 });
  });

  test("QuickActionToolbar has exactly 4 buttons (mobile)", async ({ page }) => {
    await ensureE2EProject();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(E2E_PAGE_URL);
    const toolbar = page.locator('[data-testid="quick-action-toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 20000 });
    const buttons = toolbar.locator("button");
    await expect(buttons).toHaveCount(4);
  });

  test("no Loop button remains after refactor (mobile)", async ({ page }) => {
    await ensureE2EProject();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="quick-action-toolbar"]', { timeout: 20000 });
    const loopBtn = page.locator('[data-testid="quick-action-toolbar"] button[title*="Loop" i]');
    await expect(loopBtn).toHaveCount(0);
  });
});
