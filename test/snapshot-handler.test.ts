import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm, writeFile, readFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

interface SnapshotMeta {
  id: string;
  sessionId: string;
  timestamp: number;
  description: string;
  messageIndex: number;
  parentSnapshotId: string | null;
  files: string[];
  rolledBack: boolean;
}

const SNAPSHOTS_FILE = ".snapshots.json";

async function readSnapshots(sessionDir: string): Promise<SnapshotMeta[]> {
  const filePath = join(sessionDir, SNAPSHOTS_FILE);
  if (!existsSync(filePath)) return [];
  const raw = await readFile(filePath, "utf-8");
  return JSON.parse(raw) as SnapshotMeta[];
}

async function writeSnapshots(sessionDir: string, snapshots: SnapshotMeta[]): Promise<void> {
  const filePath = join(sessionDir, SNAPSHOTS_FILE);
  await writeFile(filePath, JSON.stringify(snapshots, null, 2), "utf-8");
}

function createSnapshotManager() {
  const sessionDirs = new Map<string, string>();

  function resolveSessionDir(sessionId: string): string | null {
    return sessionDirs.get(sessionId) ?? null;
  }

  return {
    registerSession(sessionId: string, dir: string) {
      sessionDirs.set(sessionId, dir);
    },

    async list(sessionId: string): Promise<SnapshotMeta[]> {
      const dir = resolveSessionDir(sessionId);
      if (!dir) return [];
      return readSnapshots(dir);
    },

    async get(sessionId: string, snapshotId: string): Promise<SnapshotMeta | null> {
      const snapshots = await this.list(sessionId);
      return snapshots.find((s) => s.id === snapshotId) ?? null;
    },

    async rollback(
      sessionId: string,
      snapshotId: string,
      files?: string[],
    ): Promise<{ ok: boolean; restoredFiles: string[]; error?: string }> {
      const snapshots = await this.list(sessionId);
      const snapshot = snapshots.find((s) => s.id === snapshotId);
      if (!snapshot) return { ok: false, restoredFiles: [], error: "Snapshot not found" };

      const restoredFiles = files
        ? snapshot.files.filter((f) => files!.includes(f))
        : [...snapshot.files];

      const updated = snapshots.map((s) => (s.id === snapshotId ? { ...s, rolledBack: true } : s));
      const dir = resolveSessionDir(sessionId);
      if (dir) await writeSnapshots(dir, updated);

      return { ok: true, restoredFiles };
    },

    async unrevert(
      sessionId: string,
      snapshotId: string,
    ): Promise<{ ok: boolean; error?: string }> {
      const snapshots = await this.list(sessionId);
      const snapshot = snapshots.find((s) => s.id === snapshotId);
      if (!snapshot) return { ok: false, error: "Snapshot not found" };
      if (!snapshot.rolledBack) return { ok: false, error: "Snapshot is not rolled back" };

      const updated = snapshots.map((s) => (s.id === snapshotId ? { ...s, rolledBack: false } : s));
      const dir = resolveSessionDir(sessionId);
      if (dir) await writeSnapshots(dir, updated);

      return { ok: true };
    },

    async navigateTree(
      sessionId: string,
      snapshotId?: string,
      path?: string,
    ): Promise<{
      entries: Array<{
        name: string;
        path: string;
        type: "file" | "directory";
        contentHash?: string;
      }>;
      currentPath: string;
    }> {
      const snapshots = await this.list(sessionId);
      const snapshot = snapshotId ? snapshots.find((s) => s.id === snapshotId) : snapshots[0];
      if (!snapshot) return { entries: [], currentPath: path ?? "/" };

      const entries = snapshot.files.map((f) => {
        const parts = f.split("/");
        const name = parts[parts.length - 1];
        return {
          name,
          path: f,
          type: "file" as const,
          contentHash: `${snapshot.id}:${f}`,
        };
      });
      return { entries, currentPath: path ?? "/" };
    },

    async getTree(
      sessionId: string,
      snapshotId: string,
      filePath: string,
    ): Promise<{
      path: string;
      content: string;
      contentHash: string;
    } | null> {
      const snapshots = await this.list(sessionId);
      const snapshot = snapshots.find((s) => s.id === snapshotId);
      if (!snapshot) return null;
      if (!snapshot.files.includes(filePath)) return null;
      return {
        path: filePath,
        content: `content of ${filePath} at ${snapshotId}`,
        contentHash: `${snapshot.id}:${filePath}`,
      };
    },
  };
}

let tempDir: string;
let manager: ReturnType<typeof createSnapshotManager>;

beforeEach(async () => {
  tempDir = join(tmpdir(), `snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(tempDir, { recursive: true });
  manager = createSnapshotManager();
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe("snapshot.list", () => {
  it("returns empty array when no snapshots exist", async () => {
    const sessionDir = join(tempDir, "session-1");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s1", sessionDir);

    const result = await manager.list("s1");
    expect(result).toEqual([]);
  });

  it("returns empty array when session is not registered", async () => {
    const result = await manager.list("unknown");
    expect(result).toEqual([]);
  });

  it("returns stored snapshots", async () => {
    const sessionDir = join(tempDir, "session-2");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s2", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-1",
        sessionId: "s2",
        timestamp: Date.now(),
        description: "Initial state",
        messageIndex: 0,
        parentSnapshotId: null,
        files: ["src/index.ts"],
        rolledBack: false,
      },
      {
        id: "snap-2",
        sessionId: "s2",
        timestamp: Date.now() + 1000,
        description: "After edit",
        messageIndex: 5,
        parentSnapshotId: "snap-1",
        files: ["src/index.ts", "src/utils.ts"],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.list("s2");
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("snap-1");
    expect(result[1].id).toBe("snap-2");
    expect(result[1].parentSnapshotId).toBe("snap-1");
  });
});

describe("snapshot.get", () => {
  it("returns null when snapshot not found", async () => {
    const sessionDir = join(tempDir, "session-3");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s3", sessionDir);

    const result = await manager.get("s3", "nonexistent");
    expect(result).toBeNull();
  });

  it("returns specific snapshot by id", async () => {
    const sessionDir = join(tempDir, "session-4");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s4", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-a",
        sessionId: "s4",
        timestamp: 1000,
        description: "First",
        messageIndex: 0,
        parentSnapshotId: null,
        files: [],
        rolledBack: false,
      },
      {
        id: "snap-b",
        sessionId: "s4",
        timestamp: 2000,
        description: "Second",
        messageIndex: 3,
        parentSnapshotId: "snap-a",
        files: ["foo.ts"],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.get("s4", "snap-b");
    expect(result).not.toBeNull();
    expect(result!.id).toBe("snap-b");
    expect(result!.description).toBe("Second");
    expect(result!.messageIndex).toBe(3);
  });
});

describe("snapshot.rollback", () => {
  it("fails when snapshot not found", async () => {
    const sessionDir = join(tempDir, "session-5");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s5", sessionDir);

    const result = await manager.rollback("s5", "missing");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Snapshot not found");
    expect(result.restoredFiles).toEqual([]);
  });

  it("rolls back all files when no files filter provided", async () => {
    const sessionDir = join(tempDir, "session-6");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s6", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-r1",
        sessionId: "s6",
        timestamp: Date.now(),
        description: "Before change",
        messageIndex: 2,
        parentSnapshotId: null,
        files: ["src/a.ts", "src/b.ts", "src/c.ts"],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.rollback("s6", "snap-r1");
    expect(result.ok).toBe(true);
    expect(result.restoredFiles).toEqual(["src/a.ts", "src/b.ts", "src/c.ts"]);

    const updated = await readSnapshots(sessionDir);
    expect(updated[0].rolledBack).toBe(true);
  });

  it("rolls back only specified files", async () => {
    const sessionDir = join(tempDir, "session-7");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s7", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-r2",
        sessionId: "s7",
        timestamp: Date.now(),
        description: "Multi file",
        messageIndex: 5,
        parentSnapshotId: null,
        files: ["a.ts", "b.ts", "c.ts"],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.rollback("s7", "snap-r2", ["a.ts", "c.ts"]);
    expect(result.ok).toBe(true);
    expect(result.restoredFiles).toEqual(["a.ts", "c.ts"]);
  });

  it("returns empty restored files when filter matches nothing", async () => {
    const sessionDir = join(tempDir, "session-8");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s8", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-r3",
        sessionId: "s8",
        timestamp: Date.now(),
        description: "Test",
        messageIndex: 1,
        parentSnapshotId: null,
        files: ["x.ts"],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.rollback("s8", "snap-r3", ["nonexistent.ts"]);
    expect(result.ok).toBe(true);
    expect(result.restoredFiles).toEqual([]);
  });
});

describe("snapshot.unrevert", () => {
  it("fails when snapshot not found", async () => {
    const sessionDir = join(tempDir, "session-9");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s9", sessionDir);

    const result = await manager.unrevert("s9", "missing");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Snapshot not found");
  });

  it("fails when snapshot is not rolled back", async () => {
    const sessionDir = join(tempDir, "session-10");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s10", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-u1",
        sessionId: "s10",
        timestamp: Date.now(),
        description: "Active",
        messageIndex: 0,
        parentSnapshotId: null,
        files: [],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.unrevert("s10", "snap-u1");
    expect(result.ok).toBe(false);
    expect(result.error).toBe("Snapshot is not rolled back");
  });

  it("unreverts a rolled-back snapshot", async () => {
    const sessionDir = join(tempDir, "session-11");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s11", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-u2",
        sessionId: "s11",
        timestamp: Date.now(),
        description: "Was rolled back",
        messageIndex: 3,
        parentSnapshotId: null,
        files: ["foo.ts"],
        rolledBack: true,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.unrevert("s11", "snap-u2");
    expect(result.ok).toBe(true);

    const updated = await readSnapshots(sessionDir);
    expect(updated[0].rolledBack).toBe(false);
  });
});

describe("snapshot.navigateTree", () => {
  it("returns empty entries for nonexistent snapshot", async () => {
    const sessionDir = join(tempDir, "session-12");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s12", sessionDir);

    const result = await manager.navigateTree("s12", "missing");
    expect(result.entries).toEqual([]);
    expect(result.currentPath).toBe("/");
  });

  it("returns file entries for a snapshot", async () => {
    const sessionDir = join(tempDir, "session-13");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s13", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-n1",
        sessionId: "s13",
        timestamp: Date.now(),
        description: "With files",
        messageIndex: 2,
        parentSnapshotId: null,
        files: ["src/index.ts", "src/lib/helper.ts", "README.md"],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.navigateTree("s13", "snap-n1", "/");
    expect(result.entries).toHaveLength(3);
    expect(result.currentPath).toBe("/");
    expect(result.entries[0].name).toBe("index.ts");
    expect(result.entries[0].type).toBe("file");
    expect(result.entries[0].contentHash).toBe("snap-n1:src/index.ts");
  });

  it("uses first snapshot when no snapshotId provided", async () => {
    const sessionDir = join(tempDir, "session-14");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s14", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-n2",
        sessionId: "s14",
        timestamp: Date.now(),
        description: "Auto select",
        messageIndex: 0,
        parentSnapshotId: null,
        files: ["a.ts"],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.navigateTree("s14");
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].name).toBe("a.ts");
  });
});

describe("snapshot.getTree", () => {
  it("returns null for nonexistent snapshot", async () => {
    const sessionDir = join(tempDir, "session-15");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s15", sessionDir);

    const result = await manager.getTree("s15", "missing", "any.ts");
    expect(result).toBeNull();
  });

  it("returns null for file not in snapshot", async () => {
    const sessionDir = join(tempDir, "session-16");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s16", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-g1",
        sessionId: "s16",
        timestamp: Date.now(),
        description: "With files",
        messageIndex: 0,
        parentSnapshotId: null,
        files: ["src/main.ts"],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.getTree("s16", "snap-g1", "other.ts");
    expect(result).toBeNull();
  });

  it("returns file content for valid snapshot file", async () => {
    const sessionDir = join(tempDir, "session-17");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s17", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "snap-g2",
        sessionId: "s17",
        timestamp: Date.now(),
        description: "Content test",
        messageIndex: 1,
        parentSnapshotId: null,
        files: ["src/app.tsx", "package.json"],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const result = await manager.getTree("s17", "snap-g2", "src/app.tsx");
    expect(result).not.toBeNull();
    expect(result!.path).toBe("src/app.tsx");
    expect(result!.content).toContain("src/app.tsx");
    expect(result!.contentHash).toBe("snap-g2:src/app.tsx");
  });
});

describe("snapshot tree structure", () => {
  it("builds parent-child chain via parentSnapshotId", async () => {
    const sessionDir = join(tempDir, "session-18");
    await mkdir(sessionDir, { recursive: true });
    manager.registerSession("s18", sessionDir);

    const snapshots: SnapshotMeta[] = [
      {
        id: "root",
        sessionId: "s18",
        timestamp: 1000,
        description: "Root",
        messageIndex: 0,
        parentSnapshotId: null,
        files: ["a.ts"],
        rolledBack: false,
      },
      {
        id: "child-1",
        sessionId: "s18",
        timestamp: 2000,
        description: "Child 1",
        messageIndex: 3,
        parentSnapshotId: "root",
        files: ["a.ts", "b.ts"],
        rolledBack: false,
      },
      {
        id: "child-2",
        sessionId: "s18",
        timestamp: 3000,
        description: "Child 2",
        messageIndex: 6,
        parentSnapshotId: "child-1",
        files: ["a.ts", "b.ts", "c.ts"],
        rolledBack: false,
      },
    ];
    await writeSnapshots(sessionDir, snapshots);

    const all = await manager.list("s18");
    expect(all).toHaveLength(3);

    const child2 = all.find((s) => s.id === "child-2")!;
    expect(child2.parentSnapshotId).toBe("child-1");

    const child1 = all.find((s) => s.id === "child-1")!;
    expect(child1.parentSnapshotId).toBe("root");

    const root = all.find((s) => s.id === "root")!;
    expect(root.parentSnapshotId).toBeNull();
  });
});
