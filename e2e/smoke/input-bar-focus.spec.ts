/**
 * L1 smoke: InputBar focus + placeholder behavior.
 */

import { test, expect } from "@playwright/test";
import { E2E_PAGE_URL, ensureE2EProject } from "../helpers/e2e-project";

test.describe("L1 smoke · InputBar focus", () => {
  test("textarea accepts input", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    const ta = page.locator('[data-testid="chat-input"]');
    await expect(ta).toBeVisible({ timeout: 20000 });
    await ta.fill("hello world");
    await expect(ta).toHaveValue("hello world");
  });

  test("placeholder is shown when empty", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    const ta = page.locator('[data-testid="chat-input"]');
    await expect(ta).toBeVisible({ timeout: 20000 });
    const placeholder = await ta.getAttribute("placeholder");
    expect(placeholder).toBeTruthy();
    expect(placeholder!.length).toBeGreaterThan(0);
  });

  test("InputBar container is not in accent (purple) state by default", async ({ page }) => {
    await ensureE2EProject();
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    const hasAccent = await page.evaluate(() => {
      const ta = document.querySelector('[data-testid="chat-input"]');
      const composer = ta?.closest("div.flex-1");
      return composer?.className?.includes("accent") ?? false;
    });
    expect(hasAccent).toBe(false);
  });
});
