import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ensureNodeOnPath,
  loadDotEnvFromAncestors,
  resolveNodeBinaryPath,
  resolvePiCliPath,
} from "../../src/server-config";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolvePiCliPath", () => {
  it("uses PI_CLI_PATH when provided", () => {
    expect(resolvePiCliPath({ PI_CLI_PATH: "/custom/pi" }, "/missing")).toBe("/custom/pi");
  });

  it("falls back to PWD node_modules bin for desktop dev launches", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-agent-chat-config-"));
    tempDirs.push(root);
    const binDir = join(root, "node_modules", ".bin");
    mkdirSync(binDir, { recursive: true });
    const piPath = join(binDir, "pi");
    writeFileSync(piPath, "#!/usr/bin/env node\n");

    expect(resolvePiCliPath({ PWD: root }, "/app-bundle/Contents/MacOS")).toBe(resolve(piPath));
  });

  it("loads .env from an app bundle ancestor before resolving PI_CLI_PATH", () => {
    const root = mkdtempSync(join(tmpdir(), "pi-agent-chat-config-"));
    tempDirs.push(root);
    const bundleDir = join(root, "build", "dev-macos-arm64", "PiAgentChat-dev.app", "Contents", "Resources", "app", "bun");
    mkdirSync(bundleDir, { recursive: true });
    writeFileSync(join(root, ".env"), "PI_CLI_PATH=/from/dotenv/pi\nOTHER_VALUE=kept\n");
    const env: NodeJS.ProcessEnv = {};

    const dotenvPath = loadDotEnvFromAncestors(env, [bundleDir]);

    expect(dotenvPath).toBe(join(root, ".env"));
    expect(resolvePiCliPath(env, bundleDir)).toBe("/from/dotenv/pi");
    expect(env.OTHER_VALUE).toBe("kept");
  });
});

describe("resolveNodeBinaryPath", () => {
  it("uses PI_NODE_PATH when provided", () => {
    expect(resolveNodeBinaryPath({ PI_NODE_PATH: "/custom/node" }, "/missing-home")).toBe(
      "/custom/node",
    );
  });

  it("finds the newest nvm node binary for desktop launches", () => {
    const home = mkdtempSync(join(tmpdir(), "pi-agent-chat-node-home-"));
    tempDirs.push(home);
    const oldNode = join(home, ".nvm", "versions", "node", "v18.19.0", "bin", "node");
    const newNode = join(home, ".nvm", "versions", "node", "v25.2.1", "bin", "node");
    mkdirSync(join(oldNode, ".."), { recursive: true });
    mkdirSync(join(newNode, ".."), { recursive: true });
    writeFileSync(oldNode, "");
    writeFileSync(newNode, "");

    expect(resolveNodeBinaryPath({}, home)).toBe(newNode);
  });
});

describe("ensureNodeOnPath", () => {
  it("prepends the resolved node directory to PATH", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/usr/bin:/bin",
      PI_NODE_PATH: "/custom/node/bin/node",
    };

    expect(ensureNodeOnPath(env, "/missing-home")).toBe("/custom/node/bin/node");
    expect(env.PATH).toBe("/custom/node/bin:/usr/bin:/bin");
  });

  it("does not duplicate the node directory in PATH", () => {
    const env: NodeJS.ProcessEnv = {
      PATH: "/custom/node/bin:/usr/bin:/bin",
      PI_NODE_PATH: "/custom/node/bin/node",
    };

    expect(ensureNodeOnPath(env, "/missing-home")).toBe("/custom/node/bin/node");
    expect(env.PATH).toBe("/custom/node/bin:/usr/bin:/bin");
  });
});
