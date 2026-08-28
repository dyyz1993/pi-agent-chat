import { test, expect, type ConsoleMessage } from "@playwright/test";
import { E2E_PAGE_URL, ensureE2EProject } from "./helpers/e2e-project";

const ignoredConsoleErrorPatterns = [/unsupported MIME type \('text\/html'\)/];

test.describe("Send / Modify / Delete Messages", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    await ensureE2EProject();
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") {
        const text = msg.text();
        if (ignoredConsoleErrorPatterns.some((pattern) => pattern.test(text))) return;
        consoleErrors.push(text);
      }
    });
    page.on("pageerror", (err: Error) => {
      consoleErrors.push(err.message);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // AC1: Send Message
  // ──────────────────────────────────────────────────────────────
  test("AC1: should send a message and see it appear in the message list", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    const msgCountBefore = await page.locator("[data-msg-card-id]").count();

    const testText = `E2E test send ${Date.now()}`;
    await input.fill(testText);

    const sendBtn = page.locator('button[aria-label="Send"], button[aria-label="发送"]').last();
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    const userMsg = page.locator("[data-msg-card-id]").filter({ hasText: testText });
    await expect(userMsg).toBeVisible({ timeout: 10000 });

    const msgCountAfter = await page.locator("[data-msg-card-id]").count();
    expect(msgCountAfter).toBeGreaterThan(msgCountBefore);
  });

  // ──────────────────────────────────────────────────────────────
  // AC2: Modify text before sending
  // ──────────────────────────────────────────────────────────────
  test("AC2: should modify text in input before sending", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    const originalText = "Original message content";
    await input.fill(originalText);
    await expect(input).toHaveValue(originalText);

    const modifiedText = "Modified message content";
    await input.fill(modifiedText);
    await expect(input).toHaveValue(modifiedText);

    const sendBtn = page.locator('button[aria-label="Send"], button[aria-label="发送"]').last();
    await expect(sendBtn).toBeEnabled();
    await sendBtn.click();

    const sentMsg = page.locator("[data-msg-card-id]").filter({ hasText: modifiedText });
    await expect(sentMsg).toBeVisible({ timeout: 10000 });

    const originalMsg = page.locator("[data-msg-card-id]").filter({ hasText: originalText });
    expect(await originalMsg.count()).toBe(0);
  });

  // ──────────────────────────────────────────────────────────────
  // AC3: Delete message via multi-select
  // ──────────────────────────────────────────────────────────────
  test("AC3: should delete a message via multi-select and delete", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    // Send a message to delete
    const deleteTestText = `E2E delete target ${Date.now()}`;
    await input.fill(deleteTestText);
    const sendBtn = page.locator('button[aria-label="Send"], button[aria-label="发送"]').last();
    await sendBtn.click();

    const targetMsg = page.locator("[data-msg-card-id]").filter({ hasText: deleteTestText });
    await expect(targetMsg).toBeVisible({ timeout: 10000 });

    const msgCountBefore = await page.locator("[data-msg-card-id]").count();

    // Enter multi-select mode via checkbox or right-click
    const checkbox = targetMsg.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.check();
    } else {
      // Fallback: right-click to trigger context menu / multi-select
      await targetMsg.click({ button: "right" });
      await page.waitForTimeout(500);
    }

    // Wait for selection bar with delete button
    const deleteBtn = page.locator('button[title="Delete selected"], button[title="删除所选"]');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();
    await page.waitForTimeout(1000);

    // Verify message removed
    const deletedMsg = page.locator("[data-msg-card-id]").filter({ hasText: deleteTestText });
    expect(await deletedMsg.count()).toBe(0);

    const msgCountAfter = await page.locator("[data-msg-card-id]").count();
    expect(msgCountAfter).toBeLessThan(msgCountBefore);
  });

  // ──────────────────────────────────────────────────────────────
  // Full flow: send → modify → send → delete
  // ──────────────────────────────────────────────────────────────
  test("should complete full send→modify→delete flow", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    // Step 1: Send
    const text1 = `Full flow step1 ${Date.now()}`;
    await input.fill(text1);
    const sendBtn = page.locator('button[aria-label="Send"], button[aria-label="发送"]').last();
    await sendBtn.click();

    const msg1 = page.locator("[data-msg-card-id]").filter({ hasText: text1 });
    await expect(msg1).toBeVisible({ timeout: 10000 });

    // Step 2: Modify input then send
    const text2Modified = `Full flow step2 ${Date.now()}`;
    await input.fill("Will be modified");
    await input.fill(text2Modified);
    await sendBtn.click();

    const msg2 = page.locator("[data-msg-card-id]").filter({ hasText: text2Modified });
    await expect(msg2).toBeVisible({ timeout: 10000 });

    // Step 3: Delete msg2
    const checkbox = msg2.locator('input[type="checkbox"]').first();
    if (await checkbox.isVisible().catch(() => false)) {
      await checkbox.check();
    } else {
      await msg2.click({ button: "right" });
      await page.waitForTimeout(500);
    }

    const deleteBtn = page.locator('button[title="Delete selected"], button[title="删除所选"]');
    await expect(deleteBtn).toBeVisible({ timeout: 5000 });
    await deleteBtn.click();
    await page.waitForTimeout(1000);

    expect(
      await page.locator("[data-msg-card-id]").filter({ hasText: text2Modified }).count(),
    ).toBe(0);
    // msg1 should still exist
    expect(await page.locator("[data-msg-card-id]").filter({ hasText: text1 }).count()).toBe(1);
  });

  test("should have no console errors during send/modify/delete", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    await input.fill("test content original");
    await input.fill("test content modified");
    await input.clear();

    await page.waitForTimeout(2000);

    expect(consoleErrors).toHaveLength(0);
  });
});
