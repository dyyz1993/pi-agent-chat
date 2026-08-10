/**
 * UI screenshot verification for issue-monitor UI (v2 — config in StatusPanel):
 *   1. Status Panel — Issue Monitor section with status + inline config form
 *   2. Settings Panel — Issue Monitor tab should be REMOVED
 *   3. IssueMonitorBlockCard barrel export
 *
 * Run: node scripts/ui-screenshot-issue-monitor.mjs
 */
import { chromium } from "playwright";
import { writeFileSync, mkdirSync } from "node:fs";

const OUT_DIR = "/tmp/im-ui-shots-v2";
mkdirSync(OUT_DIR, { recursive: true });

const CHROMIUM_PATH =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  "/Users/xuyingzhou/Downloads/Chromium.app/Contents/MacOS/Chromium";

const BASE = "http://localhost:5173";

function log(...args) { console.log("[im-ui]", ...args); }

const results = { pass: [], fail: [] };
function check(name, ok, detail = "") {
  if (ok) { results.pass.push(name); log(`✅ ${name}`); }
  else { results.fail.push(`${name}${detail ? ` — ${detail}` : ""}`); log(`❌ ${name}${detail ? ` — ${detail}` : ""}`); }
}

async function clickByCenter(page, loc) {
  const box = await loc.boundingBox().catch(() => null);
  if (!box) return false;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  return true;
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
  const page = await context.newPage();
  page.on("pageerror", (err) => log("pageerror:", err.message.slice(0, 200)));

  log("navigating to", BASE);
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 20000 });
  await page.waitForTimeout(2000);

  // Login
  const tokenInput = page.locator('input[type="password"], input[placeholder*="Token"], input').first();
  if (await tokenInput.count().catch(() => 0)) {
    log("auth token prompt detected, filling token");
    await tokenInput.fill("demo-test-token");
    await page.waitForTimeout(200);
    await page.locator('button:has-text("连接")').click().catch(() => {});
    await page.waitForTimeout(3500);
  }
  await page.waitForTimeout(1000);

  // ── Step 1: Open Status Panel, expand Issue Monitor section ──
  log("step 1: status panel issue-monitor section (status + config)");
  const statusSelectors = [
    'button[aria-label*="状态"]',
    'button[aria-label*="Status"]',
    'button[title*="状态"]',
    'button[title*="Status"]',
  ];
  for (const sel of statusSelectors) {
    const btn = page.locator(sel).first();
    if (await btn.count().catch(() => 0)) {
      await btn.click({ timeout: 5000 }).catch(() => {});
      break;
    }
  }
  await page.waitForTimeout(1200);

  const pageHtml = await page.content();
  const hasImSection = /Issue\s*Monitor/i.test(pageHtml);
  const hasStatusBody = /监控中|已停止|Issue\s*Monitor\s*未激活|上次扫描/i.test(pageHtml);
  check("Status Panel: Issue Monitor section header + status", hasImSection && hasStatusBody);

  // Check for inline config section. When no agent session is active (the
  // test session has no running agent), the config RPC returns an error and
  // the section shows a fallback message — that's the correct behavior.
  // When an agent IS running, the full form (repo input, interval, autoFix,
  // branchPrefix) renders instead.
  const hasConfigLabel = /配置/.test(pageHtml);
  const hasConfigForm =
    /placeholder="owner\/repo"/i.test(pageHtml) &&
    /扫描间隔/.test(pageHtml) &&
    /自动修复/.test(pageHtml) &&
    /分支前缀/.test(pageHtml);
  const hasConfigFallback = /无法加载配置|加载配置中/.test(pageHtml);
  check("Status Panel: inline config section present", hasConfigLabel);
  check(
    "Status Panel: config form renders OR fallback shows (depends on agent)",
    hasConfigForm || hasConfigFallback,
    hasConfigForm ? "(form visible — agent running)" : "(fallback visible — no agent session)",
  );

  await page.screenshot({ path: `${OUT_DIR}/01-status-panel-with-config.png`, fullPage: false });
  log("screenshot:", `${OUT_DIR}/01-status-panel-with-config.png`);

  // ── Step 2: Open Settings Panel — Issue Monitor tab should NOT exist ──
  log("step 2: settings panel — issue-monitor tab removed");
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('[data-testid="settings-open-btn"]').first().click().catch(() => {});
  await page.waitForTimeout(1200);

  const dialog = page.locator('[data-testid="settings-panel"], [role="dialog"]').first();
  const dialogOpen = (await dialog.count().catch(() => 0)) > 0;
  check("Settings Panel dialog opens", dialogOpen);

  if (dialogOpen) {
    // Click "连接" group to expand
    await dialog.locator('button:has-text("连接")').first().click().catch(() => {});
    await page.waitForTimeout(500);
    const dialogHtml = await dialog.evaluate((el) => el.innerHTML).catch(() => "");
    const hasImTabInSettings = /Issue\s*Monitor/i.test(dialogHtml);
    check("Settings Panel: Issue Monitor tab REMOVED", !hasImTabInSettings,
      hasImTabInSettings ? "tab still found in settings dialog" : "");
  }

  await page.screenshot({ path: `${OUT_DIR}/02-settings-no-im-tab.png`, fullPage: false });
  log("screenshot:", `${OUT_DIR}/02-settings-no-im-tab.png`);

  await page.keyboard.press("Escape").catch(() => {});

  // ── Step 3: IssueMonitorBlockCard barrel export ──
  log("step 3: block card barrel export");
  let barrelOk = false;
  try {
    const exports = await page.evaluate(async () => {
      const m = await import("/components/chat/special-block-renderers/index.ts?t=" + Date.now());
      return Object.keys(m);
    });
    barrelOk = Array.isArray(exports) && exports.includes("IssueMonitorBlockCard");
  } catch (e) {
    log("barrel import error:", e.message.slice(0, 150));
  }
  check("IssueMonitorBlockCard exported from barrel", barrelOk);

  await browser.close();

  const report = {
    passed: results.pass.length,
    failed: results.fail.length,
    failures: results.fail,
    screenshots: [
      `${OUT_DIR}/01-status-panel-with-config.png`,
      `${OUT_DIR}/02-settings-no-im-tab.png`,
    ],
    timestamp: new Date().toISOString(),
  };
  writeFileSync(`${OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
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
