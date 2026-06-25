import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildUsageStatsFromIndex,
  readUsageSnapshot,
  refreshUsageIndex,
  writeUsageSnapshot,
} from "../../../src/shared/lib/usage-index";

const originalAgentDir = process.env.PI_CODING_AGENT_DIR;
const now = Date.parse("2026-06-25T12:00:00+08:00");

async function writeJsonl(path: string, entries: unknown[]) {
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n`);
}

describe("usage index", () => {
  let agentDir: string;
  let sessionFile: string;

  beforeEach(async () => {
    agentDir = await mkdtemp(join(tmpdir(), "pi-usage-index-"));
    process.env.PI_CODING_AGENT_DIR = agentDir;
    const sessionDir = join(agentDir, "sessions", "--tmp-project--");
    await mkdir(sessionDir, { recursive: true });
    sessionFile = join(sessionDir, "session-a.jsonl");
  });

  afterEach(() => {
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
  });

  it("reuses unchanged session files and refreshes changed files", async () => {
    await writeJsonl(sessionFile, [
      {
        type: "message",
        timestamp: "2026-06-24T10:00:00+08:00",
        message: {
          role: "assistant",
          timestamp: "2026-06-24T10:00:00+08:00",
          provider: "openai",
          model: "gpt-test",
          usage: { input: 100, output: 25 },
        },
      },
    ]);

    const first = await refreshUsageIndex("global", "");
    expect(first.changedFiles).toBe(1);
    expect(first.scannedSessionFiles).toBe(1);
    expect(Object.values(first.index.files)[0]).toHaveProperty("days");
    expect(Object.values(first.index.files)[0]).not.toHaveProperty("facts");
    expect(
      buildUsageStatsFromIndex(first.index, { scope: "global", projectPath: "", range: "7d", now })
        .totals.tokens,
    ).toBe(125);

    const second = await refreshUsageIndex("global", "");
    expect(second.changedFiles).toBe(0);

    await writeJsonl(sessionFile, [
      {
        type: "message",
        timestamp: "2026-06-24T10:00:00+08:00",
        message: {
          role: "assistant",
          timestamp: "2026-06-24T10:00:00+08:00",
          provider: "openai",
          model: "gpt-test",
          usage: { input: 100, output: 25 },
        },
      },
      {
        type: "custom",
        customType: "memory_created",
        timestamp: "2026-06-25T09:00:00+08:00",
      },
    ]);

    const third = await refreshUsageIndex("global", "");
    expect(third.changedFiles).toBe(1);
    const stats = buildUsageStatsFromIndex(third.index, {
      scope: "global",
      projectPath: "",
      range: "7d",
      now,
    });
    expect(stats.totals.tokens).toBe(125);
    expect(stats.totals.memoryWrites).toBe(1);
  });

  it("writes and reads range-specific snapshots", async () => {
    await writeJsonl(sessionFile, [
      {
        type: "message",
        timestamp: "2026-06-25T10:00:00+08:00",
        message: {
          role: "assistant",
          timestamp: "2026-06-25T10:00:00+08:00",
          model: "gpt-test",
          usage: { input: 5, output: 7 },
        },
      },
    ]);

    const { index } = await refreshUsageIndex("global", "");
    const stats = buildUsageStatsFromIndex(index, {
      scope: "global",
      projectPath: "",
      range: "7d",
      now,
    });
    await writeUsageSnapshot(stats);

    const cached = await readUsageSnapshot("global", "", "7d");
    expect(cached?.totals.tokens).toBe(12);
    expect(cached?.dataQuality.cacheStatus).toBe("hit");

    const raw = await readFile(join(agentDir, "usage", "latest-share-stats-7d.json"), "utf-8");
    expect(JSON.parse(raw).range.preset).toBe("7d");
  });
});
