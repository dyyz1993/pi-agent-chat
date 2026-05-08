import { test } from "@playwright/test";

test.describe("应用截图", () => {
  test("登录页面 - 竖屏", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: "screenshots/login-mobile.png",
      fullPage: true,
    });
  });

  test("登录页面 - 横屏", async ({ page }) => {
    await page.setViewportSize({ width: 852, height: 393 });
    await page.goto("/");
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: "screenshots/login-landscape.png",
      fullPage: true,
    });
  });

  test("登录页面 - 平板", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    await page.screenshot({
      path: "screenshots/login-tablet.png",
      fullPage: true,
    });
  });
});
