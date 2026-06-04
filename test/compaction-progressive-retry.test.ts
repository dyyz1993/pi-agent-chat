import { describe, it, expect } from "vitest";
import path from "node:path";
import { existsSync } from "node:fs";

const compactionPath = path.resolve(
  process.cwd(),
  ".yalc/@dyyz1993/pi-coding-agent/dist/core/compaction/compaction.js",
);
const piAiEntryPath = path.resolve(process.cwd(), "node_modules/@dyyz1993/pi-ai/dist/index.js");
const HAS_COMPACTION_DEPS = existsSync(compactionPath) && existsSync(piAiEntryPath);
const compactionModule = HAS_COMPACTION_DEPS
  ? await import(`file://${compactionPath}`)
  : {
      findCutPoint: undefined,
      prepareCompaction: undefined,
      estimateTokens: undefined,
      shouldCompact: undefined,
      estimateContextTokens: undefined,
      DEFAULT_COMPACTION_SETTINGS: undefined,
    };
const {
  findCutPoint,
  prepareCompaction,
  estimateTokens,
  shouldCompact,
  estimateContextTokens,
  DEFAULT_COMPACTION_SETTINGS,
} = compactionModule as {
  findCutPoint: (entries: unknown[], start: number, end: number, keepTokens: number) => {
    firstKeptEntryIndex: number;
  };
  prepareCompaction: (...args: unknown[]) => unknown;
  estimateTokens: (message: unknown) => number;
  shouldCompact: (...args: unknown[]) => boolean;
  estimateContextTokens: (...args: unknown[]) => number;
  DEFAULT_COMPACTION_SETTINGS: { keepRecentTokens: number };
};

function makeMessageEntry(role: string, text: string, id: string, parentId: string) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: Date.now(),
    message: {
      role,
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  };
}

function makeToolResultEntry(id: string, parentId: string, text: string) {
  return {
    type: "message",
    id,
    parentId,
    timestamp: Date.now(),
    message: {
      role: "toolResult",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
    },
  };
}

function buildSession(numRounds: number, tokensPerMsg = 100) {
  const charPerToken = 4;
  const chars = tokensPerMsg * charPerToken;
  const text = "x".repeat(chars);

  const entries: Array<Record<string, unknown>> = [
    { type: "session", id: "session-0", parentId: null, timestamp: Date.now() },
  ];

  let parentId = "session-0";
  for (let r = 0; r < numRounds; r++) {
    const userEntry = makeMessageEntry("user", text, `user-${r}`, parentId);
    entries.push(userEntry);
    parentId = `user-${r}`;

    const assistantEntry = makeMessageEntry("assistant", text, `asst-${r}`, parentId);
    entries.push(assistantEntry);
    parentId = `asst-${r}`;

    const toolResultEntry = makeToolResultEntry(`tool-${r}`, parentId, text);
    entries.push(toolResultEntry);
    parentId = `tool-${r}`;

    const finalAssistant = makeMessageEntry("assistant", text, `asst2-${r}`, parentId);
    entries.push(finalAssistant);
    parentId = `asst2-${r}`;
  }

  return entries;
}

function countKeptTokens(entries: Array<Record<string, unknown>>, fromIndex: number) {
  let total = 0;
  for (let i = fromIndex; i < entries.length; i++) {
    const e = entries[i];
    if (e.type === "message") {
      total += estimateTokens((e as { message: unknown }).message);
    }
  }
  return total;
}

(HAS_COMPACTION_DEPS ? describe : describe.skip)("findCutPoint progressive strategy", () => {
  it("should find cut point with default keepRecentTokens", () => {
    const entries = buildSession(20, 200);
    const result = findCutPoint(
      entries,
      1,
      entries.length,
      DEFAULT_COMPACTION_SETTINGS.keepRecentTokens,
    );

    expect(result.firstKeptEntryIndex).toBeGreaterThanOrEqual(1);
    expect(result.firstKeptEntryIndex).toBeLessThan(entries.length);
  });

  it("smaller keepRecentTokens keeps fewer recent messages (cuts later)", () => {
    const entries = buildSession(20, 200);

    const result20k = findCutPoint(entries, 1, entries.length, 20000);
    const result10k = findCutPoint(entries, 1, entries.length, 10000);
    const result5k = findCutPoint(entries, 1, entries.length, 5000);

    // Smaller keepRecentTokens → cut later (higher index) → keeps fewer messages
    expect(result10k.firstKeptEntryIndex).toBeGreaterThanOrEqual(result20k.firstKeptEntryIndex);
    expect(result5k.firstKeptEntryIndex).toBeGreaterThanOrEqual(result10k.firstKeptEntryIndex);

    // Verify kept tokens decrease
    const kept20k = countKeptTokens(entries, result20k.firstKeptEntryIndex);
    const kept10k = countKeptTokens(entries, result10k.firstKeptEntryIndex);
    const kept5k = countKeptTokens(entries, result5k.firstKeptEntryIndex);

    expect(kept10k).toBeLessThanOrEqual(kept20k);
    expect(kept5k).toBeLessThanOrEqual(kept10k);
  });

  it("should never cut at a toolResult entry", () => {
    const entries = buildSession(20, 200);

    for (const keepTokens of [20000, 10000, 5000, 2000]) {
      const result = findCutPoint(entries, 1, entries.length, keepTokens);
      const cutEntry = entries[result.firstKeptEntryIndex];
      if (cutEntry.type === "message") {
        const role = (cutEntry as { message: { role: string } }).message.role;
        expect(role).not.toBe("toolResult");
      }
    }
  });

  it("should handle single round session", () => {
    const entries = buildSession(1, 500);
    const result = findCutPoint(entries, 1, entries.length, 20000);

    expect(result.firstKeptEntryIndex).toBeGreaterThanOrEqual(1);
  });
});

(HAS_COMPACTION_DEPS ? describe : describe.skip)("progressive retry strategy simulation", () => {
  it("simulates 3-level progressive compaction with decreasing kept tokens", () => {
    const entries = buildSession(30, 300);
    const strategy = [20000, 10000, 5000];

    const results = strategy.map((keepTokens) =>
      findCutPoint(entries, 1, entries.length, keepTokens),
    );

    // Each level keeps fewer tokens
    const keptTokens = results.map((r) => countKeptTokens(entries, r.firstKeptEntryIndex));

    for (let i = 1; i < keptTokens.length; i++) {
      expect(keptTokens[i]).toBeLessThanOrEqual(keptTokens[i - 1]);
    }
  });

  it("prepareCompaction respects custom keepRecentTokens", () => {
    const entries = buildSession(20, 300);
    const settings = { ...DEFAULT_COMPACTION_SETTINGS, keepRecentTokens: 5000 };

    const prep = prepareCompaction(entries, settings);
    if (!prep) {
      return;
    }

    expect(prep.firstKeptEntryId).toBeTruthy();
    expect(prep.messagesToSummarize.length).toBeGreaterThan(0);
  });

  it("computes progressive cut levels for overflow recovery", () => {
    const entries = buildSession(50, 400);
    const smallContextWindow = 60000;
    const settings = DEFAULT_COMPACTION_SETTINGS;

    const messages: Array<Record<string, unknown>> = [];
    for (const e of entries) {
      if (e.type === "message") {
        messages.push((e as { message: unknown }).message as Record<string, unknown>);
      }
    }
    const totalTokens = estimateContextTokens(messages).tokens;
    const needsCompact = shouldCompact(totalTokens, smallContextWindow, settings);

    if (needsCompact) {
      const levels = [20000, 10000, 5000];
      for (const keepTokens of levels) {
        const cut = findCutPoint(entries, 1, entries.length, keepTokens);
        expect(cut.firstKeptEntryIndex).toBeGreaterThan(0);
        expect(cut.firstKeptEntryIndex).toBeLessThan(entries.length);
      }
    }
  });

  it("verifies summary + kept tokens fits in context window at each level", () => {
    const entries = buildSession(40, 400);
    const contextWindow = 128000;
    const summaryEstimate = 2000; // Typical summary size

    const levels = [20000, 10000, 5000];
    for (const keepTokens of levels) {
      const cut = findCutPoint(entries, 1, entries.length, keepTokens);
      const keptTokens = countKeptTokens(entries, cut.firstKeptEntryIndex);
      const totalAfterCompact = summaryEstimate + keptTokens;

      expect(totalAfterCompact).toBeLessThan(contextWindow);
    }
  });
});

(HAS_COMPACTION_DEPS ? describe : describe.skip)("shouldCompact threshold calculation", () => {
  it("triggers when context approaches window limit", () => {
    const settings = { ...DEFAULT_COMPACTION_SETTINGS, reserveTokens: 16384 };

    expect(shouldCompact(100000, 128000, settings)).toBe(false);
    expect(shouldCompact(112000, 128000, settings)).toBe(true);
    expect(shouldCompact(128000, 128000, settings)).toBe(true);
    expect(shouldCompact(130000, 128000, settings)).toBe(true);
  });

  it("respects enabled flag", () => {
    const settings = { ...DEFAULT_COMPACTION_SETTINGS, enabled: false };
    expect(shouldCompact(200000, 128000, settings)).toBe(false);
  });
});

(HAS_COMPACTION_DEPS ? describe : describe.skip)("estimateTokens accuracy", () => {
  it("estimates user message tokens", () => {
    const msg = {
      role: "user",
      content: [{ type: "text", text: "a".repeat(100) }],
    };
    expect(estimateTokens(msg)).toBe(25);
  });

  it("estimates toolResult tokens", () => {
    const msg = {
      role: "toolResult",
      content: [{ type: "text", text: "x".repeat(400) }],
    };
    expect(estimateTokens(msg)).toBe(100);
  });
});
