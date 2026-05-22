/**
 * Stale ctx fix verification — validates ALL fixes across the codebase.
 *
 * Uses grep-style source search instead of fragile string slicing.
 */
import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../pi-momo-fork/packages/coding-agent");

function read(rel: string): string {
  return fs.readFileSync(path.join(ROOT, rel), "utf-8");
}

function hasStaleGuard(src: string, marker: string): boolean {
  const idx = src.indexOf(marker);
  if (idx === -1) return false;
  // Look 1500 chars ahead for a stale check (handler bodies can be long)
  return src.slice(idx, idx + 1500).includes("stale");
}

describe("Stale ctx fix verification — all fixes", () => {
  // ── Core infrastructure ──

  it("Fix 1: agent-session reload flushes channels", () => {
    const src = read("src/core/agent-session.ts");
    const reload = src.slice(
      src.indexOf("async reload()"),
      src.indexOf(
        "// =========================================================================",
        src.indexOf("async reload()"),
      ),
    );
    expect(reload).toContain("flushPendingChannels");
    expect(reload).toContain("updateRegisterChannel");
  });

  it("Fix 2: rpc-mode reload re-subscribes events", () => {
    const src = read("src/modes/rpc/rpc-mode.ts");
    const reload = src.slice(
      src.indexOf('case "reload"'),
      src.indexOf("}", src.indexOf('case "reload"') + 300),
    );
    expect(reload).toContain("unsubscribe?.()");
    expect(reload).toContain("session.subscribe");
  });

  // ── Extension-level ──

  it("Fix 3: coordinator message_received stale catch", () => {
    const src = read("extensions/coordinator/index.ts");
    expect(src).toContain('client.on("message_received"');
    expect(hasStaleGuard(src, 'client.on("message_received"')).toBe(true);
  });

  it("Fix 4: auto-memory retry loop stale check", () => {
    const src = read("extensions/auto-memory/index.ts");
    const retry = src.slice(
      src.indexOf("callLLMWithRetry"),
      src.indexOf("bookmarkCreator.registerTool"),
    );
    expect(retry).toContain("/stale/i.test(msg)");
  });

  it("Fix 5: auto-memory agent_end IIFE stale catch", () => {
    const src = read("extensions/auto-memory/index.ts");
    const section = src.slice(
      src.indexOf('pi.on("agent_end"'),
      src.indexOf('pi.on("session_shutdown"'),
    );
    expect(section).toContain("/stale/i.test(msg)");
  });

  it("Fix 6: subagent-v2 delegates via coordinator channel (stale guard moved to coordinator)", () => {
    const src = read("extensions/subagent-v2/index.ts");
    expect(src).toContain("coordinatorClient.call");
    expect(src).toContain("catch (err)");
  });

  it("Fix 7: message-bridge ctx.respondUI stale catch", () => {
    const src = read("extensions/message-bridge/index.ts");
    // At least 4 .then() callbacks with stale guard
    const staleGuards = (src.match(/stale\/i\.test\(e instanceof Error \? e\.message/g) || [])
      .length;
    expect(staleGuards).toBeGreaterThanOrEqual(4);
  });

  it("Fix 8: session-supervisor scheduleContinue stale catch", () => {
    const src = read("extensions/session-supervisor/index.ts");
    expect(hasStaleGuard(src, "pi.sendMessage(")).toBe(true);
    // Verify the specific pattern
    const schedule = src.slice(
      src.indexOf("pi.background(async (signal)"),
      src.indexOf("function getActiveGuards"),
    );
    expect(schedule).toContain("/stale|abort/i.test(msg)");
  });

  it("Fix 9: bash-ext background exit/crash stale check", () => {
    const src = read("extensions/bash-ext/index.ts");
    // Two occurrences of stale check in background notification
    const matches = src.match(/msg\.includes\("stale"\)/g);
    expect(matches?.length).toBeGreaterThanOrEqual(2);
  });

  it("Fix 10: claude-hooks-compat async hook stale catch", () => {
    const src = read("extensions/claude-hooks-compat/index.ts");
    expect(hasStaleGuard(src, "isAsync && hookEventName")).toBe(true);
  });

  it("Fix 11: lsp diagnostics stale catch", () => {
    const src = read("extensions/lsp/index.ts");
    expect(hasStaleGuard(src, "lsp_diagnostics")).toBe(true);
  });
});
