import { test, type ConsoleMessage } from "@playwright/test";

test.describe("Rollback button debug", () => {
  const chatLogs: string[] = [];

  test.beforeEach(({ page }) => {
    chatLogs.length = 0;
    page.on("console", (msg: ConsoleMessage) => {
      const text = msg.text();
      if (text.includes("[chat]") || text.includes("rollback")) {
        chatLogs.push(`[${msg.type()}] ${text}`);
      }
    });
  });

  test("debug: click rollback button and capture console output", async ({ page }) => {
    // 1. 打开页面
    await page.goto("/?token=demo-test-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 }).catch(() => {});
    await page.screenshot({ path: "test-results/rollback-01-loaded.png" });

    // 2. 检查页面状态 — 有没有 tab/session
    const tabCount = await page.locator('[data-testid="tab-bar"] [role="tab"]').count();
    console.log(`Tab count: ${tabCount}`);

    // 3. 查找所有可能的回滚按钮
    const undoButtons = await page.locator('button[title="回滚消息"]').count();
    const rotateButtons = await page.locator('button[title="回滚消息+代码"]').count();
    console.log(`Undo buttons found: ${undoButtons}`);
    console.log(`Rotate buttons found: ${rotateButtons}`);

    // 4. 查找所有消息卡片
    const allButtons = await page.locator("button").allTextContents();
    console.log(`Total buttons on page: ${allButtons.length}`);

    // 5. 检查有没有消息
    const pageContent = await page.content();
    const hasMessages = pageContent.includes("你") || pageContent.includes("assistant");
    console.log(`Has messages: ${hasMessages}`);

    // 6. 如果有回滚按钮，尝试点击
    if (undoButtons > 0) {
      // 先让按钮可见（hover）
      const btn = page.locator('button[title="回滚消息"]').first();
      const parent = btn.locator("..");
      await parent.hover({ timeout: 3000 }).catch(() => {});
      await page.waitForTimeout(500);
      await btn.click({ timeout: 5000 }).catch((err) => {
        console.log(`Click failed: ${err.message}`);
      });
      await page.waitForTimeout(2000);
      await page.screenshot({ path: "test-results/rollback-02-after-click.png" });
    } else {
      console.log("No rollback buttons found — likely no active session with messages");
      await page.screenshot({ path: "test-results/rollback-02-no-buttons.png" });
    }

    // 7. 输出所有 chat 日志
    console.log("\n=== CHAT LOGS ===");
    for (const log of chatLogs) {
      console.log(log);
    }
    console.log("=== END CHAT LOGS ===\n");

    // 8. 检查是否弹出了 overlay
    const overlay = await page.locator("text=回滚确认").count();
    const overlayAlt = await page.locator("text=已是第一条消息").count();
    console.log(`Overlay appeared: ${overlay > 0}`);
    console.log(`First-message notification: ${overlayAlt > 0}`);
    await page.screenshot({ path: "test-results/rollback-03-final.png" });
  });
});
