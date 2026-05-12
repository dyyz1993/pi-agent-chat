import { test, expect, type ConsoleMessage } from "@playwright/test";

test.describe("Rollback", () => {
  const chatLogs: string[] = [];
  const TOKEN = process.env.ROLLBACK_TEST_TOKEN ?? "demo-test-token";

  test.beforeEach(({ page }) => {
    chatLogs.length = 0;
    page.on("console", (msg: ConsoleMessage) => {
      const text = msg.text();
      if (text.includes("[chat]") || text.includes("rollback") || text.includes("navigateTree")) {
        chatLogs.push(`[${msg.type()}] ${text}`);
      }
    });
  });

  test("should show rollback buttons on message cards", async ({ page }) => {
    await page.goto(`/?token=${TOKEN}`);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const msgCount = await page.locator("[data-msg-card-id]").count();
    test.skip(msgCount === 0, "No messages in active session — need a session with messages");

    const undoBtns = await page.locator('button[title="回滚消息"]').count();
    const codeBtns = await page.locator('button[title="回滚消息+代码"]').count();
    expect(undoBtns).toBeGreaterThanOrEqual(1);
    expect(codeBtns).toBeGreaterThanOrEqual(1);
  });

  test("should open overlay and cancel without changes", async ({ page }) => {
    await page.goto(`/?token=${TOKEN}`);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const msgCountBefore = await page.locator("[data-msg-card-id]").count();
    test.skip(msgCountBefore === 0, "No messages — need a session with messages");

    await page.locator('button[title="回滚消息"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(3000);

    const overlay = page.locator('[class*="backdrop-blur"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await expect(overlay).toContainText("回滚确认");

    const cancelBtn = page.locator("button").filter({ hasText: "取消" }).first();
    await cancelBtn.click();
    await page.waitForTimeout(1500);

    await expect(overlay).not.toBeVisible({ timeout: 3000 });

    const msgCountAfter = await page.locator("[data-msg-card-id]").count();
    expect(msgCountAfter).toBe(msgCountBefore);
  });

  test("should confirm rollback and remove a turn", async ({ page }) => {
    await page.goto(`/?token=${TOKEN}`);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const msgCountBefore = await page.locator("[data-msg-card-id]").count();
    test.skip(msgCountBefore < 2, "Need at least 2 messages for rollback");

    await page.locator('button[title="回滚消息"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(3000);

    const overlay = page.locator('[class*="backdrop-blur"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    const confirmBtn = page.locator("button").filter({ hasText: "确认回滚" }).first();
    await confirmBtn.click();
    await page.waitForTimeout(4000);

    await expect(overlay).not.toBeVisible({ timeout: 5000 });

    const hasRollbackLog = chatLogs.some((l) => l.includes("rollback executed from overlay"));
    expect(hasRollbackLog).toBeTruthy();
  });

  test("should open with-files overlay with correct title", async ({ page }) => {
    await page.goto(`/?token=${TOKEN}`);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const msgCount = await page.locator("[data-msg-card-id]").count();
    test.skip(msgCount === 0, "No messages — need a session with messages");

    await page.locator('button[title="回滚消息+代码"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(3000);

    const overlay = page.locator('[class*="backdrop-blur"]');
    await expect(overlay).toBeVisible({ timeout: 5000 });
    await expect(overlay).toContainText("回滚");

    const cancelBtn = page.locator("button").filter({ hasText: "取消" }).first();
    await cancelBtn.click();
    await page.waitForTimeout(1500);
  });

  test("should handle consecutive rollbacks without errors", async ({ page }) => {
    await page.goto(`/?token=${TOKEN}`);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const msgCount = await page.locator("[data-msg-card-id]").count();
    test.skip(msgCount < 3, "Need at least 3 messages for multi-rollback");

    for (let i = 0; i < 2; i++) {
      const btn = page.locator('button[title="回滚消息"]').first();
      if (!(await btn.isVisible().catch(() => false))) break;
      await btn.click({ timeout: 10000 });
      await page.waitForTimeout(3000);

      const overlay = page.locator('[class*="backdrop-blur"]');
      if (!(await overlay.isVisible().catch(() => false))) break;

      const confirmBtn = page.locator("button").filter({ hasText: "确认回滚" }).first();
      await confirmBtn.click();
      await page.waitForTimeout(4000);
    }

    const errorLogs = chatLogs.filter((l) => l.startsWith("[error]"));
    expect(errorLogs).toHaveLength(0);
  });

  test("should have no console errors and valid tree data", async ({ page }) => {
    await page.goto(`/?token=${TOKEN}`);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(5000);

    const msgCount = await page.locator("[data-msg-card-id]").count();
    test.skip(msgCount === 0, "No messages — need a session with messages");

    await page.locator('button[title="回滚消息"]').first().click({ timeout: 10000 });
    await page.waitForTimeout(3000);

    const overlay = page.locator('[class*="backdrop-blur"]');
    if (await overlay.isVisible().catch(() => false)) {
      const cancelBtn = page.locator("button").filter({ hasText: "取消" }).first();
      await cancelBtn.click();
      await page.waitForTimeout(1500);
    }

    const errorLogs = chatLogs.filter((l) => l.startsWith("[error]"));
    expect(errorLogs).toHaveLength(0);

    const hasTreeLog = chatLogs.some(
      (l) => l.includes("fetchTree result") && l.includes("entryCount"),
    );
    expect(hasTreeLog).toBeTruthy();
  });
});
