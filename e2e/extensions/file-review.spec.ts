/**
 * L3 extension: file-review — verify UI renders with extension loaded.
 *
 * Minimal smoke: page loads without crash when file-review extension is active.
 * Full channel interaction tests require mock data or real sessions.
 */

import { test, expect } from "@playwright/test";
import { E2E_PAGE_URL, ensureE2EProject } from "../helpers/e2e-project";

test.describe("L3 ext · file-review", () => {
  test("page loads with file-review extension active", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    await expect(page.locator("#root")).toBeAttached();
  });
});
