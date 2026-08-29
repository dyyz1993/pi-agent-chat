import { test, expect, type ConsoleMessage } from "@playwright/test";

test.describe("Chat Message Types", () => {
  // Requires a fixture session (E2E_SESSION_ID) with pre-rendered messages.
  // On CI there is no such session yet — the fixture-injection infra is a
  // separate work package — so skip rather than fail on a missing session.
  test.skip(!process.env.E2E_SESSION_ID && !!process.env.CI, "needs E2E_SESSION_ID fixture session (CI lacks one)");
  const consoleErrors: string[] = [];
  const TOKEN = process.env.E2E_TEST_TOKEN ?? "test-ci-token";
  const SESSION_ID = process.env.E2E_SESSION_ID ?? "dda31fa6-3a10-479c-b9c9-2958c0d0ceef";

  test.beforeEach(({ page }) => {
    consoleErrors.length = 0;
    page.on("pageerror", (err) => {
      consoleErrors.push(`[pageerror] ${err.message}`);
    });
    page.on("console", (msg: ConsoleMessage) => {
      if (msg.type() === "error") {
        consoleErrors.push(`[console.error] ${msg.text()}`);
      }
    });
  });

  async function gotoSession(page: import("@playwright/test").Page) {
    await page.goto(`/?token=${TOKEN}&session=${SESSION_ID}`);
    await page.waitForSelector('[data-testid="tab-bar"]', { timeout: 15000 }).catch(() => {});
    await page.waitForSelector("[data-msg-card-id]", { timeout: 20000 });
    // Wait for message count to stabilize (async loading)
    let prev = -1;
    for (let i = 0; i < 5; i++) {
      const cur = await page.locator("[data-msg-card-id]").count();
      if (cur === prev) break;
      prev = cur;
      await page.waitForTimeout(1500);
    }
  }

  test("should render message cards", async ({ page }) => {
    await gotoSession(page);

    const msgCount = await page.locator("[data-msg-card-id]").count();
    expect(msgCount).toBeGreaterThanOrEqual(1);
  });

  test("should render user messages with correct role label", async ({ page }) => {
    await gotoSession(page);

    // User message cards have a "You" label (en locale) or "你" (zh-CN)
    const userLabels = page.locator('[data-msg-card-id] span:has-text("You")');
    const userCount = await userLabels.count();
    test.skip(userCount < 1, "Need at least 1 user message");

    // Verify the user message bubble has the expected background/border styling
    const userBubbles = page.locator('[data-msg-id]').filter({
      has: page.locator('span:has-text("You")'),
    });
    expect(await userBubbles.count()).toBeGreaterThanOrEqual(1);
  });

  test("should render assistant messages", async ({ page }) => {
    await gotoSession(page);

    // Assistant messages render text content blocks with prose styling
    const textBlocks = page.locator('[data-block-id] .prose');
    const assistantTextCount = await textBlocks.count();
    test.skip(assistantTextCount < 1, "Need at least 1 assistant text block");

    // The prose container should have non-empty rendered content
    const firstBlock = textBlocks.first();
    const textContent = await firstBlock.textContent();
    expect(textContent).toBeTruthy();
    expect(textContent!.trim().length).toBeGreaterThan(0);
  });

  test("should render and toggle thinking blocks", async ({ page }) => {
    await gotoSession(page);

    // ThinkingCard has a Brain icon + "Thinking" label
    const thinkingCards = page.locator('[data-block-id]').filter({
      has: page.locator('text="Thinking"'),
    });
    const thinkingCount = await thinkingCards.count();
    test.skip(thinkingCount < 1, "Need at least 1 thinking block");

    const firstThinking = thinkingCards.first();

    // The thinking header has expand/collapse button with title "Expand" or "Collapse"
    const toggleBtn = firstThinking.locator('button[title="Expand"], button[title="Collapse"]').first();
    await expect(toggleBtn).toBeVisible();

    // Check current state
    const isExpanded = await firstThinking.locator('button[title="Collapse"]').count();
    const isCollapsed = await firstThinking.locator('button[title="Expand"]').count();

    if (isCollapsed > 0) {
      // Currently collapsed — click to expand
      await toggleBtn.click();
      await page.waitForTimeout(500);
      // Now should show collapse button
      await expect(firstThinking.locator('button[title="Collapse"]')).toBeVisible();
      // And the thinking content should be visible
      const thinkingContent = firstThinking.locator(".whitespace-pre-wrap");
      expect(await thinkingContent.count()).toBeGreaterThan(0);
    } else if (isExpanded > 0) {
      // Currently expanded — click to collapse
      await toggleBtn.click();
      await page.waitForTimeout(500);
      // Now should show expand button
      await expect(firstThinking.locator('button[title="Expand"]')).toBeVisible();
    }
  });

  test("should render tool call / tool result blocks", async ({ page }) => {
    await gotoSession(page);

    // ToolExecutionCard renders with data-block-id and contains Input/Output sections
    const toolCards = page.locator('[data-block-id]').filter({
      has: page.locator('text="Input"'),
    });
    const toolCount = await toolCards.count();
    test.skip(toolCount < 1, "Need at least 1 tool call/result block");

    const firstTool = toolCards.first();

    // Should have Output section
    const outputSection = firstTool.locator('text="Output"');
    expect(await outputSection.count()).toBeGreaterThanOrEqual(1);

    // Toggle Input section open
    const inputToggle = firstTool.locator('text="Input"').first();
    await inputToggle.click();
    await page.waitForTimeout(500);

    // After clicking, an Input pre block should appear (if there are args)
    const inputPre = firstTool.locator("pre").first();
    if (await inputPre.isVisible().catch(() => false)) {
      const inputText = await inputPre.textContent();
      expect(inputText).toBeTruthy();
    }
  });

  test("should render code blocks in markdown", async ({ page }) => {
    await gotoSession(page);

    // Markdown renders <pre><code> blocks via CachedReactMarkdown
    const codeBlocks = page.locator(".prose pre code, .prose pre");
    const codeCount = await codeBlocks.count();
    test.skip(codeCount < 1, "Need at least 1 code block in messages");

    const firstCode = codeBlocks.first();
    const codeText = await firstCode.textContent();
    expect(codeText).toBeTruthy();
    expect(codeText!.trim().length).toBeGreaterThan(0);
  });

  test("should show copy buttons on message content", async ({ page }) => {
    await gotoSession(page);

    // CopyButton uses CopyAction → IconButton with title="Copy" or "复制"
    const copyBtns = page.locator('button[title="Copy"], button[title="复制"]');
    const copyCount = await copyBtns.count();
    test.skip(copyCount < 1, "Need at least 1 copy button");

    // Click the first copy button — should not throw
    await copyBtns.first().click();
    await page.waitForTimeout(500);
  });

  test("should not have console errors during message rendering", async ({ page }) => {
    await gotoSession(page);

    // Interact with some elements to trigger rendering
    const toolCards = page.locator('[data-block-id]').filter({
      has: page.locator('text="Input"'),
    });
    if ((await toolCards.count()) > 0) {
      await toolCards.first().locator('text="Input"').first().click();
      await page.waitForTimeout(500);
    }

    // Filter out known noise (React DevTools, WebSocket warnings in CI)
    const realErrors = consoleErrors.filter(
      (e) =>
        !e.includes("React DevTools") &&
        !e.includes("WebSocket") &&
        !e.includes("Download the React DevTools"),
    );
    expect(realErrors).toHaveLength(0);
  });

  test("should render compaction summary if present", async ({ page }) => {
    await gotoSession(page);

    // CompactionSummary card shows "Context Compaction" label (en) or context compaction text
    const compactionCards = page.locator('[data-msg-card-id]').filter({
      has: page.locator('svg.lucide-archive, text="Context Compaction"'),
    });
    const compactionCount = await compactionCards.count();
    test.skip(compactionCount < 1, "No compaction summary in this session");

    const firstCompaction = compactionCards.first();
    // Should have a collapse/expand toggle button
    const toggleBtn = firstCompaction.locator("button").first();
    await expect(toggleBtn).toBeVisible();
  });

  test("should render error messages if present", async ({ page }) => {
    await gotoSession(page);

    // Error message cards have AlertTriangle icon + error styling
    const errorCards = page.locator('[data-msg-card-id]').filter({
      has: page.locator(".bg-status-error\\/\\[0\\.06\\]"),
    });
    const errorCount = await errorCards.count();
    test.skip(errorCount < 1, "No error messages in this session");

    // Error card should display the error title text
    const errorTitle = errorCards.first().locator(".text-status-error.font-medium");
    expect(await errorTitle.count()).toBeGreaterThanOrEqual(1);
    const titleText = await errorTitle.first().textContent();
    expect(titleText).toBeTruthy();
  });

  test("should maintain stable message count after interactions", async ({ page }) => {
    await gotoSession(page);

    const msgCountBefore = await page.locator("[data-msg-card-id]").count();

    // Toggle thinking blocks if present
    const thinkingToggles = page.locator(
      '[data-block-id] button[title="Expand"], [data-block-id] button[title="Collapse"]',
    );
    const toggleCount = await thinkingToggles.count();
    if (toggleCount > 0) {
      await thinkingToggles.first().click();
      await page.waitForTimeout(500);
    }

    // Toggle tool cards if present
    const toolInputToggles = page
      .locator('[data-block-id]')
      .filter({ has: page.locator('text="Input"') })
      .locator('text="Input"')
      .first();
    if (await toolInputToggles.isVisible().catch(() => false)) {
      await toolInputToggles.click();
      await page.waitForTimeout(500);
    }

    const msgCountAfter = await page.locator("[data-msg-card-id]").count();
    expect(msgCountAfter).toBe(msgCountBefore);
  });
});
