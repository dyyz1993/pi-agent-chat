#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { RpcClient } from "@dyyz1993/pi-coding-agent";
import { bootstrapRemoteChild } from "../src/sandbox/remote-child-bootstrap";
import { buildSshArgs, shQuote, shRemotePath } from "../src/sandbox/providers/ssh";
import { buildRemoteAgentChildRuntimeEnv } from "../src/shared/agent/runtime-resource-env";
import { startModelProxy, type StartedModelProxy } from "../src/shared/agent/model-proxy";

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
  verifyModelProxy: boolean;
}

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

interface SentinelResources {
  id: string;
  localAgentDir: string;
  localSkillName: string;
  remoteSkillName: string;
  remoteAgentName: string;
  remoteMemoryFilename: string;
}

interface ClientSpec {
  index: number;
  name: string;
  remoteAgentDir: string;
  client: RpcClient;
  modelProxy?: StartedModelProxy;
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
  const remoteShell = getOption(raw, "shell", "REMOTE_CHILD_SHELL", "sh -lc");
  const binaryName = getOption(raw, "binary-name", "REMOTE_CHILD_BINARY_NAME", "pi");
  const concurrency = Number(getOption(raw, "concurrency", "REMOTE_CHILD_VERIFY_CONCURRENCY", "2"));
  const verifyModelProxy =
    getOption(raw, "verify-model-proxy", "REMOTE_CHILD_VERIFY_MODEL_PROXY", "1") !== "0";

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
    verifyModelProxy,
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

function exec(cmd: string, args: string[], timeout = 120_000): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} ${args.join(" ")} failed: ${err.message}\nstderr: ${stderr}`));
        return;
      }
      resolvePromise(stdout);
    });
  });
}

function wrapRemoteShell(remoteShell: string, command: string): string {
  return `${remoteShell} ${shQuote(command)}`;
}

function remoteDirname(remotePath: string): string {
  const index = remotePath.lastIndexOf("/");
  if (index <= 0) return ".";
  return remotePath.slice(0, index);
}

function expandLeadingTilde(remotePath: string, remoteHome: string): string {
  if (remotePath === "~") return remoteHome;
  if (remotePath.startsWith("~/")) return `${remoteHome}${remotePath.slice(1)}`;
  return remotePath;
}

async function ssh(options: Options, command: string): Promise<string> {
  return exec("ssh", [
    ...buildSshArgs({ target: options.target }),
    wrapRemoteShell(options.remoteShell, command),
  ]);
}

async function writeRemoteText(options: Options, remotePath: string, content: string): Promise<void> {
  await ssh(
    options,
    [
      `mkdir -p ${shRemotePath(remoteDirname(remotePath))}`,
      `printf %s ${shQuote(content)} > ${shRemotePath(remotePath)}`,
    ].join(" && "),
  );
}

function createSentinelResources(): SentinelResources {
  const id = `verify-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const localAgentDir = mkdtempSync(join(tmpdir(), "pi-local-resource-sentinel-"));
  const localSkillName = `local-only-${id}`;
  const remoteSkillName = `remote-skill-${id}`;
  const remoteAgentName = `remote-agent-${id}`;
  const remoteMemoryFilename = `remote-memory-${id}.md`;

  mkdirSync(join(localAgentDir, "skills"), { recursive: true });
  writeFileSync(
    join(localAgentDir, "skills", `${localSkillName}.md`),
    [
      "---",
      `name: ${localSkillName}`,
      "description: Local-only sentinel that must not be visible to remote child runtime.",
      "---",
      "",
      "This file intentionally lives only on the local machine.",
      "",
    ].join("\n"),
    "utf8",
  );

  return {
    id,
    localAgentDir,
    localSkillName,
    remoteSkillName,
    remoteAgentName,
    remoteMemoryFilename,
  };
}

async function installRemoteSentinels(
  options: Options,
  remoteAgentDir: string,
  sentinel: SentinelResources,
): Promise<void> {
  await writeRemoteText(
    options,
    `${remoteAgentDir}/skills/${sentinel.remoteSkillName}.md`,
    [
      "---",
      `name: ${sentinel.remoteSkillName}`,
      "description: Remote child runtime skill sentinel.",
      "---",
      "",
      "This skill exists only on the SSH remote runtime.",
      "",
    ].join("\n"),
  );
  await writeRemoteText(
    options,
    `${remoteAgentDir}/agents/${sentinel.remoteAgentName}.md`,
    [
      "---",
      `name: ${sentinel.remoteAgentName}`,
      "description: Remote child runtime agent sentinel.",
      "tools: bash",
      "---",
      "",
      "You are a remote child runtime sentinel agent.",
      "",
    ].join("\n"),
  );
}

function names(entries: Array<{ name?: string }>): string[] {
  return entries.map((entry) => entry.name).filter((name): name is string => Boolean(name));
}

async function checkClient(
  client: RpcClient,
  options: Options,
  remoteProject: string,
  remoteAgentDir: string,
  sentinel: SentinelResources,
  verifyModelProxy: boolean,
): Promise<{ checks: CheckResult[]; details: Record<string, unknown> }> {
  const checks: CheckResult[] = [];
  const details: Record<string, unknown> = {};

  const availableModels = await client.getAvailableModels();
  details.availableModels = availableModels.map((model) => ({
    provider: model.provider,
    id: model.id,
    name: model.name,
    api: model.api,
  }));
  checks.push({
    name: "available models",
    ok: !verifyModelProxy || availableModels.length > 0,
    detail: `${availableModels.length} available`,
  });

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
  checks.push({
    name: "state model resolved",
    ok: !verifyModelProxy || !modelDetail.includes("unknown/unknown"),
    detail: modelDetail,
  });

  const extensions = await client.getExtensions();
  details.extensions = extensions.map((entry) => entry.path);
  checks.push({
    name: "extensions",
    ok: extensions.length > 0,
    detail: `${extensions.length} loaded`,
  });

  const skills = await client.getSkills();
  const skillNames = names(skills);
  details.skills = skills.map((entry) => ({
    name: entry.name,
    filePath: entry.filePath,
    source: entry.sourceInfo?.scope ?? entry.sourceInfo,
  }));
  checks.push({
    name: "remote skill sentinel",
    ok: skillNames.includes(sentinel.remoteSkillName),
    detail: sentinel.remoteSkillName,
  });
  checks.push({
    name: "local skill not visible",
    ok: !skillNames.includes(sentinel.localSkillName),
    detail: sentinel.localSkillName,
  });

  const agents = await client.getAgents();
  const agentNames = names(agents);
  details.agents = agents.map((entry) => ({
    name: entry.name,
    filePath: entry.filePath,
    source: entry.source,
  }));
  checks.push({
    name: "remote agent sentinel",
    ok: agentNames.includes(sentinel.remoteAgentName),
    detail: sentinel.remoteAgentName,
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
    files?: Array<{ filename?: string; filePath?: string }>;
  };
  if (memoryList.memoryDir) {
    await writeRemoteText(
      options,
      `${memoryList.memoryDir}/${sentinel.remoteMemoryFilename}`,
      [
        "---",
        "name: remote-memory-sentinel",
        "description: Remote memory sentinel for remote child verifier.",
        "type: project",
        "---",
        "",
        `Remote runtime sentinel ${sentinel.id}.`,
        "",
      ].join("\n"),
    );
  }
  const memoryListAfter = (await client.channel("memory").call("memory.list", {}, 5_000)) as {
    memoryDir?: string;
    files?: Array<{ filename?: string; filePath?: string }>;
  };
  const memoryFileNames = (memoryListAfter.files ?? [])
    .map((entry) => entry.filename)
    .filter((filename): filename is string => Boolean(filename));
  details.memoryList = memoryListAfter;
  checks.push({
    name: "memory.list",
    ok: typeof memoryListAfter.memoryDir === "string" && memoryListAfter.memoryDir.length > 0,
    detail: memoryListAfter.memoryDir,
  });
  checks.push({
    name: "memory under remote agent dir",
    ok:
      typeof memoryListAfter.memoryDir === "string" &&
      memoryListAfter.memoryDir.includes(remoteAgentDir.split("/").slice(-1)[0] ?? remoteAgentDir),
    detail: `agentDir=${remoteAgentDir}; memoryDir=${memoryListAfter.memoryDir ?? ""}`,
  });
  checks.push({
    name: "remote memory sentinel",
    ok: memoryFileNames.includes(sentinel.remoteMemoryFilename),
    detail: sentinel.remoteMemoryFilename,
  });

  const memoryStatus = await client.channel("memory").call("memory.getStatus", {}, 5_000);
  details.memoryStatusKeys = Object.keys(memoryStatus as Record<string, unknown>).sort();
  checks.push({
    name: "memory.getStatus",
    ok: Object.prototype.hasOwnProperty.call(memoryStatus, "skipRules"),
    detail: Object.keys(memoryStatus as Record<string, unknown>).sort().join(","),
  });

  const systemPrompt = await client.getSystemPrompt();
  const systemPromptText = [systemPrompt.systemPrompt, ...(systemPrompt.appendSystemPrompt ?? [])].join("\n");
  details.systemPrompt = {
    chars: systemPromptText.length,
    containsRemoteProject: systemPromptText.includes(remoteProject),
    containsLocalAgentDir: systemPromptText.includes(sentinel.localAgentDir),
    containsLocalSkill: systemPromptText.includes(sentinel.localSkillName),
  };
  checks.push({
    name: "system prompt remote cwd",
    ok: systemPromptText.includes(remoteProject),
    detail: remoteProject,
  });
  checks.push({
    name: "system prompt no local sentinel path",
    ok: !systemPromptText.includes(sentinel.localAgentDir) && !systemPromptText.includes(sentinel.localSkillName),
    detail: sentinel.localAgentDir,
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
  const remoteHome = (await ssh(options, "pwd")).trim();
  const resolvedOptions = {
    ...options,
    remoteRuntimeDir: expandLeadingTilde(options.remoteRuntimeDir, remoteHome),
    remoteAgentDir: expandLeadingTilde(options.remoteAgentDir, remoteHome),
  };
  const sentinel = createSentinelResources();

  const boot = await bootstrapRemoteChild({
    target: resolvedOptions.target,
    remoteShell: resolvedOptions.remoteShell,
    remoteRuntimeDir: resolvedOptions.remoteRuntimeDir,
    localBinaryPath: resolvedOptions.localBinary,
    localExtensionsDir: resolvedOptions.localExtensions,
    binaryName: resolvedOptions.binaryName,
  });
  if (!boot.remoteExtensionsDir) {
    throw new Error("Remote child bootstrap did not produce a remote extensions directory.");
  }

  const modelProxies = await Promise.all(
    Array.from({ length: resolvedOptions.concurrency }, async () => {
      if (!resolvedOptions.verifyModelProxy) return undefined;
      const proxy = await startModelProxy();
      const modelCount = JSON.parse(proxy.env.PI_MODEL_PROXY_MODELS_JSON || "[]") as unknown[];
      if (modelCount.length === 0) {
        await proxy.stop().catch(() => {});
        throw new Error(
          "Model proxy verifier requires at least one locally configured model. Set REMOTE_CHILD_VERIFY_MODEL_PROXY=0 to skip this check.",
        );
      }
      return proxy;
    }),
  );

  const clientSpecs: ClientSpec[] = Array.from({ length: resolvedOptions.concurrency }, (_, index) => {
    const name = `verify-${Date.now()}-${index + 1}`;
    const remoteAgentDir = `${resolvedOptions.remoteAgentDir}/${name}`;
    const modelProxy = modelProxies[index];
    const client = new RpcClient({
      cliPath: boot.remoteBinaryPath,
      cwd: "/tmp/pi-agent-remote-child-shadow",
      args: extensionArgs(boot.remoteExtensionsDir!),
      remoteSsh: {
        target: resolvedOptions.target,
        cwd: resolvedOptions.remoteProject,
        sshArgs: modelProxy?.sshArgs,
        nodePath: "",
        shell: resolvedOptions.remoteShell,
        env: {
          ...buildRemoteAgentChildRuntimeEnv({
            remotePiAgentDir: remoteAgentDir,
            nodeOptions: "",
            modelProxyEnv: modelProxy?.env,
          }),
          PI_REMOTE_RUNTIME_DIR: boot.remoteRuntimeDir,
        },
      },
    });
    return { index: index + 1, name, remoteAgentDir, client, modelProxy };
  });

  try {
    await Promise.all(clientSpecs.map((spec) => installRemoteSentinels(resolvedOptions, spec.remoteAgentDir, sentinel)));
    await Promise.all(clientSpecs.map((spec) => spec.client.start()));
    const results = await Promise.all(
      clientSpecs.map(async (spec) => ({
        index: spec.index,
        name: spec.name,
        remoteAgentDir: spec.remoteAgentDir,
        ...(await checkClient(
          spec.client,
          resolvedOptions,
          resolvedOptions.remoteProject,
          spec.remoteAgentDir,
          sentinel,
          resolvedOptions.verifyModelProxy,
        )),
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
    const remoteResourceChecks = checks.filter((check) =>
      ["remote skill sentinel", "remote agent sentinel", "remote memory sentinel"].some((name) =>
        check.name.includes(name),
      ),
    );
    const localLeakChecks = checks.filter((check) =>
      ["local skill not visible", "system prompt no local sentinel path"].some((name) => check.name.includes(name)),
    );
    const output = {
      ok,
      runtimeKind: "remote-agent-child",
      target: resolvedOptions.target,
      remoteProject: resolvedOptions.remoteProject,
      remoteCwd: resolvedOptions.remoteProject,
      concurrency: resolvedOptions.concurrency,
      remoteResourcesVisible: remoteResourceChecks.every((check) => check.ok),
      localResourcesVisible: !localLeakChecks.every((check) => check.ok),
      modelProxyVerified: resolvedOptions.verifyModelProxy,
      resourceMatrix: {
        remoteSkillName: sentinel.remoteSkillName,
        remoteAgentName: sentinel.remoteAgentName,
        remoteMemoryFilename: sentinel.remoteMemoryFilename,
        localSkillName: sentinel.localSkillName,
        localAgentDir: sentinel.localAgentDir,
      },
      bootstrap: {
        uploaded: boot.uploaded,
        uploadedExtensions: boot.uploadedExtensions,
        sha256: boot.sha256,
        remoteBinaryPath: boot.remoteBinaryPath,
        remoteExtensionsDir: boot.remoteExtensionsDir,
      },
      checks,
      clients: results.map((result) => ({
        index: result.index,
        name: result.name,
        remoteAgentDir: result.remoteAgentDir,
        details: result.details,
      })),
    };
    console.log(JSON.stringify(output, null, 2));
    if (!ok) process.exitCode = 1;
  } finally {
    await Promise.all(clientSpecs.map((spec) => spec.client.stop().catch(() => {})));
    await Promise.all(clientSpecs.map((spec) => spec.modelProxy?.stop().catch(() => {})));
    rmSync(sentinel.localAgentDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
