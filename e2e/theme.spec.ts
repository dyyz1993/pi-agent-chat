import { test, expect } from "@playwright/test";

test.describe("Theme", () => {
  test("should default to dark theme", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).toHaveClass(/dark/);
  });

  test("should persist theme preference", async ({ page }) => {
    await page.goto("/");

    const themeToggle = page.locator('[data-testid="theme-toggle"]');
    await expect(themeToggle).toBeVisible();
    await themeToggle.click();

    await page.reload();
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);
  });

  test("should follow system preference", async ({ context, page }) => {
    await context.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/dark/);
  });
});
