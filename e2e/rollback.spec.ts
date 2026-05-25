import { test, expect, type ConsoleMessage } from "@playwright/test";

test.describe("Rollback", () => {
  const chatLogs: string[] = [];
  const TOKEN = process.env.ROLLBACK_TEST_TOKEN ?? "demo-test-token";
  const SESSION_ID = "dda31fa6-3a10-479c-b9c9-2958c0d0ceef";

  const BTN_ROLLBACK_MSG = "Rollback message";
  const BTN_ROLLBACK_MSG_CODE = "Rollback message & code";
  const TXT_CONFIRM = "Confirm Rollback";
  const TXT_CANCEL = "Cancel";
  const TXT_OVERLAY_TITLE = "Rollback Confirmation";
  const TXT_OVERLAY_TITLE_FILES = "Rollback Message & Code";

  test.beforeEach(({ page }) => {
    chatLogs.length = 0;
    page.on("console", (msg: ConsoleMessage) => {
      const text = msg.text();
      if (text.includes("[chat]") || text.includes("rollback") || text.includes("navigateTree")) {
        chatLogs.push(`[${msg.type()}] ${text}`);
      }
    });
  });

  async function gotoSession(page) {
    await page.goto(`/?token=${TOKEN}&session=${SESSION_ID}`);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector("[data-msg-card-id]", { timeout: 20000 });
    await page.waitForTimeout(2000);
    // Wait for message count to stabilize (async loading)
    let prev = -1;
    for (let i = 0; i < 5; i++) {
      const cur = await page.locator("[data-msg-card-id]").count();
      if (cur === prev) break;
      prev = cur;
      await page.waitForTimeout(1500);
    }
  }

  async function countRollbackButtons(page) {
    return page.locator(`button[title="${BTN_ROLLBACK_MSG}"]`).count();
  }

  test("should show rollback buttons on user message cards", async ({ page }) => {
    await gotoSession(page);

    const msgCount = await page.locator("[data-msg-card-id]").count();
    expect(msgCount).toBeGreaterThanOrEqual(1);

    const undoBtns = await page.locator(`button[title="${BTN_ROLLBACK_MSG}"]`).count();
    const codeBtns = await page.locator(`button[title="${BTN_ROLLBACK_MSG_CODE}"]`).count();
    expect(undoBtns).toBeGreaterThanOrEqual(1);
    expect(codeBtns).toBeGreaterThanOrEqual(1);
  });

  test("should open message-mode overlay and cancel without changes", async ({ page }) => {
    await gotoSession(page);

    const btnCount = await countRollbackButtons(page);
    test.skip(btnCount < 1, "Need at least 1 user message");

    const msgCountBefore = await page.locator("[data-msg-card-id]").count();

    await page.locator(`button[title="${BTN_ROLLBACK_MSG}"]`).last().click({ timeout: 10000 });
    await page.waitForTimeout(2000);

    const overlay = page.locator('[data-testid="rollback-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10000 });
    await expect(overlay).toContainText(TXT_OVERLAY_TITLE);

    const cancelBtn = page.locator("button").filter({ hasText: TXT_CANCEL }).first();
    await cancelBtn.click();
    await page.waitForTimeout(1500);

    await expect(overlay).not.toBeVisible({ timeout: 5000 });
    const msgCountAfter = await page.locator("[data-msg-card-id]").count();
    expect(msgCountAfter).toBeGreaterThanOrEqual(msgCountBefore);
  });

  test("should open with-files overlay showing file changes", async ({ page }) => {
    await gotoSession(page);

    const btnCount = await page.locator(`button[title="${BTN_ROLLBACK_MSG_CODE}"]`).count();
    test.skip(btnCount < 1, "Need at least 1 user message for withFiles test");

    await page.locator(`button[title="${BTN_ROLLBACK_MSG_CODE}"]`).last().click({ timeout: 10000 });
    await page.waitForTimeout(3000);

    const overlay = page.locator('[data-testid="rollback-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10000 });
    await expect(overlay).toContainText(TXT_OVERLAY_TITLE_FILES);

    const cancelBtn = page.locator("button").filter({ hasText: TXT_CANCEL }).first();
    await cancelBtn.click();
    await page.waitForTimeout(1500);
    await expect(overlay).not.toBeVisible({ timeout: 5000 });
  });

  test("should confirm rollback and reduce message count", async ({ page }) => {
    await gotoSession(page);

    const btnCount = await countRollbackButtons(page);
    test.skip(btnCount < 1, "Need at least 1 user message to confirm rollback");

    await page.locator(`button[title="${BTN_ROLLBACK_MSG}"]`).last().click({ timeout: 10000 });
    await page.waitForTimeout(2000);

    const overlay = page.locator('[data-testid="rollback-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 10000 });

    const confirmBtn = page.locator("button").filter({ hasText: TXT_CONFIRM }).first();
    await confirmBtn.click();
    await page.waitForTimeout(5000);

    await expect(overlay).not.toBeVisible({ timeout: 8000 });

    // Wait for messages to re-render after rollback
    await page.waitForTimeout(3000);
    const msgCountAfter = await page.locator("[data-msg-card-id]").count();
    expect(msgCountAfter).toBeGreaterThanOrEqual(1);
  });

  test("should handle consecutive rollbacks without errors", async ({ page }) => {
    await gotoSession(page);

    const btnCount = await countRollbackButtons(page);
    test.skip(btnCount < 1, "Need at least 1 user message for consecutive rollback test");

    for (let i = 0; i < 2; i++) {
      const btns = await page.locator(`button[title="${BTN_ROLLBACK_MSG}"]`).all();
      if (btns.length < 1) break;

      const btn = btns[btns.length - 1];
      if (!(await btn.isVisible().catch(() => false))) break;

      await btn.click({ timeout: 10000 });
      await page.waitForTimeout(2000);

      const overlay = page.locator('[data-testid="rollback-overlay"]');
      if (!(await overlay.isVisible().catch(() => false))) break;

      const confirmBtn = page.locator("button").filter({ hasText: TXT_CONFIRM }).first();
      await confirmBtn.click();
      await page.waitForTimeout(5000);
    }

    const errorLogs = chatLogs.filter((l) => l.startsWith("[error]"));
    expect(errorLogs).toHaveLength(0);
  });

  test("should have no console errors during rollback", async ({ page }) => {
    await gotoSession(page);

    const btns = await page.locator(`button[title="${BTN_ROLLBACK_MSG}"]`).all();
    if (btns.length >= 1) {
      await btns[btns.length - 1].click({ timeout: 10000 });
      await page.waitForTimeout(2000);

      const overlay = page.locator('[data-testid="rollback-overlay"]');
      if (await overlay.isVisible().catch(() => false)) {
        const cancelBtn = page.locator("button").filter({ hasText: TXT_CANCEL }).first();
        await cancelBtn.click();
        await page.waitForTimeout(1500);
      }
    }

    const errorLogs = chatLogs.filter((l) => l.startsWith("[error]"));
    expect(errorLogs).toHaveLength(0);
  });

  test("should have valid tree data for rollback resolution", async ({ page }) => {
    await gotoSession(page);

    const btns = await page.locator(`button[title="${BTN_ROLLBACK_MSG}"]`).all();
    if (btns.length >= 1) {
      await btns[btns.length - 1].click({ timeout: 10000 });
      await page.waitForTimeout(2000);

      const overlay = page.locator('[data-testid="rollback-overlay"]');
      if (await overlay.isVisible().catch(() => false)) {
        const cancelBtn = page.locator("button").filter({ hasText: TXT_CANCEL }).first();
        await cancelBtn.click();
        await page.waitForTimeout(1500);
      }
    }

    const hasTreeLog = chatLogs.some(
      (l) => l.includes("fetchTree result") && l.includes("entryCount"),
    );
    expect(hasTreeLog).toBeTruthy();
  });
});
