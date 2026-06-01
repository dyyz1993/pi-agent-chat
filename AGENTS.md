# Project: pi-agent-chat

AI-powered coding agent with chat interface. Runs on macOS (Electrobun), web, and mobile browsers. Built with React 18 + TypeScript + Vite + Tailwind CSS + Zustand.

## Source Code Dependency (pi-coding-agent)

The core agent runtime (`@dyyz1993/pi-coding-agent`) is linked via **yalc** from a local fork:

- **Fork path**: `/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/`
- **package.json**: `"@dyyz1993/pi-coding-agent": "file:.yalc/@dyyz1993/pi-coding-agent"`
- **How to update**:
  1. Edit source in `pi-momo-fork/packages/coding-agent/src/`
  2. Build: `cd pi-momo-fork/packages/coding-agent && npm run build`
  3. Push: `cd pi-momo-fork/packages/coding-agent && yalc push`
  4. This updates `pi-agent-chat/.yalc/` and `node_modules/` automatically
- **IMPORTANT**: Never manually edit `node_modules/@dyyz1993/pi-coding-agent/dist/` — changes will be lost on next `yalc push` or `npm install`. Always edit the fork source and rebuild.

## Theme & Design System

### Token Location

All design tokens are defined as CSS custom properties in `src/mainview/index.css` under `:root` (light) and `html.dark` (dark).

### Token Categories

| Category   | Prefix                               | Example                                          |
| ---------- | ------------------------------------ | ------------------------------------------------ |
| Background | `--color-bg-*`                       | `--color-bg-primary`, `--color-bg-elevated`      |
| Text       | `--color-text-*`                     | `--color-text-primary`, `--color-text-secondary` |
| Border     | `--color-border-*`                   | `--color-border-primary`, `--color-border-focus` |
| Accent     | `--color-accent*`                    | `--color-accent`, `--color-accent-muted`         |
| Status     | `--color-success/warning/error/info` | `--color-success`                                |
| Safe Area  | `--safe-area-*`                      | `--safe-area-top`, `--safe-area-bottom`          |
| Spacing    | `--spacing-*`                        | `--spacing-sm`, `--spacing-lg`                   |
| Radius     | `--radius-*`                         | `--radius-sm`, `--radius-xl`                     |
| Shadow     | `--shadow-*`                         | `--shadow-sm`, `--shadow-lg`                     |
| Z-index    | `--z-*`                              | `--z-overlay`, `--z-modal`                       |
| Touch      | `--touch-target-min`                 | `44px` (Apple HIG minimum)                       |
| Transition | `--transition-*`                     | `--transition-fast`, `--transition-normal`       |

### Theme Store

`src/mainview/stores/use-theme-store.ts` — Manages `light`/`dark`/`system` mode, toggles `dark`/`light` class on `<html>`, persisted to localStorage key `pi-theme`.

### Tailwind Integration

`tailwind.config.js` extends spacing with `safe-top`, `safe-bottom`, `safe-left`, `safe-right` using CSS variables. Use `p-safe-top`, `m-safe-bottom` etc. in Tailwind classes.

## Responsive Design

### Breakpoints

| Name    | Width       | Store              |
| ------- | ----------- | ------------------ |
| mobile  | < 640px     | `use-layout-store` |
| tablet  | 640–1024px  | `use-layout-store` |
| desktop | 1024–1440px | `use-layout-store` |
| wide    | >= 1440px   | `use-layout-store` |

### Mobile Conventions

- Sidebars become 85% width overlays with `bg-black/50` backdrop
- Pin/collapse buttons hidden (`max-sm:hidden`)
- QuickActionToolbar only renders on mobile/tablet
- Tab close buttons always visible on mobile (no hover needed)
- Touch targets minimum 44px on all interactive elements
- `viewport-fit=cover` is set, so `env(safe-area-inset-*)` works

### Safe-Area Rules for Fullscreen Overlays

ALL `fixed inset-0` fullscreen components MUST:

1. Add `paddingTop: "calc(<base-padding>rem + env(safe-area-inset-top, 0px))"` on the header
2. Add `paddingBottom: "env(safe-area-inset-bottom, 0px)"` on the container or footer
3. Close buttons must be minimum 44px touch target (`p-2` + `w-4 h-4` icon = ~40px)
4. Every fullscreen page MUST have a visible close/exit button

Files that implement this pattern:

- `src/mainview/components/tab-bar/TabBar.tsx` — top safe-area
- `src/mainview/components/chat/ChatPanel.tsx` — bottom safe-area
- `src/mainview/components/bash-panel/BashPanel.tsx` — both
- `src/mainview/components/chat/preview/UrlCard.tsx` — fullscreen header
- `src/mainview/components/chat/preview/HtmlCard.tsx` — fullscreen header
- `src/mainview/components/chat/preview/PdfCard.tsx` — fullscreen header
- `src/mainview/components/chat/mermaid/MermaidFullscreen.tsx` — fullscreen header
- `src/mainview/components/project-picker/ProjectPickerDialog.tsx` — mobile view

## Project Structure

```
src/mainview/
  index.css              # Design tokens + global styles
  layouts/               # MainLayout, breakpoint logic
  components/
    tab-bar/             # Top project tabs
    chat/                # Chat UI, messages, previews
    left-sidebar/        # Session list
    right-sidebar/       # Status panel
    project-picker/      # Project selection dialog
    bash-panel/          # Terminal output
    settings/            # Settings modal
    diff/                # Diff viewer
    file-preview/        # File preview overlay
  stores/                # Zustand stores (28 files)
  hooks/                 # Custom hooks
  lib/                   # API client, i18n, logger
```

## Testing

- Unit: `vitest` + `@testing-library/react`
- E2E: `@playwright/test` with `workers: 3`, `headless: true`
- Config: `vitest.config.ts`, `playwright.config.ts`

## Architecture Design Docs

| 文档                                                        | 状态             | 说明                                                                        |
| ----------------------------------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `docs/plans/2026-06-01-process-per-session-design.md`       | Phase 1 已完成   | 每会话独立 CLI 进程，LRU 淘汰，全局进程池                                   |
| `docs/plans/2026-06-01-session-switch-experience-design.md` | Phase 1-3 已实施 | 会话切换体验优化：热/冷切换分流、fetchInitialState 缓存、MessageList 无闪烁 |
| `docs/plans/2026-06-01-render-cache-design.md`              | 已实施           | 渲染层按 session 缓存：processedMessages/cardMeta/flatItems/messageIds      |

### WebSocket RPC 端到端测试方法

通过 WebSocket 直接调用 RPC API，对真实 dev server 做端到端验证。适用于验证 Agent 会话行为、回滚、消息过滤等涉及前后端+CLI 进程的完整链路。

**前提条件**：

- Dev server 已启动（`bun run dev:web`），默认端口 3100
- `node_modules` 中有 `ws` 包（项目已安装）
- AUTH_TOKEN 配置在 `.env` 中（默认 `demo-test-token`）

**核心 RPC 方法**：

| 方法                    | 参数                                      | 用途                                          |
| ----------------------- | ----------------------------------------- | --------------------------------------------- |
| `session.create`        | `{ projectPath }`                         | 创建新会话，返回 `{ sessionId, sessionPath }` |
| `agent.start`           | `{ sessionId, projectPath, sessionPath }` | 启动 Agent 进程（必须先调才能发消息）         |
| `agent.send`            | `{ sessionId, content }`                  | 发送用户消息                                  |
| `agent.stop`            | `{ sessionId }`                           | 停止 Agent 进程（确保 JSONL 写完）            |
| `agent.getFullMessages` | `{ sessionId, sessionPath }`              | 获取当前分支的过滤后消息                      |
| `agent.navigateTree`    | `{ sessionId, targetId, summarize }`      | 回滚到指定 entry                              |
| `agent.getTree`         | `{ sessionId }`                           | 获取会话树结构                                |

**测试脚本模板**：

```javascript
// e2e-test.mjs — 放在项目根目录，用 node e2e-test.mjs 运行
import WebSocket from "ws";
import { execSync } from "child_process";
import { readFileSync } from "fs";

const WS_URL = "ws://localhost:3100/ws?token=demo-test-token";
const CWD = `/tmp/e2e-test-${Date.now()}`;
execSync(`mkdir -p ${CWD}`);

let msgId = 0;
const pending = new Map();

function wsConnect() {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL);
    ws.on("message", (data) => {
      const msg = JSON.parse(data.toString());
      // 路由 RPC response 到对应的 pending promise
      if (msg.id && pending.has(msg.id)) {
        pending.get(msg.id)(msg);
        pending.delete(msg.id);
      }
    });
    ws.on("open", () => resolve(ws));
    setTimeout(() => reject(new Error("connect timeout")), 10000);
  });
}

function rpc(ws, method, params, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const id = `test-${++msgId}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${method} timeout`));
    }, timeout);
    pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    ws.send(JSON.stringify({ type: "request", id, method, params }));
  });
}

// 轮询等待消息数变化（因为 agent.send 不返回完成信号）
async function waitForMessages(ws, sid, sp, minCount, timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const res = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
    const msgs = res.result?.messages || [];
    if (msgs.length >= minCount) return msgs;
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(`timeout: expected >= ${minCount} messages`);
}

// 读取 JSONL 中的 entry IDs（用于定位回滚目标）
function getMessageEntryIds(sessionPath) {
  const lines = readFileSync(sessionPath, "utf-8").trim().split("\n");
  return lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((e) => e?.type === "message")
    .map((e) => ({ id: e.id, role: e.message?.role, parentId: e.parentId }));
}

// === 使用示例 ===
async function main() {
  const ws = await wsConnect();

  // 1. 创建会话 + 启动 Agent
  const sr = await rpc(ws, "session.create", { projectPath: CWD });
  const sid = sr.result.sessionId;
  const sp = sr.result.sessionPath;
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });

  // 2. 发消息 + 等待回复
  await rpc(ws, "agent.send", { sessionId: sid, content: "你好" });
  await waitForMessages(ws, sid, sp, 2); // user + assistant

  // 3. 停止 Agent（确保 JSONL 写完）
  await rpc(ws, "agent.stop", { sessionId: sid });

  // 4. 读 JSONL 找回滚目标
  const entries = getMessageEntryIds(sp);
  const firstAssistant = entries.find((e) => e.role === "assistant");

  // 5. 重启 Agent + 回滚
  await rpc(ws, "agent.start", { sessionId: sid, projectPath: CWD, sessionPath: sp });
  await rpc(ws, "agent.navigateTree", {
    sessionId: sid,
    targetId: firstAssistant.id,
    summarize: false,
  });

  // 6. 验证回滚后的消息
  const msgs = await rpc(ws, "agent.getFullMessages", { sessionId: sid, sessionPath: sp });
  console.log("Messages after rollback:", msgs.result?.messages?.length);

  // 7. 检查 JSONL 中的 leaf_pointer
  const jsonl = readFileSync(sp, "utf-8");
  const leafPointers = jsonl
    .trim()
    .split("\n")
    .filter((l) => l.includes('"type":"leaf_pointer"'));
  console.log("leaf_pointer entries:", leafPointers.length);

  ws.close();
}

main().catch(console.error);
```

**注意事项**：

- `agent.send` 不阻塞等待完成，需要用 `waitForMessages` 轮询消息数变化
- 回滚前先 `agent.stop` 确保 JSONL 写完，再读 entry IDs 定位目标，再 `agent.start` 后调 `navigateTree`
- LLM 响应时间不确定，轮询 timeout 建议 60-90 秒
- 脚本放在项目根目录运行（`node e2e-test.mjs`），因为需要 `ws` 依赖
- 测试完清理临时目录：`rm -rf /tmp/e2e-test-*`

**典型验证场景**：

1. **回滚消息过滤**：发 A → 发 B → 回滚到 A → 验证只有 A 的消息
2. **回滚后继续对话**：回滚后发新消息 → 验证 LLM 上下文正确
3. **多次回滚**：A → B → 回滚到 A → C → 回滚到中间 → 验证消息树
4. **JSONL 持久化**：回滚后检查 leaf_pointer 是否写入、entry 是否正确
5. **重启恢复**：回滚 → 停止进程 → 重新 agent.start → 验证消息状态恢复

## Code Style

- No `any` type, use `unknown` with narrowing
- No `/* eslint-disable */` comments — fix the root cause
- Use `createLogger` from `src/shared/lib/logger.ts` instead of `console.log`
- Function components only, hooks prefixed with `use`
- Tailwind utility classes for styling, design tokens for theming
