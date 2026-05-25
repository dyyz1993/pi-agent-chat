import { test, type ConsoleMessage } from "@playwright/test";

test.describe("Rollback debug diagnostics", () => {
  const chatLogs: string[] = [];
  const TOKEN = process.env.ROLLBACK_TEST_TOKEN ?? "demo-test-token";
  const SESSION_ID = "dda31fa6-3a10-479c-b9c9-2958c0d0ceef";

  test.beforeEach(({ page }) => {
    chatLogs.length = 0;
    page.on("console", (msg: ConsoleMessage) => {
      const text = msg.text();
      if (
        text.includes("[chat]") ||
        text.includes("rollback") ||
        text.includes("navigateTree") ||
        text.includes("fetchTree")
      ) {
        chatLogs.push(`[${msg.type()}] ${text}`);
      }
    });
  });

  test("debug: dump page state and rollback button details", async ({ page }) => {
    await page.goto(`/?token=${TOKEN}&session=${SESSION_ID}`);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector("[data-msg-card-id]", { timeout: 20000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: "test-results/rollback-debug-01-loaded.png" });

    const tabCount = await page.locator('[data-testid="tab-bar"] [role="tab"]').count();
    console.log(`Tab count: ${tabCount}`);

    const msgCards = await page.locator("[data-msg-card-id]").count();
    console.log(`Message cards: ${msgCards}`);

    const enMsg = await page.locator('button[title="Rollback message"]').count();
    const enCode = await page.locator('button[title="Rollback message & code"]').count();
    const zhMsg = await page.locator('button[title="回滚消息"]').count();
    const zhCode = await page.locator('button[title="回滚消息+代码"]').count();
    console.log(`EN buttons: msg=${enMsg}, code=${enCode}`);
    console.log(`ZH buttons: msg=${zhMsg}, code=${zhCode}`);

    const cardInfo = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("[data-msg-card-id]")).map((el) => {
        const id = el.getAttribute("data-msg-card-id")?.slice(0, 16);
        const allBtns = Array.from(el.querySelectorAll("button[title]"))
          .map((b) => b.getAttribute("title"))
          .filter(Boolean);
        const header = el.querySelector("span");
        const roleText = header?.textContent?.trim().slice(0, 30) ?? "";
        return { id, role: roleText, buttons: allBtns };
      });
    });
    console.log("Cards:", JSON.stringify(cardInfo, null, 2));

    const allTitles = await page.evaluate(() =>
      Array.from(
        new Set(
          Array.from(document.querySelectorAll("button[title]"))
            .map((b) => b.getAttribute("title"))
            .filter(Boolean),
        ),
      ),
    );
    console.log(`Unique button titles: ${JSON.stringify(allTitles)}`);

    const selector = enMsg > 0 ? 'button[title="Rollback message"]' : 'button[title="回滚消息"]';
    const count = enMsg > 0 ? enMsg : zhMsg;
    if (count > 0) {
      const btn = page.locator(selector).last();
      await btn.click({ timeout: 10000 });
      await page.waitForTimeout(3000);

      const overlay = page.locator('[data-testid="rollback-overlay"]');
      const overlayVisible = await overlay.isVisible().catch(() => false);
      console.log(`Overlay visible after click: ${overlayVisible}`);

      if (overlayVisible) {
        const overlayText = await overlay.textContent();
        console.log(`Overlay content: ${overlayText?.slice(0, 200)}`);

        const cancelSelector = enMsg > 0 ? "Cancel" : "取消";
        await page.locator("button").filter({ hasText: cancelSelector }).first().click();
        await page.waitForTimeout(1500);
      }
    }

    await page.screenshot({ path: "test-results/rollback-debug-02-final.png" });

    console.log("\n=== CHAT LOGS ===");
    for (const log of chatLogs) console.log(log);
    console.log("=== END ===");
  });
});
