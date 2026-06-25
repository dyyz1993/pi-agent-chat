import { describe, expect, it } from "vitest";
import { aggregateUsageEntries } from "../../../src/shared/lib/usage-aggregator";

const now = Date.parse("2026-06-25T12:00:00+08:00");

function entry(sessionId: string, value: unknown) {
  return { sessionId, value };
}

describe("usage aggregator", () => {
  it("summarizes tokens, tools, memory, skills, hooks, and streaks from JSONL entries", () => {
    const stats = aggregateUsageEntries(
      [
        entry("s1", {
          type: "message",
          timestamp: "2026-06-24T10:00:00+08:00",
          message: { role: "user", timestamp: "2026-06-24T10:00:00+08:00", content: "hi" },
        }),
        entry("s1", {
          type: "message",
          timestamp: "2026-06-24T10:01:00+08:00",
          message: {
            role: "assistant",
            timestamp: "2026-06-24T10:01:00+08:00",
            provider: "openai",
            model: "gpt-test",
            usage: { input: 100, output: 50, cacheRead: 20, cacheWrite: 10, cost: { total: 0.01 } },
            content: [
              { type: "toolCall", name: "mcp__web__search" },
              { type: "text", text: '<skill name="pi-fullstack-debug"></skill>' },
            ],
          },
        }),
        entry("s1", {
          type: "custom",
          customType: "memory_prefetch_result",
          timestamp: "2026-06-24T10:02:00+08:00",
          data: { selectedFiles: ["a.md", "b.md"] },
        }),
        entry("s2", {
          type: "custom",
          customType: "memory_created",
          timestamp: "2026-06-25T09:00:00+08:00",
          data: {},
        }),
        entry("s2", {
          type: "custom",
          customType: "hook_block",
          timestamp: "2026-06-25T09:01:00+08:00",
          data: { decision: "block" },
        }),
        entry("s2", {
          type: "custom",
          customType: "skill_usage",
          timestamp: "2026-06-25T09:02:00+08:00",
          data: { skillName: "agent-test-harness" },
        }),
        entry("s2", {
          type: "message",
          timestamp: "2026-06-25T09:03:00+08:00",
          message: {
            role: "assistant",
            timestamp: "2026-06-25T09:03:00+08:00",
            provider: "openai",
            model: "gpt-mini",
            usage: { input: 10, output: 5 },
          },
        }),
        entry("old", {
          type: "message",
          timestamp: "2026-05-01T09:00:00+08:00",
          message: {
            role: "assistant",
            timestamp: "2026-05-01T09:00:00+08:00",
            usage: { input: 999 },
          },
        }),
      ],
      { projectPath: "/tmp/project", range: "7d", now, scannedSessionFiles: 3 },
    );

    expect(stats.totals.tokens).toBe(195);
    expect(stats.totals.sessions).toBe(2);
    expect(stats.totals.messages).toBe(3);
    expect(stats.totals.userMessages).toBe(1);
    expect(stats.totals.assistantMessages).toBe(2);
    expect(stats.totals.toolCalls).toBe(1);
    expect(stats.totals.mcpCalls).toBe(1);
    expect(stats.totals.memoryHits).toBe(2);
    expect(stats.totals.memoryWrites).toBe(1);
    expect(stats.totals.skillHits).toBe(2);
    expect(stats.totals.hookBlocks).toBe(1);
    expect(stats.totals.currentStreak).toBe(2);
    expect(stats.daily).toHaveLength(7);
    expect(stats.topModels[0]).toMatchObject({ model: "gpt-test", tokens: 180 });
    expect(stats.topModels[1]).toMatchObject({ model: "gpt-mini", tokens: 15 });
    expect(stats.daily.at(-2)?.models).toEqual([
      { provider: "openai", model: "gpt-test", tokens: 180, calls: 1 },
    ]);
    expect(stats.daily.at(-1)?.models).toEqual([
      { provider: "openai", model: "gpt-mini", tokens: 15, calls: 1 },
    ]);
    expect(stats.topMcpTools[0]).toMatchObject({ server: "web", tool: "search", calls: 1 });
    expect(stats.topSkills.map((item) => item.name)).toEqual([
      "pi-fullstack-debug",
      "agent-test-harness",
    ]);
  });
});
