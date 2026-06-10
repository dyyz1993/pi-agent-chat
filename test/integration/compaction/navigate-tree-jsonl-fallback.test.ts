/**
 * @vitest-environment node
 *
 * Tests for navigateTree JSONL fallback in AgentProcessManager.
 *
 * When no active CLI client exists, navigateTree reads the JSONL file
 * to verify the targetId exists, then updates leafIds cache.
 */
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/fake/path/to/cli.js",
    piExtensionsDir: "/fake/path/to/extensions",
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { AgentProcessManager as APM } from "../../../src/shared/agent/process-manager";
import { AgentProcessManager } from "../../../src/shared/agent/process-manager";

interface InternalAPM {
  leafIds: Map<string, string | null>;
  sessionPaths: Map<string, string>;
  clients: Map<string, unknown>;
}

function internals(manager: APM): InternalAPM {
  return manager as unknown as InternalAPM;
}

const TMP_DIR = join("/tmp", "pi-navigate-tree-test");

function makeEntry(
  id: string,
  parentId: string | null,
  type: string,
  extra: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    id,
    parentId,
    type,
    timestamp: new Date().toISOString(),
    ...extra,
  });
}

function makeMessage(id: string, parentId: string | null, role: string): string {
  return makeEntry(id, parentId, "message", {
    message: { role, content: [{ type: "text", text: "test" }] },
  });
}

class MockRPCServer {
  emitEvent = vi.fn().mockResolvedValue(undefined);
}

describe("navigateTree JSONL fallback", () => {
  let manager: APM;
  let sessionFile: string;

  beforeEach(() => {
    manager = new AgentProcessManager(new MockRPCServer() as never);
    mkdirSync(TMP_DIR, { recursive: true });
    sessionFile = join(TMP_DIR, `session-${Date.now()}.jsonl`);
  });

  afterEach(() => {
    try {
      rmSync(TMP_DIR, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("no managed client + valid targetId → succeeds, sets leafIds", async () => {
    writeFileSync(
      sessionFile,
      [
        makeEntry("root", null, "session"),
        makeMessage("m1", "root", "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"),
        makeMessage("m4", "m3", "assistant"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("sess-1", sessionFile);
    expect(internals(manager).clients.has("sess-1")).toBe(false);

    const result = await manager.navigateTree("sess-1", "m2");

    expect(result.cancelled).toBe(false);
    expect(result.reason).toBeUndefined();
    expect(internals(manager).leafIds.get("sess-1")).toBe("m2");
  });

  it("no managed client + invalid targetId → cancelled with reason", async () => {
    writeFileSync(
      sessionFile,
      [
        makeEntry("root", null, "session"),
        makeMessage("m1", "root", "user"),
        makeMessage("m2", "m1", "assistant"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("sess-1", sessionFile);

    const result = await manager.navigateTree("sess-1", "nonexistent-id");

    expect(result.cancelled).toBe(true);
    expect(result.reason).toBe("Target entry not found in session");
    expect(internals(manager).leafIds.has("sess-1")).toBe(false);
  });

  it("no managed client + no session path → cancelled with reason", async () => {
    const result = await manager.navigateTree("sess-unknown", "some-target");

    expect(result.cancelled).toBe(true);
    expect(result.reason).toBe("No session path found");
    expect(internals(manager).leafIds.has("sess-unknown")).toBe(false);
  });

  it("leafIds persists after navigateTree JSONL fallback — getFullMessages sees updated leafId", async () => {
    writeFileSync(
      sessionFile,
      [
        makeEntry("root", null, "session"),
        makeMessage("m1", "root", "user"),
        makeMessage("m2", "m1", "assistant"),
        makeMessage("m3", "m2", "user"),
        makeMessage("m4", "m3", "assistant"),
      ].join("\n"),
    );

    internals(manager).sessionPaths.set("sess-1", sessionFile);

    const navResult = await manager.navigateTree("sess-1", "m2");
    expect(navResult.cancelled).toBe(false);
    expect(internals(manager).leafIds.get("sess-1")).toBe("m2");

    const msgResult = await manager.getFullMessages("sess-1", sessionFile);

    expect(msgResult.totalCount).toBe(2);
    const roles = msgResult.messages.map((m: Record<string, unknown>) => m.role);
    expect(roles).toEqual(["user", "assistant"]);
  });
});
