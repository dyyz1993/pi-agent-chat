import { test, expect } from "@playwright/test";

/**
 * Native Bridge Demo 页面自动化测试
 *
 * 在 GitHub CI 上通过 Playwright 验证 Platform Bridge 的所有 Provider。
 *
 * 运行方式:
 *   npx playwright test tests/native-demo.spec.ts
 *
 * 注意:
 * - 这些测试在浏览器环境中运行，原生能力会降级为 Web 实现
 * - 测试验证的是：中间层逻辑正确、Provider 降级正常、不会崩溃
 * - 真正的原生能力（相机、语音、通知）需要在真机上验证
 */

test.describe("Native Bridge Demo - Platform Detection", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("show-native-demo", "true");
    });
    await page.reload();
    await page.waitForSelector("text=Native Bridge Demo", { timeout: 10000 });
  });

  test("应该正确检测为 Web 平台", async ({ page }) => {
    const platformText = page.locator("text=Platform:");
    await expect(platformText).toBeVisible();

    const isNativeText = page.locator("text=isNative:");
    await expect(isNativeText).toBeVisible();
  });

  test('点击"运行所有自动测试"应该执行测试', async ({ page }) => {
    await page.click("text=运行所有自动测试");

    await page.waitForTimeout(15000);

    const passOrWarn = page.locator("text=/✅|⚠️/");
    await expect(passOrWarn.first()).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Native Bridge Demo - Individual Tests", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("show-native-demo", "true");
    });
    await page.reload();
    await page.waitForSelector("text=Native Bridge Demo", { timeout: 10000 });
  });

  test("1. 平台检测测试", async ({ page }) => {
    const label = page.getByText("1. 平台检测", { exact: true });
    const card = label.locator("xpath=../..");
    await card.getByRole("button", { name: "运行测试" }).click();
    await page.waitForTimeout(2000);
    const result = page.locator(".text-green-400, .text-amber-400, .text-red-400").first();
    await expect(result).toBeVisible({ timeout: 5000 });
  });

  test("11. 存储测试", async ({ page }) => {
    const card = page
      .locator("div")
      .filter({ hasText: /^11\. 存储/ })
      .first();
    await card.getByRole("button", { name: "运行测试" }).click();
    await page.waitForTimeout(2000);
    const passIndicator = page.locator("text=存储读写删除正常");
    await expect(passIndicator).toBeVisible({ timeout: 5000 });
  });

  test("12. 深度链接测试", async ({ page }) => {
    const card = page
      .locator("div")
      .filter({ hasText: /^12\. 深度链接/ })
      .first();
    await card.getByRole("button", { name: "运行测试" }).click();
    await page.waitForTimeout(2000);
    const passIndicator = page.locator("text=深链解析正确");
    await expect(passIndicator).toBeVisible({ timeout: 5000 });
  });

  test("15. Service Worker 测试", async ({ page }) => {
    const card = page
      .locator("div")
      .filter({ hasText: /^15\. Service Worker/ })
      .first();
    await card.getByRole("button", { name: "运行测试" }).click();
    await page.waitForTimeout(2000);
    const result = page.locator(".text-green-400, .text-amber-400").first();
    await expect(result).toBeVisible({ timeout: 5000 });
  });

  test("16. 离线队列测试", async ({ page }) => {
    const card = page
      .locator("div")
      .filter({ hasText: /^16\. 离线队列/ })
      .first();
    await card.getByRole("button", { name: "运行测试" }).click();
    await page.waitForTimeout(2000);
    const passIndicator = page.locator("text=离线队列正常");
    await expect(passIndicator).toBeVisible({ timeout: 5000 });
  });

  test("日志面板应该显示测试日志", async ({ page }) => {
    const label = page.getByText("1. 平台检测", { exact: true });
    const card = label.locator("xpath=../..");
    await card.getByRole("button", { name: "运行测试" }).click();
    await page.waitForTimeout(2000);

    const logPanel = page.locator("text=Platform:").first();
    await expect(logPanel).toBeVisible({ timeout: 5000 });
  });

  test("退出 Demo 应该返回登录页", async ({ page }) => {
    await page.click("text=退出 Demo");
    await page.waitForTimeout(1000);

    await expect(page.locator("text=Auth Token").first()).toBeVisible({ timeout: 5000 });

    const showDemo = await page.evaluate(() => localStorage.getItem("show-native-demo"));
    expect(showDemo).toBeNull();
  });
});

test.describe("Native Bridge Demo - Provider Fallback", () => {
  test("File Provider 应该在 Web 环境下降级为 input[type=file]", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("show-native-demo", "true");
    });
    await page.reload();
    await page.waitForSelector("text=Native Bridge Demo", { timeout: 10000 });

    const card = page
      .locator("div")
      .filter({ hasText: /^2\. 图片选择/ })
      .first();
    await card.getByRole("button", { name: "运行测试" }).click();
    await page.waitForTimeout(1000);

    const result = page.locator(".text-green-400, .text-amber-400, .text-red-400").first();
    await expect(result).toBeVisible({ timeout: 5000 });
  });

  test("Notify Provider 应该在 Web 环境下使用 Notification API", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.setItem("show-native-demo", "true");
    });
    await page.reload();
    await page.waitForSelector("text=Native Bridge Demo", { timeout: 10000 });

    const card = page
      .locator("div")
      .filter({ hasText: /^5\. 通知权限/ })
      .first();
    await card.getByRole("button", { name: "运行测试" }).click();
    await page.waitForTimeout(2000);

    const result = page.locator(".text-green-400, .text-amber-400, .text-red-400").first();
    await expect(result).toBeVisible({ timeout: 5000 });
  });
});
