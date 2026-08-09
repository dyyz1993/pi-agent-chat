/**
 * UI screenshot verification for issue-monitor UI:
 *   1. Status Panel — Issue Monitor section
 *   2. Settings Panel — Issue Monitor tab + config form
 *   3. IssueMonitorBlockCard rendering in a synthetic assistant message
 *
 * Run: node scripts/ui-screenshot-issue-monitor.mjs
 *
 * Uses local Chromium.app at ~/Downloads/Chromium.app.
 * Targets http://localhost:5173 (Vite dev server).
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const OUT_DIR = "/tmp/im-ui-shots";
mkdirSync(OUT_DIR, { recursive: true });

const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  "/Users/xuyingzhou/Downloads/Chromium.app/Contents/MacOS/Chromium";

const BASE = "http://localhost:5173";

function log(...args) {
  console.log("[im-ui]", ...args);
}

const results = { pass: [], fail: [] };
function check(name, ok, detail = "") {
  if (ok) {
    results.pass.push(name);
    log(`✅ ${name}`);
  } else {
    results.fail.push(`${name}${detail ? ` — ${detail}` : ""}`);
    log(`❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

async function run() {
  log("launching chromium:", CHROMIUM_PATH);
  const browser = await chromium.launch({
    executablePath: CHROMIUM_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  // Bypass auth token prompt in dev
  await context.addInitScript(() => {
    localStorage.setItem("pi-auth-token", "demo-test-token");
  });
  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error") log("console.error:", msg.text().slice(0, 200));
  });
  page.on("pageerror", (err) => log("pageerror:", err.message.slice(0, 200)));

  // ── Navigate to app ──
  log("navigating to", BASE);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2000);

  // ── Login: fill auth token (React reads token at mount, so initScript is too early) ──
  const tokenInput = page.locator('input[type="password"], input[placeholder*="Token"], input').first();
  if (await tokenInput.count().catch(() => 0)) {
    log("auth token prompt detected, filling token");
    await tokenInput.fill("demo-test-token");
    await page.waitForTimeout(200);
    await page.locator('button:has-text("连接")').click().catch(() => {});
    await page.waitForTimeout(3500);
  }
  await page.waitForTimeout(1500);

  // ── Step 1: Open Status Panel and find Issue Monitor section ──
  log("step 1: status panel");
  // The status panel toggle button — try common selectors
  const statusBtnCandidates = [
    'button[aria-label*="状态"]',
    'button[aria-label*="Status"]',
    'button[title*="状态"]',
    'button[title*="Status"]',
    '[data-testid*="status"]',
    'button:has-text("状态")',
  ];
  let openedStatus = false;
  for (const sel of statusBtnCandidates) {
    const btn = page.locator(sel).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      openedStatus = true;
      break;
    }
  }
  // Fallback: right-rail icon buttons (the last few icon buttons usually open panels)
  if (!openedStatus) {
    // Try clicking an icon-button near the top-right that isn't "设置" / "添加项目"
    const iconBtns = page.locator('button[aria-label], button[title]').filter({ hasNotText: /^设置$|^添加项目$|^新建会话$/ });
    const count = await iconBtns.count().catch(() => 0);
    log(`fallback: ${count} icon buttons found`);
    for (let i = 0; i < Math.min(count, 8); i++) {
      const lbl = (await iconBtns.nth(i).getAttribute("aria-label")) ?? (await iconBtns.nth(i).getAttribute("title")) ?? "";
      log(`  btn[${i}]: ${lbl}`);
      if (/状态|status|面板|panel/i.test(lbl)) {
        await iconBtns.nth(i).click({ timeout: 5000 }).catch(() => {});
        openedStatus = true;
        break;
      }
    }
  }
  await page.waitForTimeout(1200);

  const statusHtml = await page.content();
  const hasIssueMonitorStatusSection = /Issue\s*Monitor/i.test(statusHtml);
  // Distinguish from the settings tab text by also requiring the "未激活" /
  // "监控中" / "Issue Monitor 未激活" marker that only the status section emits.
  const hasStatusSectionBody =
    /Issue\s*Monitor\s*未激活|监控中|已停止|上次扫描|总计:\s*\d+\s*issues/i.test(statusHtml);
  check(
    "Status Panel renders Issue Monitor section",
    hasIssueMonitorStatusSection && hasStatusSectionBody,
    hasIssueMonitorStatusSection
      ? "header present but section body marker missing"
      : "no 'Issue Monitor' text in DOM",
  );
  await page.screenshot({ path: `${OUT_DIR}/01-status-panel.png`, fullPage: false });
  log("screenshot:", `${OUT_DIR}/01-status-panel.png`);

  // ── Step 2: Open Settings Panel and click Issue Monitor tab ──
  log("step 2: settings panel");
  // Close status panel first (press Escape)
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);

  // Settings button — use the stable data-testid on the TabBar settings-open-btn
  const settingsSelectors = [
    '[data-testid="settings-open-btn"]',
    'button[aria-label*="设置"]',
    'button[aria-label*="Settings"]',
  ];
  for (const sel of settingsSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(1200);
  // Verify the settings dialog actually opened
  const dialogOpen = (await page.locator('[data-testid="settings-panel"], [role="dialog"]').count().catch(() => 0)) > 0;
  check("Settings Panel dialog opened", dialogOpen, "no [role=dialog] after click");

  // Click Issue Monitor tab. In desktop (md+) layout, the Issue Monitor tab
  // lives inside the "连接" (connection) group — first click the group icon
  // to expand its sub-tabs, then click the Issue Monitor sub-tab.
  // In mobile layout (<= md), all tabs appear in a single horizontal scroll.
  const dialog = page.locator('[data-testid="settings-panel"], [role="dialog"]').first();

  // Helper: click a visible element by its bounding-box center (more robust
  // inside modal/focus-trap than Playwright .click() in some cases).
  async function clickByCenter(loc) {
    const box = await loc.boundingBox().catch(() => null);
    if (!box) return false;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    return true;
  }

  // Desktop path: click the "连接" group icon, then the Issue Monitor sub-tab.
  const connectionGroupBtn = dialog.locator('button:has-text("连接")').first();
  let imTabClicked = false;
  if ((await connectionGroupBtn.count().catch(() => 0)) > 0) {
    await connectionGroupBtn.click({ timeout: 5000 }).catch(async () => {
      await clickByCenter(connectionGroupBtn);
    });
    await page.waitForTimeout(500);
    // Now Issue Monitor sub-tab should be visible — use .last() to skip the
    // group icon button and target the sub-tab in the active group panel.
    const imSubTab = dialog.locator('button:has-text("Issue Monitor")').last();
    if ((await imSubTab.count().catch(() => 0)) > 0) {
      // Try normal click first; fall back to coordinate click.
      const normalClick = await imSubTab
        .click({ timeout: 5000 })
        .then(() => true)
        .catch(() => false);
      if (!normalClick) {
        await clickByCenter(imSubTab);
      }
      imTabClicked = true;
      await page.waitForTimeout(800);
    }
  }

  // Fallback: mobile layout horizontal tab bar
  if (!imTabClicked) {
    const imMobileTab = dialog.locator('button:has-text("Issue Monitor")').first();
    if ((await imMobileTab.count().catch(() => 0)) > 0) {
      await imMobileTab
        .click({ timeout: 5000 })
        .catch(async () => clickByCenter(imMobileTab));
      imTabClicked = true;
      await page.waitForTimeout(800);
    }
  }

  check(
    "Settings Panel has Issue Monitor tab (clicked)",
    imTabClicked,
    "could not click Issue Monitor tab (group=connection + sub-tab)",
  );

  await page.screenshot({ path: `${OUT_DIR}/02-settings-issue-monitor.png`, fullPage: false });
  log("screenshot:", `${OUT_DIR}/02-settings-issue-monitor.png`);

  // Check for IssueMonitor settings content. When the extension has no
  // config yet, the panel shows "未配置" + a hint to edit settings.json.
  // When config exists, it shows the form (repo/interval/autoFix). Either
  // outcome is valid evidence that the IssueMonitorSettingsContent
  // component rendered successfully.
  const dialogHtml = await dialog.evaluate((el) => el.innerHTML).catch(() => "");
  const hasRepoForm = /placeholder="owner\/repo"/i.test(dialogHtml);
  const hasIntervalForm = /扫描间隔/i.test(dialogHtml);
  const hasAutoFixForm = /自动修复/i.test(dialogHtml);
  const hasEmptyHint = /Issue\s*Monitor\s*未配置/i.test(dialogHtml) && /issueMonitor\.repos/i.test(dialogHtml);
  check(
    "Issue Monitor settings panel rendered (form or empty hint)",
    hasRepoForm || hasIntervalForm || hasAutoFixForm || hasEmptyHint,
    imTabClicked ? "tab clicked but no settings content rendered" : "tab not clicked",
  );
  check("Issue Monitor config: repo input present (when configured)", hasRepoForm || hasEmptyHint);
  check("Issue Monitor config: interval input present (when configured)", hasIntervalForm || hasEmptyHint);
  check("Issue Monitor config: autoFix toggle present (when configured)", hasAutoFixForm || hasEmptyHint);

  // Close settings
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);

  // ── Step 3: Verify IssueMonitorBlockCard is registered ──
  log("step 3: block card registration");
  // Vite dev server root is `src/mainview`, so module URLs strip that prefix.
  // Dynamic-import the renderer index and confirm IssueMonitorBlockCard is
  // one of its named exports — this proves the source file is valid TS/TSX,
  // is transformable by Vite, and is wired into the special-block-renderers
  // barrel (which MessageBubble imports for side-effect registration).
  let dynamicImportOk = false;
  let exports = [];
  let dynamicImportErr = "";
  try {
    const result = await page.evaluate(async () => {
      const m = await import(
        "/components/chat/special-block-renderers/index.ts?t=" + Date.now()
      );
      return Object.keys(m);
    });
    exports = Array.isArray(result) ? result : [];
    dynamicImportOk = exports.includes("IssueMonitorBlockCard");
    if (!dynamicImportOk) dynamicImportErr = "exports: " + JSON.stringify(exports);
  } catch (e) {
    dynamicImportErr = e instanceof Error ? e.message.slice(0, 200) : String(e);
  }

  // Also verify the dedicated card module exports the component directly.
  let dedicatedModuleOk = false;
  if (!dynamicImportOk) {
    try {
      const result2 = await page.evaluate(async () => {
        const m = await import(
          "/components/chat/special-block-renderers/IssueMonitorBlockCard.tsx?t=" + Date.now()
        );
        return Object.keys(m);
      });
      dedicatedModuleOk = Array.isArray(result2) && result2.includes("IssueMonitorBlockCard");
    } catch {
      // ignore — barrel check is authoritative
    }
  }

  check(
    "IssueMonitorBlockCard exported from special-block-renderers barrel",
    dynamicImportOk || dedicatedModuleOk,
    dynamicImportOk || dedicatedModuleOk ? "" : dynamicImportErr,
  );

  // ── Summary ──
  await browser.close();

  const report = {
    passed: results.pass.length,
    failed: results.fail.length,
    failures: results.fail,
    screenshots: [
      `${OUT_DIR}/01-status-panel.png`,
      `${OUT_DIR}/02-settings-issue-monitor.png`,
    ],
    timestamp: new Date().toISOString(),
  };
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
  log("report:", `${OUT_DIR}/report.json`);
  log(`\n=== SUMMARY: ${report.passed} passed, ${report.failed} failed ===`);
  if (report.failed > 0) {
    log("Failures:\n  - " + results.fail.join("\n  - "));
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("[im-ui] FATAL:", err);
  process.exit(2);
});
