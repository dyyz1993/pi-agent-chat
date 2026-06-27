import { test, expect, type ConsoleMessage } from "@playwright/test";
import { E2E_PAGE_URL, ensureE2EProject } from "./helpers/e2e-project";

test.describe("Input Bar", () => {
  const consoleErrors: string[] = [];

  test.beforeEach(async ({ page }) => {
    consoleErrors.length = 0;
    await ensureE2EProject();
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err: Error) => {
      consoleErrors.push(err.message);
    });
  });

  test("should show chat input after loading", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });
    await expect(input).toBeEnabled();
  });

  test("should allow typing text into the input", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    await input.fill("Hello, this is a test message");
    await expect(input).toHaveValue("Hello, this is a test message");

    // Clear and verify
    await input.clear();
    await expect(input).toHaveValue("");
  });

  test("should show send button", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    // The send button has aria-label "Send" (en) or "发送" (zh)
    const sendBtn = page
      .locator('button[aria-label="Send"], button[aria-label="发送"]')
      .last();
    await expect(sendBtn).toBeVisible({ timeout: 10000 });
  });

  test("should show settings button", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const settingsBtn = page.locator('[data-testid="settings-open-btn"]');
    await expect(settingsBtn).toBeVisible({ timeout: 10000 });
  });

  test("send button should be disabled when input is empty", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    // Ensure input is empty
    await input.clear();

    const sendBtn = page
      .locator('button[aria-label="Send"], button[aria-label="发送"]')
      .last();
    await expect(sendBtn).toBeVisible({ timeout: 10000 });
    await expect(sendBtn).toBeDisabled();
  });

  test("should have no console errors", async ({ page }) => {
    await page.goto(E2E_PAGE_URL);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

    const input = page.locator('[data-testid="chat-input"]');
    await expect(input).toBeVisible({ timeout: 10000 });

    // Interact with the input to trigger any potential errors
    await input.fill("test content");
    await input.clear();

    // Wait a bit for any async errors to surface
    await page.waitForTimeout(2000);

    expect(consoleErrors).toHaveLength(0);
  });
});
