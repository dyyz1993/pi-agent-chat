/**
 * ion 后端浏览器级 E2E —— 真实前端渲染验证（PI_BACKEND=ion 栈）。
 *
 * 前置（run-browser-e2e-ion.sh 已拉起）：隔离 ion host（faux）+ app server(3198) +
 * Vite dev(5175，代理到 3198) + 预种子项目配置。
 * 流程：打开 UI → 新建会话 → 发消息 → faux 流式渲染 → 刷新后历史恢复。
 * 用法：node docs/plans/ion-backend/browser-e2e-ion.mjs
 */

import { chromium } from "playwright";
import { existsSync } from "node:fs";

const PAGE_URL = process.env.BROWSER_E2E_URL ?? "http://localhost:5175/?token=ion-e2e-token";
const FAUX_TEXT = process.env.BROWSER_E2E_FAUX ?? "ion browser faux";
const SHOT_DIR = process.env.BROWSER_E2E_SHOTS ?? "/tmp/ion-browser-e2e";

// 浏览器解析：与 playwright.config.ts 同策略 —— 系统 Chromium 优先（CDN 不可靠），
// 回退缓存里的 chromium-1097 二进制
const EXECUTABLE =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  (existsSync("/Applications/Chromium.app/Contents/MacOS/Chromium")
    ? "/Applications/Chromium.app/Contents/MacOS/Chromium"
    : `${process.env.HOME}/Library/Caches/ms-playwright/chromium-1097/chrome-mac/Chromium.app/Contents/MacOS/Chromium`);

let pass = 0;
let fail = 0;
const ok = (name, cond, detail) => {
  if (cond) {
    pass += 1;
    console.log(`  ok  ${name}`);
  } else {
    fail += 1;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
};

async function main() {
  const browser = await chromium.launch({ headless: true, executablePath: EXECUTABLE });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const consoleErrors = [];
  const pageErrors = [];
  // playwright 驱动此 Chromium 时 console 事件全丢（page.on/CDP 均实测假阴性）——
  // 改用 DOM 桥：init 脚本劫持 console 写入隐藏节点，evaluate 读取
  await page.addInitScript(() => {
    const bridge = document.createElement("div");
    bridge.id = "__e2e_console_bridge";
    bridge.style.display = "none";
    document.addEventListener("DOMContentLoaded", () => document.documentElement.appendChild(bridge));
    const write = (kind, args) => {
      try {
        bridge.dataset.logs = (bridge.dataset.logs ?? "") + kind + "|" + args.join(" ").slice(0, 260) + "\n";
      } catch {}
    };
    const origError = console.error.bind(console);
    const origLog = console.log.bind(console);
    console.error = (...args) => {
      write("error", args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))));
      origError(...args);
    };
    console.log = (...args) => {
      const s = args.map((a) => (typeof a === "string" ? a : "")).join(" ");
      if (s.startsWith("[ws-out-frame]")) write("ws", [s]);
      origLog(...args);
    };
    window.addEventListener("error", (ev) => write("pageerror", [String(ev.message)]));
    window.addEventListener("unhandledrejection", (ev) => write("pageerror", ["rejection:" + String(ev.reason)]));
    write("boot", ["init-ran"]);
    const origSend = WebSocket.prototype.send;
    WebSocket.prototype.send = function (data) {
      try {
        if (typeof data === "string") write("ws", ["[ws-out-frame] " + data.slice(0, 200)]);
        if (!this.__e2eMsgHooked) {
          this.__e2eMsgHooked = true;
          this.addEventListener("message", (ev) => {
            try {
              const s = typeof ev.data === "string" ? ev.data : "";
              if (s.includes("agent.event") || s.includes("session_status")) {
                write("wsin", ["[ws-in-frame] " + s.slice(0, 200)]);
              } else if (s.includes("getFullMessages")) {
                write("resp", ["[getFullMessages-resp] " + s.slice(0, 700)]);
              }
            } catch {}
          });
        }
      } catch {}
      return origSend.apply(this, arguments);
    };
  });

  const readBridgeLogs = () =>
    page.evaluate(() => document.querySelector("#__e2e_console_bridge")?.dataset.logs ?? "");

  // 1. 页面加载
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForSelector("#root", { timeout: 30_000 });
  ok("page root renders", true);

  const input = page.locator('[data-testid="chat-input"]');
  await input.waitFor({ state: "visible", timeout: 60_000 });
  ok("composer visible (project auto-opened)", true);
  await page.screenshot({ path: `${SHOT_DIR}/1-loaded.png` });

  // 2. 新建会话（若按钮可见）
  const newBtn = page.locator('[data-testid="new-session-button"]');
  if (await newBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await newBtn.click();
    ok("new session clicked", true);
  } else {
    ok("new session button (absent → active session reused)", true);
  }
  await input.waitFor({ state: "visible", timeout: 30_000 });

  // 3. 发消息
  await input.fill("browser e2e round");
  await input.press("Enter");
  ok("message sent (Enter)", true);

  // 3b. 发送层诊断：区分 InputBar 门控 / store 守卫 / RPC 未达
  await page.waitForTimeout(2500);
  const diag = await page.evaluate(() => {
    const inputEl = document.querySelector('[data-testid="chat-input"]');
    const sendBtn = document.querySelector('button[aria-label*="Send" i], button[aria-label*="发送"]');
    return {
      inputValue: inputEl instanceof HTMLTextAreaElement ? inputEl.value : null,
      sendBtnDisabled: sendBtn ? sendBtn.hasAttribute("disabled") : null,
      sendBtnExists: Boolean(sendBtn),
      userBubbleInDom: document.body.innerText.includes("browser e2e round"),
    };
  });
  console.log(`  ⚙ send diag: input="${diag.inputValue}" btnDisabled=${diag.sendBtnDisabled} btnExists=${diag.sendBtnExists} userBubble=${diag.userBubbleInDom}`);
  const bridgeLogs = await readBridgeLogs();
  const bridgeLines = bridgeLogs.split("\n").filter(Boolean);
  console.log(`  ⚙ bridge lines=${bridgeLines.length}; ws out=${bridgeLines.filter((l) => l.startsWith("ws|")).length} ws in(agent.event/status)=${bridgeLines.filter((l) => l.startsWith("wsin|")).length}`);
  const wsin = bridgeLines.filter((l) => l.startsWith("wsin|"));
  console.log(`  ⚙ ws-in samples:\n    ${wsin.slice(0, 6).join("\n    ")}`);
  const bodyText = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 900));
  console.log(`  ⚙ body text:\n${bodyText}`);
  await page.screenshot({ path: `${SHOT_DIR}/2-sent.png` });

  // 4. faux 流式回复渲染
  const reply = page.getByText(FAUX_TEXT, { exact: false }).first();
  const gotReply = await reply
    .waitFor({ state: "visible", timeout: 45_000 })
    .then(() => true)
    .catch(() => false);
  ok("faux streaming reply rendered", gotReply);
  await page.waitForTimeout(2000); // 等 agent_end 收尾
  await page.screenshot({ path: `${SHOT_DIR}/3-replied.png`, fullPage: false });

  // 4b. 回复等待期结束后的终态诊断（排队 turn 可能延迟启动，早前的 diag 抓不到）
  {
    const bridgeLogs = await readBridgeLogs();
    const wsin = bridgeLogs.split("\n").filter((l) => l.startsWith("wsin|"));
    const updateCount = wsin.filter((l) => l.includes("message_update")).length;
    const startCount = wsin.filter((l) => l.includes("agent_start")).length;
    console.log(`  ⚙ final: ws-in events=${wsin.length} agent_start=${startCount} message_update=${updateCount}`);
    const bodyText = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, "\n").slice(0, 500));
    console.log(`  ⚙ final body:\n${bodyText}`);
  }

  // 5. 刷新恢复
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="chat-input"]', { timeout: 60_000 });
  const replyAfterReload = page.getByText(FAUX_TEXT, { exact: false }).first();
  const gotHistory = await replyAfterReload
    .waitFor({ state: "visible", timeout: 30_000 })
    .then(() => true)
    .catch(() => false);
  ok("history restored after reload", gotHistory);
  await page.screenshot({ path: `${SHOT_DIR}/4-reloaded.png` });

  // 5c. 壳模式显隐：ion 下 Learning/Goal 等 tab 消失，审核/Git/状态等壳 tab 仍在
  {
    // tab 按钮窄态用 title、展开态用 textContent —— 两者都查
    const rail = await page.evaluate(() => {
      const buttons = [...document.querySelectorAll('[data-testid="right-sidebar"] button')];
      const labels = buttons.map((b) => `${b.getAttribute("title") ?? ""} ${b.textContent ?? ""}`);
      return {
        learningBtn: labels.some((t) => t.includes("Learning")),
        changeReviewBtn: labels.some((t) => t.includes("审核")),
        goalBtn: labels.some((t) => t.includes("Goal")),
        gitBtn: labels.some((t) => t.includes("Git")),
      };
    });
    ok("shell gating: Learning hidden (unmapped plugin)", !rail.learningBtn, JSON.stringify(rail));
    ok("shell gating: change-review visible (available plugin)", rail.changeReviewBtn, JSON.stringify(rail));
    ok("shell gating: Goal hidden, Git (shell) visible", !rail.goalBtn && rail.gitBtn, JSON.stringify(rail));
  }

  // 6. 会话列表可见性（侧栏有会话项）
  await page.waitForTimeout(1500);
  const sessionItems = await page
    .locator('[data-testid="session-list-item"], [data-testid*="session-item"]')
    .count();
  ok("session list has items", sessionItems > 0, `count=${sessionItems}`);

  // 控制台错误（诊断输出，不单独判失败——由核心断言决定）
  if (consoleErrors.length || pageErrors.length) {
    console.log(`  ⚠ console errors: ${consoleErrors.length}, page errors: ${pageErrors.length}`);
    for (const e of [...consoleErrors.slice(0, 5), ...pageErrors.slice(0, 3)]) {
      console.log(`    · ${e}`);
    }
  }

  await browser.close();
  console.log(`\nBROWSER E2E RESULT: ${pass} pass / ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("BROWSER E2E ERROR:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
