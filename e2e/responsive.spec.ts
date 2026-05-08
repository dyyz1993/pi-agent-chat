import { test, expect } from "@playwright/test";

test.describe("Responsive Layout", () => {
  test("should show mobile layout on small screen", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const tabBar = page.locator('[data-testid="tab-bar"]');
    await expect(tabBar).toBeVisible();

    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).not.toBeVisible();
  });

  test("should show desktop layout on large screen", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).toBeVisible();

    const rightSidebar = page.locator('[data-testid="right-sidebar"]');
    await expect(rightSidebar).toBeVisible();
  });

  test("should adapt sidebar visibility when resizing from desktop to mobile", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).toBeVisible();

    await page.setViewportSize({ width: 375, height: 667 });
    await page.waitForTimeout(500);

    await expect(newSessionBtn).not.toBeVisible();
  });

  test("should restore sidebar when resizing from mobile to desktop", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const newSessionBtn = page.locator('[data-testid="new-session-button"]');
    await expect(newSessionBtn).not.toBeVisible();

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForTimeout(500);

    await expect(newSessionBtn).toBeVisible();
  });

  test("no key elements should overflow viewport on mobile", async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    const overflowElements = await page.evaluate(() => {
      const results: { tag: string; testid: string; right: number }[] = [];
      const skipTags = new Set(["HTML", "BODY", "HEAD", "SCRIPT", "STYLE", "LINK", "META"]);
      document.querySelectorAll("*").forEach((el) => {
        if (skipTags.has(el.tagName)) return;
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.right > window.innerWidth + 2) {
          results.push({
            tag: el.tagName,
            testid: el.getAttribute("data-testid") || "",
            right: Math.round(rect.right),
          });
        }
      });
      return results;
    });

    const significantOverflows = overflowElements.filter((el) => el.right > 400);

    if (significantOverflows.length > 0) {
      console.log("Significant overflows:", JSON.stringify(significantOverflows, null, 2));
    }

    const tabBar = page.locator('[data-testid="tab-bar"]');
    const tabBarBox = await tabBar.boundingBox();
    expect(tabBarBox).toBeTruthy();
    expect(tabBarBox!.width).toBeLessThanOrEqual(375);

    const inputVisible = await page
      .locator('[data-testid="chat-input"]')
      .isVisible()
      .catch(() => false);
    if (inputVisible) {
      const inputBox = await page.locator('[data-testid="chat-input"]').boundingBox();
      if (inputBox) {
        expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(385);
      }
    }
  });

  test("no key elements should overflow viewport on tablet", async ({ page }) => {
    test.setTimeout(60000);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.goto("/?token=test-ci-token");
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });
    await page.waitForTimeout(500);

    const tabBar = page.locator('[data-testid="tab-bar"]');
    const tabBarBox = await tabBar.boundingBox();
    expect(tabBarBox).toBeTruthy();
    expect(tabBarBox!.width).toBeLessThanOrEqual(768);

    const inputVisible = await page
      .locator('[data-testid="chat-input"]')
      .isVisible()
      .catch(() => false);
    if (inputVisible) {
      const inputBox = await page.locator('[data-testid="chat-input"]').boundingBox();
      if (inputBox) {
        expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(778);
      }
    }
  });
});
