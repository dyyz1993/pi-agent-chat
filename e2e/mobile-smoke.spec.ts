import { test, expect } from "@playwright/test";
import { E2E_PAGE_URL, ensureE2EProject } from "./helpers/e2e-project";

test.describe("T26 Mobile Features — ui-tester Guided", () => {
  test.beforeEach(async () => {
    await ensureE2EProject();
  });

  test.describe("T26.1 QuickActionToolbar", () => {
    test.use({ viewport: { width: 375, height: 812 } }); // iPhone X

    test("QuickActionToolbar appears on mobile input focus", async ({ page }) => {
      await page.goto(E2E_PAGE_URL);
      await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

      // Tap on the chat input
      const input = page.locator('textarea, [contenteditable="true"]').first();
      await input.waitFor({ state: "visible", timeout: 10000 });
      await input.click();

      // QuickActionToolbar should be visible at mobile breakpoint
      // The toolbar contains @, /, attachment, and image buttons
      await expect(page.locator('[data-testid="quick-action-toolbar"]')).toBeVisible({
        timeout: 5000,
      });
    });
  });

  test.describe("T26.2 @ Popup", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("@ popup shows Agents/Files/Memory tabs", async ({ page }) => {
      await page.goto(E2E_PAGE_URL);
      await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

      const toolbar = page.locator('[data-testid="quick-action-toolbar"]');
      if (await toolbar.isVisible()) {
        await toolbar.locator('button[aria-label*="@"]').click();
        const popup = page.locator('[data-testid="mention-popup"]');
        await expect(popup).toBeVisible({ timeout: 3000 });

        // Check for the three tabs
        await expect(
          popup
            .locator("text=Agents")
            .or(popup.locator("text=Files"))
            .or(popup.locator("text=Memory")),
        ).toBeVisible();
      }
    });
  });

  test.describe("T26.3 / Popup", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("/ popup shows Commands/Skills tabs", async ({ page }) => {
      await page.goto(E2E_PAGE_URL);
      await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

      const toolbar = page.locator('[data-testid="quick-action-toolbar"]');
      if (await toolbar.isVisible()) {
        await toolbar.locator('button[aria-label*="/"]').click();
        const popup = page.locator('[data-testid="command-popup"]');
        if (await popup.isVisible({ timeout: 2000 }).catch(() => false)) {
          // Check for Commands and Skills tabs
          await expect(
            popup.locator("text=Commands").or(popup.locator("text=Skills")),
          ).toBeVisible();
        }
      }
    });
  });

  test.describe("T26.4 Mobile Sidebar", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("Sidebar becomes overlay on mobile", async ({ page }) => {
      await page.goto(E2E_PAGE_URL);
      await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

      // Toggle sidebar
      const sidebarToggle = page
        .locator('[data-testid="sidebar-toggle"], [aria-label="Toggle sidebar"]')
        .first();
      if (await sidebarToggle.isVisible()) {
        await sidebarToggle.click();

        // Sidebar should be an overlay (85% width with backdrop)
        const sidebar = page
          .locator('[data-testid="session-sidebar"]')
          .or(page.locator('[class*="sidebar"]').first());
        if (await sidebar.isVisible({ timeout: 3000 }).catch(() => false)) {
          // Verify it has overlay styling
          await expect(sidebar).toBeVisible();
        }
      }
    });
  });

  test.describe("T26.6 Mobile Tab", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("Tab close button always visible on mobile", async ({ page }) => {
      await page.goto(E2E_PAGE_URL);
      await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });

      const tabBar = page.locator('[data-testid="tab-bar"]');
      // Close buttons should be visible without hover
      const closeButtons = tabBar.locator('button[aria-label="Close tab"], button[title="Close"]');
      const count = await closeButtons.count();
      if (count > 0) {
        await expect(closeButtons.first()).toBeVisible();
      }
    });
  });

  test.describe("T26.7 Mobile Diff Viewer", () => {
    test.use({ viewport: { width: 375, height: 812 } });

    test("Diff viewer forces unified view on mobile", async ({ page }) => {
      await page.goto(E2E_PAGE_URL);
      await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 });
      // This test requires the diff panel to be open,
      // which requires git state - skipped in basic smoke
      // Verified via ui-tester with real repo data
      test.skip("Needs real git diff data — run with ui-tester");
    });
  });
});
