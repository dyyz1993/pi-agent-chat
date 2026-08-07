/**
 * L3 extension: bash-ext — verify UI renders with extension loaded.
 *
 * Minimal smoke: page loads without crash when bash-ext extension is active.
 * Full channel interaction tests require mock data or real sessions.
 */

import { test, expect } from "@playwright/test";
import { E2E_PAGE_URL, ensureE2EProject } from "../helpers/e2e-project";

test.describe("L3 ext · bash-ext", () => {
  test("page loads with bash-ext extension active", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    await expect(page.locator("#root")).toBeAttached();
  });
});
