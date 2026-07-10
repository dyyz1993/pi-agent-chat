/**
 * @vitest-environment node
 */
import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/server-config", () => ({
  config: {
    piCliPath: "/fake/node_modules/.bin/pi",
    piExtensionsDir: "/fake/extensions",
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

import {
  filterDisabledExtensionPaths,
  getBuiltinExtensionsDirForCliPath,
  parseTierModel,
  scanExtensionDir,
} from "../../../src/shared/agent/agent-runtime-config";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = path.join(os.tmpdir(), `pi-agent-runtime-config-${Date.now()}-${tempDirs.length}`);
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function touch(filePath: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, "", "utf-8");
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("agent runtime config", () => {
  it("scans loadable extension files and folders while skipping private entries", () => {
    const root = makeTempDir();
    touch(path.join(root, "single.ts"));
    touch(path.join(root, "plain.js"));
    touch(path.join(root, "module-a", "index.ts"));
    touch(path.join(root, "module-b", "index.js"));
    touch(path.join(root, "module-c", "other.ts"));
    touch(path.join(root, ".hidden.ts"));
    touch(path.join(root, "_disabled.ts"));
    touch(path.join(root, "_auto-memory", "index.ts"));
    touch(path.join(root, "_single.ts"));
    touch(path.join(root, "_disabled", "index.ts"));
    touch(path.join(root, "__tests__", "index.ts"));
    touch(path.join(root, "node_modules", "dep.ts"));
    touch(path.join(root, "notes.md"));

    const found: string[] = [];
    scanExtensionDir(root, found);

    expect(found.sort()).toEqual(
      [
        path.join(root, "module-a", "index.ts"),
        path.join(root, "module-b", "index.js"),
        path.join(root, "plain.js"),
        path.join(root, "single.ts"),
      ].sort(),
    );
  });

  it("resolves symlinked extension folders", () => {
    const root = makeTempDir();
    const target = makeTempDir();
    touch(path.join(target, "index.ts"));
    symlinkSync(target, path.join(root, "linked-extension"), "dir");

    const found: string[] = [];
    scanExtensionDir(root, found);

    expect(found).toEqual([path.join(root, "linked-extension", "index.ts")]);
  });

  it("allows selected built-in private extension entries", () => {
    const root = makeTempDir();
    touch(path.join(root, "_auto-memory", "index.ts"));
    touch(path.join(root, "_multi-compaction", "index.ts"));
    touch(path.join(root, "learning", "index.ts"));

    const found: string[] = [];
    scanExtensionDir(root, found, { allowPrivateEntries: new Set(["_multi-compaction"]) });

    expect(found.sort()).toEqual(
      [
        path.join(root, "_multi-compaction", "index.ts"),
        path.join(root, "learning", "index.ts"),
      ].sort(),
    );
  });

  it("filters CLI-discovered extension paths using disabled settings entries", () => {
    const root = makeTempDir();
    const enabledPath = path.join(root, "learning", "index.ts");
    const disabledPath = path.join(root, "_multi-compaction", "index.ts");
    touch(enabledPath);
    touch(disabledPath);

    expect(filterDisabledExtensionPaths([enabledPath, disabledPath], [`-${disabledPath}`])).toEqual(
      [enabledPath],
    );
  });

  it("filters disabled extension paths through symlink realpaths", () => {
    const root = makeTempDir();
    const target = makeTempDir();
    const targetIndex = path.join(target, "index.ts");
    touch(targetIndex);
    const linkDir = path.join(root, "_multi-compaction");
    symlinkSync(target, linkDir, "dir");
    const linkedIndex = path.join(linkDir, "index.ts");

    expect(filterDisabledExtensionPaths([linkedIndex], [`-${targetIndex}`])).toEqual([]);
  });

  it("resolves builtin extensions from a yalc/node_modules package cli path", () => {
    const root = makeTempDir();
    const packageRoot = path.join(root, "node_modules", "@dyyz1993", "pi-coding-agent");
    const cliPath = path.join(packageRoot, "dist", "cli.js");
    const extensionsDir = path.join(packageRoot, "dist", "extensions");
    touch(cliPath);
    touch(path.join(extensionsDir, "file-review", "index.ts"));

    expect(getBuiltinExtensionsDirForCliPath(cliPath)).toBe(realpathSync(extensionsDir));
  });

  it("resolves builtin extensions from a package bin symlink", () => {
    const root = makeTempDir();
    const packageRoot = path.join(root, "node_modules", "@dyyz1993", "pi-coding-agent");
    const cliPath = path.join(packageRoot, "dist", "cli.js");
    const binPath = path.join(root, "node_modules", ".bin", "pi");
    const extensionsDir = path.join(packageRoot, "dist", "extensions");
    touch(cliPath);
    touch(path.join(extensionsDir, "file-review", "index.ts"));
    mkdirSync(path.dirname(binPath), { recursive: true });
    symlinkSync(cliPath, binPath);

    expect(getBuiltinExtensionsDirForCliPath(binPath)).toBe(realpathSync(extensionsDir));
  });

  it("parses provider and nested model ids from tier mappings", () => {
    expect(parseTierModel("pro", "openai/gpt-4.1")).toEqual({
      provider: "openai",
      modelId: "gpt-4.1",
    });
    expect(parseTierModel("max", "anthropic/claude/opus")).toEqual({
      provider: "anthropic",
      modelId: "claude/opus",
    });
  });

  it("rejects missing and malformed tier mappings", () => {
    expect(() => parseTierModel("fast", undefined)).toThrow('Tier "fast" is not configured');
    expect(() => parseTierModel("pro", "missing-provider-separator")).toThrow(
      "Invalid tier model mapping: pro -> missing-provider-separator",
    );
  });
});
