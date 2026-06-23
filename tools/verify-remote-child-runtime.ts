#!/usr/bin/env bun
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { RpcClient } from "@dyyz1993/pi-coding-agent";
import { bootstrapRemoteChild } from "../src/sandbox/remote-child-bootstrap";

interface Options {
  target: string;
  remoteProject: string;
  localBinary: string;
  localExtensions: string;
  remoteRuntimeDir: string;
  remoteShell: string;
  remoteAgentDir: string;
  binaryName: string;
  concurrency: number;
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      out[arg.slice(2)] = argv[i + 1] ?? "";
      i++;
    }
  }
  return out;
}

function getOption(raw: Record<string, string>, key: string, envKey: string, fallback = ""): string {
  return raw[key] ?? process.env[envKey] ?? fallback;
}

function getOptions(): Options {
  const raw = parseArgs(process.argv.slice(2));
  const target = getOption(raw, "target", "REMOTE_SSH_TARGET");
  const remoteProject = getOption(
    raw,
    "remote-project",
    "REMOTE_CHILD_PROJECT_PATH",
    process.env.REMOTE_PROJECT_PATH ?? "",
  );
  const localBinary = getOption(raw, "binary", "REMOTE_CHILD_LOCAL_BINARY_PATH");
  const localExtensions = getOption(
    raw,
    "extensions",
    "REMOTE_CHILD_LOCAL_EXTENSIONS_DIR",
    resolve(".yalc", "@dyyz1993", "pi-coding-agent", "dist", "extensions"),
  );
  const remoteRuntimeDir = getOption(
    raw,
    "remote-runtime-dir",
    "REMOTE_CHILD_REMOTE_RUNTIME_DIR",
    "~/.pi/agent/remote-runtime/child",
  );
  const remoteAgentDir = getOption(
    raw,
    "remote-agent-dir",
    "REMOTE_PI_AGENT_DIR",
    "~/.pi/agent-remote-child-verify",
  );
  const remoteShell = getOption(raw, "shell", "REMOTE_CHILD_SHELL", "zsh -lc");
  const binaryName = getOption(raw, "binary-name", "REMOTE_CHILD_BINARY_NAME", "pi");
  const concurrency = Number(getOption(raw, "concurrency", "REMOTE_CHILD_VERIFY_CONCURRENCY", "2"));

  return {
    target,
    remoteProject,
    localBinary,
    localExtensions,
    remoteRuntimeDir,
    remoteShell,
    remoteAgentDir,
    binaryName,
    concurrency: Number.isFinite(concurrency) && concurrency > 0 ? concurrency : 2,
  };
}

function assertOption(value: string, message: string): void {
  if (!value) throw new Error(message);
}

function extensionArgs(remoteExtensionsDir: string): string[] {
  return [
    "--no-extensions",
    "--extension",
    `${remoteExtensionsDir}/auto-memory/index.ts`,
    "--extension",
    `${remoteExtensionsDir}/bash-ext/index.ts`,
    "--extension",
    `${remoteExtensionsDir}/file-snapshot/index.ts`,
    "--extension",
    `${remoteExtensionsDir}/todo-ext/index.ts`,
  ];
}

async function checkClient(
  client: RpcClient,
  remoteProject: string,
): Promise<{ checks: CheckResult[]; details: Record<string, unknown> }> {
  const checks: CheckResult[] = [];
  const details: Record<string, unknown> = {};

  const state = await client.getState();
  const model = state.model as
    | { provider?: string; id?: string; name?: string; api?: string }
    | string
    | undefined;
  const modelDetail =
    typeof model === "string"
      ? model
      : `${model?.provider ?? model?.api ?? "unknown"}/${model?.id ?? model?.name ?? "unknown"}`;
  details.state = { model };
  checks.push({ name: "state", ok: Boolean(state), detail: modelDetail });

  const extensions = await client.getExtensions();
  details.extensions = extensions.map((entry) => entry.name ?? entry.path ?? entry);
  checks.push({
    name: "extensions",
    ok: extensions.length > 0,
    detail: `${extensions.length} loaded`,
  });

  const bash = await client.bash("pwd");
  details.bash = bash;
  checks.push({
    name: "bash remote cwd",
    ok: bash.exitCode === 0 && bash.output.includes(remoteProject),
    detail: bash.output.trim(),
  });

  const memoryList = (await client.channel("memory").call("memory.list", {}, 5_000)) as {
    memoryDir?: string;
  };
  details.memoryList = memoryList;
  checks.push({
    name: "memory.list",
    ok: typeof memoryList.memoryDir === "string" && memoryList.memoryDir.length > 0,
    detail: memoryList.memoryDir,
  });

  const memoryStatus = await client.channel("memory").call("memory.getStatus", {}, 5_000);
  details.memoryStatusKeys = Object.keys(memoryStatus as Record<string, unknown>).sort();
  checks.push({
    name: "memory.getStatus",
    ok: Object.prototype.hasOwnProperty.call(memoryStatus, "skipRules"),
    detail: Object.keys(memoryStatus as Record<string, unknown>).sort().join(","),
  });

  return { checks, details };
}

async function main(): Promise<void> {
  const options = getOptions();
  assertOption(options.target, "Missing --target or REMOTE_SSH_TARGET");
  assertOption(options.remoteProject, "Missing --remote-project or REMOTE_CHILD_PROJECT_PATH");
  assertOption(options.localBinary, "Missing --binary or REMOTE_CHILD_LOCAL_BINARY_PATH");
  if (!existsSync(options.localBinary)) {
    throw new Error(`Local remote child binary does not exist: ${options.localBinary}`);
  }
  if (!existsSync(options.localExtensions)) {
    throw new Error(`Local extensions directory does not exist: ${options.localExtensions}`);
  }

  const boot = await bootstrapRemoteChild({
    target: options.target,
    remoteShell: options.remoteShell,
    remoteRuntimeDir: options.remoteRuntimeDir,
    localBinaryPath: options.localBinary,
    localExtensionsDir: options.localExtensions,
    binaryName: options.binaryName,
  });
  if (!boot.remoteExtensionsDir) {
    throw new Error("Remote child bootstrap did not produce a remote extensions directory.");
  }

  const clients = Array.from({ length: options.concurrency }, (_, index) => {
    const name = `verify-${Date.now()}-${index + 1}`;
    return new RpcClient({
      cliPath: boot.remoteBinaryPath,
      cwd: "/tmp/pi-agent-remote-child-shadow",
      args: extensionArgs(boot.remoteExtensionsDir!),
      remoteSsh: {
        target: options.target,
        cwd: options.remoteProject,
        nodePath: "",
        shell: options.remoteShell,
        env: {
          PI_CODING_AGENT_DIR: `${options.remoteAgentDir}/${name}`,
        },
      },
    });
  });

  try {
    await Promise.all(clients.map((client) => client.start()));
    const results = await Promise.all(
      clients.map(async (client, index) => ({
        index: index + 1,
        ...(await checkClient(client, options.remoteProject)),
      })),
    );
    const checks = [
      {
        name: "bootstrap binary",
        ok: Boolean(boot.remoteBinaryPath),
        detail: boot.remoteBinaryPath,
      },
      {
        name: "bootstrap extensions",
        ok: Boolean(boot.remoteExtensionsDir),
        detail: boot.remoteExtensionsDir,
      },
      ...results.flatMap((result) =>
        result.checks.map((check) => ({ ...check, name: `client ${result.index}: ${check.name}` })),
      ),
    ];
    const ok = checks.every((check) => check.ok);
    const output = {
      ok,
      target: options.target,
      remoteProject: options.remoteProject,
      concurrency: options.concurrency,
      bootstrap: {
        uploaded: boot.uploaded,
        uploadedExtensions: boot.uploadedExtensions,
        sha256: boot.sha256,
        remoteBinaryPath: boot.remoteBinaryPath,
        remoteExtensionsDir: boot.remoteExtensionsDir,
      },
      checks,
      clients: results.map((result) => ({ index: result.index, details: result.details })),
    };
    console.log(JSON.stringify(output, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await Promise.all(clients.map((client) => client.stop().catch(() => {})));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
