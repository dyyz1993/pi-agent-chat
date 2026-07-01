/**
 * @vitest-environment node
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

import { ensureLocalCodingAgentRuntimeDependencies } from "../../../src/shared/agent/agent-runtime-package-repair";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = path.join(
    os.tmpdir(),
    `pi-agent-runtime-package-repair-${Date.now()}-${tempDirs.length}`,
  );
  mkdirSync(dir, { recursive: true });
  tempDirs.push(dir);
  return dir;
}

function touch(filePath: string, content = ""): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, content, "utf-8");
}

function setupLocalCodingAgentPackage(root: string): { cliPath: string; packageRoot: string } {
  const packageRoot = path.join(root, "node_modules", "@dyyz1993", "pi-coding-agent");
  const cliPath = path.join(packageRoot, "dist", "cli.js");
  touch(path.join(packageRoot, "package.json"), '{"name":"@dyyz1993/pi-coding-agent"}\n');
  touch(cliPath);
  return { cliPath, packageRoot };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("agent runtime package repair", () => {
  it("does nothing when nested pi-tui already has its dist entrypoint", () => {
    const root = makeTempDir();
    const { cliPath, packageRoot } = setupLocalCodingAgentPackage(root);
    const nestedEntry = path.join(
      packageRoot,
      "node_modules",
      "@dyyz1993",
      "pi-tui",
      "dist",
      "index.js",
    );
    touch(nestedEntry, "export const ok = true;\n");

    expect(ensureLocalCodingAgentRuntimeDependencies(cliPath)).toBe("already-present");
    expect(existsSync(nestedEntry)).toBe(true);
  });

  it("repairs a missing nested pi-tui dist from the hydrated yalc package", () => {
    const root = makeTempDir();
    const { cliPath, packageRoot } = setupLocalCodingAgentPackage(root);
    const yalcEntry = path.join(root, ".yalc", "@dyyz1993", "pi-tui", "dist", "index.js");
    const nestedEntry = path.join(
      packageRoot,
      "node_modules",
      "@dyyz1993",
      "pi-tui",
      "dist",
      "index.js",
    );
    touch(yalcEntry, "export const repaired = true;\n");

    expect(ensureLocalCodingAgentRuntimeDependencies(cliPath)).toBe("repaired");
    expect(existsSync(nestedEntry)).toBe(true);
  });

  it("does not mutate fork-source cli paths outside the app node_modules layout", () => {
    const root = makeTempDir();
    const packageRoot = path.join(root, "packages", "coding-agent");
    const cliPath = path.join(packageRoot, "dist", "cli.js");
    touch(path.join(packageRoot, "package.json"), '{"name":"@dyyz1993/pi-coding-agent"}\n');
    touch(cliPath);

    expect(ensureLocalCodingAgentRuntimeDependencies(cliPath)).toBe("not-local-node-modules");
  });
});
