/**
 * L2 goal flow: InputBar goal mode + draft editing.
 *
 * Validates commit ca63c225 (GoalDraftCard simplified into InputBar):
 * - Click 🎯 → InputBar turns purple (accent tone)
 * - Draft markdown appears in textarea (not a separate card)
 * - Editing the textarea updates the goal draft
 * - Exiting goal mode restores gray InputBar
 *
 * This test would catch regressions where GoalDraftCard comes back as a
 * separate card or the InputBar doesn't switch to accent tone.
 */

import { test, expect } from "@playwright/test";
import { E2E_PAGE_URL, ensureE2EProject } from "../helpers/e2e-project";

async function getComposerClass(page: import("@playwright/test").Page): Promise<string> {
  return page.evaluate(() => {
    const ta = document.querySelector('[data-testid="chat-input"]');
    const composer = ta?.closest("div.flex-1");
    return composer?.className ?? "";
  });
}

test.describe("L2 goal · draft edit (InputBar goal mode)", () => {
  test("click Goal toolbar button → InputBar turns purple + draft fills", async ({ page }) => {
    await ensureE2EProject();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(E2E_PAGE_URL);

    // Default: no accent
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });
    const beforeClass = await getComposerClass(page);
    expect(beforeClass.includes("accent")).toBe(false);

    // Click Goal button in QuickActionToolbar
    const goalBtn = page
      .locator('[data-testid="quick-action-toolbar"] button')
      .filter({ hasText: /goal/i });
    await expect(goalBtn).toBeVisible({ timeout: 20000 });
    await goalBtn.click();
    await page.waitForTimeout(2000);

    // After click: accent tone (purple)
    const afterClass = await getComposerClass(page);
    expect(afterClass.includes("accent")).toBe(true);

    // Textarea has draft content (not empty)
    const value = await page.locator('[data-testid="chat-input"]').inputValue();
    expect(value.length).toBeGreaterThan(50);

    // No separate GoalDraftCard element
    const draftCard = page.locator('[data-testid="goal-draft-card"]');
    await expect(draftCard).toHaveCount(0);
  });

  test("editing textarea updates content", async ({ page }) => {
    await ensureE2EProject();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });

    const goalBtn = page
      .locator('[data-testid="quick-action-toolbar"] button')
      .filter({ hasText: /goal/i });
    await goalBtn.click();
    await page.waitForTimeout(2000);

    const ta = page.locator('[data-testid="chat-input"]');
    await ta.click();
    await ta.fill("");
    await ta.fill("# Target: edited by E2E test");
    await expect(ta).toHaveValue("# Target: edited by E2E test");
  });

  test("exit goal mode via composer chip restores gray InputBar", async ({ page }) => {
    await ensureE2EProject();
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="chat-input"]', { timeout: 20000 });

    // Enter goal mode
    const goalBtn = page
      .locator('[data-testid="quick-action-toolbar"] button')
      .filter({ hasText: /goal/i });
    await goalBtn.click();
    await page.waitForTimeout(2000);
    expect((await getComposerClass(page)).includes("accent")).toBe(true);

    // Exit via two-step chip click (composer-state-indicators)
    const exitStep1 = page.locator('[data-testid="composer-state-indicators"] button').first();
    await exitStep1.click();
    await page.waitForTimeout(500);
    const exitStep2 = page.locator('[data-testid="composer-state-indicators"] button[data-state="armed-close"]');
    if (await exitStep2.count()) {
      await exitStep2.click();
      await page.waitForTimeout(1500);
    }

    // After exit: no accent (gray)
    const afterExit = await getComposerClass(page);
    expect(afterExit.includes("accent")).toBe(false);
  });
});
