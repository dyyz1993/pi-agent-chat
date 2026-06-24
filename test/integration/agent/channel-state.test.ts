/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  applyBashBackgroundToolState,
  buildLspLogData,
  createLearningBroadcast,
  createMemoryBroadcast,
  deriveLspState,
} from "../../../src/shared/agent/agent-channel-state";
import type { BashChannelEvent } from "../../../src/shared/modules/bash";
import type { LspChannelEvent } from "../../../src/shared/modules/lsp";

function bashEvent(type: BashChannelEvent["type"], toolCallId?: string): BashChannelEvent {
  return { type, toolCallId, timestamp: 1 };
}

describe("agent channel state helpers", () => {
  it("tracks background bash tools until terminal events arrive", () => {
    const active = new Set<string>();

    applyBashBackgroundToolState(active, bashEvent("background", "tool-1"));
    expect([...active]).toEqual(["tool-1"]);

    applyBashBackgroundToolState(active, bashEvent("output", "tool-1"));
    expect([...active]).toEqual(["tool-1"]);

    applyBashBackgroundToolState(active, bashEvent("terminated", "tool-1"));
    expect([...active]).toEqual([]);
  });

  it("builds compact LSP log data and aggregate state", () => {
    const data: LspChannelEvent = {
      event: "status_changed",
      timestamp: 1,
      servers: [
        { name: "ts", state: "starting", reason: "boot" },
        { name: "eslint", state: "ready", reason: "ok" },
      ],
      diagnostics: { "a.ts": [{ line: 1 }] },
      languages: ["ts"],
      mode: "edit_write",
    };

    expect(buildLspLogData("sess-1", data)).toEqual({
      sessionId: "sess-1",
      event: "status_changed",
      serverCount: 2,
      diagnosticsCount: 1,
      languages: ["ts"],
      mode: "edit_write",
      aggregateState: "ready",
    });
  });

  it("derives LSP cached state and preserves active languages across status changes", () => {
    const current = { state: "ready", servers: [], activeLanguages: ["ts"] };

    const next = deriveLspState(current, {
      event: "status_changed",
      timestamp: 1,
      servers: [{ name: "eslint", state: "error", reason: "missing config" }],
    });

    expect(next).toEqual({
      state: "error",
      servers: [{ name: "eslint", state: "error", reason: "missing config" }],
      activeLanguages: ["ts"],
    });
  });

  it("updates LSP mode and deduplicates activated languages", () => {
    const withMode = deriveLspState(
      { state: "ready", servers: [], activeLanguages: ["ts"] },
      { event: "mode_changed", timestamp: 1, mode: "agent_end" },
    );

    expect(withMode).toEqual({
      state: "ready",
      servers: [],
      activeLanguages: ["ts"],
      mode: "agent_end",
    });

    const withLanguages = deriveLspState(withMode, {
      event: "language_activated",
      timestamp: 2,
      languages: ["ts", "tsx"],
    });

    expect(withLanguages?.activeLanguages).toEqual(["ts", "tsx"]);
  });

  it("maps memory channel events to broadcast names and payloads", () => {
    expect(
      createMemoryBroadcast(
        "sess-1",
        { type: "memory_updated", files: ["MEMORY.md"] },
        123,
      ),
    ).toEqual({
      name: "memory.updated",
      payload: { sessionId: "sess-1", files: ["MEMORY.md"], timestamp: 123 },
    });

    expect(
      createMemoryBroadcast("sess-1", { type: "memory_prefetch_result", ok: true }, 456),
    ).toEqual({
      name: "memory.memory_prefetch_result",
      payload: { sessionId: "sess-1", type: "memory_prefetch_result", ok: true, timestamp: 456 },
    });

    expect(createMemoryBroadcast("sess-1", { type: "unknown" }, 789)).toBeNull();
  });

  it("maps learning channel events to broadcast names and payloads", () => {
    const snapshot = { version: 1, overview: { pendingCandidates: 1 } };
    const run = { id: "run-1", status: "completed" };
    const candidate = { id: "candidate-1", status: "pending" };

    expect(
      createLearningBroadcast("sess-1", { type: "learning.snapshot", snapshot }, 123),
    ).toEqual({
      name: "learning.snapshot",
      payload: { sessionId: "sess-1", snapshot, timestamp: 123 },
    });
    expect(createLearningBroadcast("sess-1", { type: "learning.run", run }, 456)).toEqual({
      name: "learning.run",
      payload: { sessionId: "sess-1", run, timestamp: 456 },
    });
    expect(
      createLearningBroadcast("sess-1", { type: "learning.candidate", candidate }, 789),
    ).toEqual({
      name: "learning.candidate",
      payload: { sessionId: "sess-1", candidate, timestamp: 789 },
    });
    expect(createLearningBroadcast("sess-1", { type: "unknown" }, 111)).toBeNull();
  });
});
