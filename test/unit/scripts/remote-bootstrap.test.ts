/**
 * @vitest-environment node
 */
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];

function makeRoot() {
  const root = mkdtempSync(join(tmpdir(), "pi-remote-bootstrap-test-"));
  roots.push(root);
  return root;
}

function writeExecutable(path: string, content: string) {
  writeFileSync(path, content);
  chmodSync(path, 0o755);
}

function createHarness(options: { hasNode?: boolean; hasPi?: boolean; rpcFails?: boolean } = {}) {
  const root = makeRoot();
  const binDir = join(root, "bin");
  const localPiDir = join(root, "local-pi");
  const envFile = join(root, ".env");
  const logFile = join(root, "remote.log");
  mkdirSync(binDir, { recursive: true });
  mkdirSync(localPiDir, { recursive: true });
  writeFileSync(join(localPiDir, "auth.json"), JSON.stringify({ api_key: "test-key" }));
  writeFileSync(join(localPiDir, "models.json"), JSON.stringify({ provider: "deepseek" }));
  writeFileSync(join(localPiDir, "settings.json"), JSON.stringify({ ok: true }));
  writeFileSync(envFile, "PORT=3100\n");

  writeExecutable(
    join(binDir, "fake-ping"),
    `#!/usr/bin/env bash
exit 0
`,
  );

  writeExecutable(
    join(binDir, "fake-scp"),
    `#!/usr/bin/env bash
echo "scp $*" >> "$FAKE_REMOTE_LOG"
exit 0
`,
  );

  writeExecutable(
    join(binDir, "fake-ssh"),
    `#!/usr/bin/env bash
set -euo pipefail
cmd="\${@: -1}"
echo "$cmd" >> "$FAKE_REMOTE_LOG"
case "$cmd" in
  *"uname -s"*) echo "Darwin"; exit 0 ;;
  *"uname -m"*) echo "x86_64"; exit 0 ;;
  *"command -v node"*) if [ "\${FAKE_HAS_NODE:-1}" = "1" ]; then echo "/usr/local/bin/node"; exit 0; else exit 1; fi ;;
  *"node --version"*) echo "v22.15.0"; exit 0 ;;
  *"command -v pi"*) if [ "\${FAKE_HAS_PI:-1}" = "1" ]; then echo "/usr/local/bin/pi"; exit 0; else exit 1; fi ;;
  *"pi --version"*) echo "0.78.10"; exit 0 ;;
  *"curl -fsSL"*) exit 0 ;;
  *"npm install -g"*) exit 0 ;;
  *"pi --list-models"*) exit 0 ;;
  *"test -s ~/.pi/agent/auth.json"*) exit 0 ;;
  *"test -s ~/.pi/agent/models.json"*) exit 0 ;;
  *"pi --mode rpc"*) if [ "\${FAKE_RPC_FAILS:-0}" = "1" ]; then exit 1; else exit 0; fi ;;
  *) exit 0 ;;
esac
`,
  );

  const env = {
    ...process.env,
    PI_REMOTE_BOOTSTRAP_SSH_BIN: join(binDir, "fake-ssh"),
    PI_REMOTE_BOOTSTRAP_SCP_BIN: join(binDir, "fake-scp"),
    PI_REMOTE_BOOTSTRAP_PING_BIN: join(binDir, "fake-ping"),
    PI_REMOTE_BOOTSTRAP_LOCAL_PI_DIR: localPiDir,
    PI_REMOTE_BOOTSTRAP_ENV_FILE: envFile,
    PI_REMOTE_BOOTSTRAP_REMOTE_PROJECT_PATH: "/tmp/pi-remote-project",
    PI_REMOTE_BOOTSTRAP_REMOTE_RUNTIME_DIR: "/tmp/pi-remote-runtime",
    PI_REMOTE_BOOTSTRAP_REMOTE_AGENT_DIR: "/tmp/pi-remote-agent",
    FAKE_REMOTE_LOG: logFile,
    FAKE_HAS_NODE: options.hasNode === false ? "0" : "1",
    FAKE_HAS_PI: options.hasPi === false ? "0" : "1",
    FAKE_RPC_FAILS: options.rpcFails ? "1" : "0",
  };

  return { env, envFile, logFile };
}

function runBootstrap(env: NodeJS.ProcessEnv) {
  return execFileSync("bash", ["scripts/remote-bootstrap.sh", "test-host"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

function runBootstrapResult(env: NodeJS.ProcessEnv) {
  return spawnSync("bash", ["scripts/remote-bootstrap.sh", "test-host"], {
    cwd: process.cwd(),
    env,
    encoding: "utf8",
  });
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("remote-bootstrap.sh", () => {
  it("registers an existing remote runtime and verifies RPC get_state", () => {
    const harness = createHarness();

    const output = runBootstrap(harness.env);
    const envFile = readFileSync(harness.envFile, "utf8");
    const log = readFileSync(harness.logFile, "utf8");

    expect(output).toContain("8. RPC verification");
    expect(output).toContain("Remote machine is ready: test-host");
    expect(envFile).toContain("REMOTE_CHILD_ENABLED=true");
    expect(envFile).toContain("REMOTE_SSH_TARGET=test-host");
    expect(envFile).toContain("REMOTE_CHILD_PROJECT_PATH=/tmp/pi-remote-project");
    expect(envFile).toContain("REMOTE_CHILD_AUTO_UPLOAD=false");
    expect(log).toContain("pi --mode rpc");
    expect(log).toContain("pi --list-models");
  });

  it("installs missing node and pi before completing verification", () => {
    const harness = createHarness({ hasNode: false, hasPi: false });

    const output = runBootstrap(harness.env);
    const log = readFileSync(harness.logFile, "utf8");

    expect(output).toContain("node present");
    expect(output).toContain("pi present");
    expect(output).toContain("Remote machine is ready: test-host");
    expect(log).toContain("node-v22.15.0-darwin-x64.tar.gz");
    expect(log).toContain("npm install -g --prefix");
    expect(log).toContain("@dyyz1993/pi-coding-agent@0.74.61");
  });

  it("fails loudly when the remote RPC verification fails", () => {
    const harness = createHarness({ rpcFails: true });

    const result = runBootstrapResult(harness.env);

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("pi --mode rpc get_state");
    expect(result.stdout).toContain("Remote bootstrap did not complete");
  });
});
