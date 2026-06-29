#!/usr/bin/env bun
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface Options {
  projectPath: string;
  forkPath: string;
  apiPort: number;
  webPort: number;
  keepTemp: boolean;
}

interface Check {
  name: string;
  detail: string;
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq >= 0) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      out[arg.slice(2)] = true;
      continue;
    }
    out[arg.slice(2)] = next;
    i++;
  }
  return out;
}

function asNumber(value: string | boolean | undefined, fallback: number): number {
  if (typeof value !== "string" || !value.trim()) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getOptions(): Options {
  const raw = parseArgs(process.argv.slice(2));
  const projectPath = resolve(
    typeof raw["project-path"] === "string" ? raw["project-path"] : process.cwd(),
  );
  const forkPath = resolve(
    typeof raw["fork-path"] === "string"
      ? raw["fork-path"]
      : join(projectPath, "..", "pi-momo-fork"),
  );
  return {
    projectPath,
    forkPath,
    apiPort: asNumber(raw["api-port"], 3102),
    webPort: asNumber(raw["web-port"], 5175),
    keepTemp: raw["keep-temp"] === true,
  };
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    result[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return result;
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

async function exec(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const result = await execFileAsync(cmd, args, {
    env,
    cwd: process.cwd(),
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
}

async function gitBranch(repoPath: string): Promise<string> {
  const output = await exec("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"]);
  return output.trim();
}

function createMockServer() {
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  return {
    handlers,
    subscriptions: new Map(),
    emitEvent: () => {},
    register(method: string, handler: (params: unknown) => Promise<unknown>) {
      handlers.set(method, handler);
    },
  };
}

async function main(): Promise<void> {
  const options = getOptions();
  assert(existsSync(options.projectPath), `Project path does not exist: ${options.projectPath}`);
  assert(existsSync(options.forkPath), `Fork path does not exist: ${options.forkPath}`);

  const tempRoot = mkdtempSync(join(tmpdir(), "pi-worktree-stack-verify-"));
  const piHome = join(tempRoot, ".pi");
  const chatHome = join(piHome, "chat");
  const stateDir = join(chatHome, "worktrees");
  const registryDir = join(stateDir, "registry");
  const checks: Check[] = [];

  const originalEnv = {
    PI_HOME: process.env.PI_HOME,
    PI_CHAT_HOME: process.env.PI_CHAT_HOME,
    PI_WORKTREE_STATE_DIR: process.env.PI_WORKTREE_STATE_DIR,
    PI_WORKTREE_REGISTRY_DIR: process.env.PI_WORKTREE_REGISTRY_DIR,
  };

  try {
    process.env.PI_HOME = piHome;
    process.env.PI_CHAT_HOME = chatHome;
    process.env.PI_WORKTREE_STATE_DIR = stateDir;
    process.env.PI_WORKTREE_REGISTRY_DIR = registryDir;

    const { getWorktreeStackId } = await import("../src/shared/lib/worktree-stack-manifest");
    const stackId = getWorktreeStackId(options.projectPath);
    const configDir = join(stateDir, stackId);
    const agentDir = join(configDir, "agent");
    const agentCliPath = join(options.forkPath, "packages/coding-agent", "dist", "cli.js");
    const forkBranch = await gitBranch(options.forkPath);
    const appBranch = await gitBranch(options.projectPath);
    const registryFile = join(registryDir, `${stackId}.env`);
    const manifestPath = join(configDir, "manifest.json");
    const scriptPath = join(process.cwd(), "scripts", "worktree-common.sh");

    await exec(
      "bash",
      [
        "-lc",
        [
          `source ${shQuote(scriptPath)}`,
          `wt_write_registry ${shQuote(options.projectPath)} ${options.apiPort} ${options.webPort} ${shQuote(configDir)} ${shQuote(options.forkPath)} ${shQuote(options.forkPath)} ${shQuote(forkBranch)} ${shQuote(agentCliPath)} ${shQuote(agentDir)}`,
        ].join("\n"),
      ],
      {
        ...process.env,
        PI_HOME: piHome,
        PI_CHAT_HOME: chatHome,
        PI_WORKTREE_STATE_DIR: stateDir,
        PI_WORKTREE_REGISTRY_DIR: registryDir,
      },
    );

    assert(existsSync(registryFile), `Registry file was not created: ${registryFile}`);
    assert(existsSync(manifestPath), `Manifest file was not created: ${manifestPath}`);

    const registry = parseEnvFile(readFileSync(registryFile, "utf8"));
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

    assert(registry.APP_PATH === options.projectPath, "Registry APP_PATH mismatch");
    assert(registry.AGENT_WORKTREE_PATH === options.forkPath, "Registry AGENT_WORKTREE_PATH mismatch");
    assert(registry.AGENT_CLI_PATH === agentCliPath, "Registry AGENT_CLI_PATH mismatch");
    assert(Number(registry.API_PORT) === options.apiPort, "Registry API_PORT mismatch");
    assert(Number(registry.VITE_PORT) === options.webPort, "Registry VITE_PORT mismatch");
    checks.push({
      name: "script registry + manifest bootstrap",
      detail: `${registryFile} -> api ${registry.API_PORT}, web ${registry.VITE_PORT}`,
    });

    assert(manifest.id === stackId, "Manifest stack id mismatch");
    assert(manifest.appConfigDir === configDir, "Manifest appConfigDir mismatch");
    assert(manifest.agentDir === agentDir, "Manifest agentDir mismatch");
    assert(manifest.runtime?.piCliPath === agentCliPath, "Manifest piCliPath mismatch");
    assert(manifest.repos?.[0]?.worktreePath === options.projectPath, "Manifest app repo mismatch");
    assert(
      manifest.repos?.find((entry: { role: string }) => entry.role === "runtime-fork")?.worktreePath ===
        options.forkPath,
      "Manifest runtime fork repo mismatch",
    );
    assert(Array.isArray(manifest.orchestration?.batches), "Manifest orchestration missing batches");
    assert(manifest.orchestration.batches.length === 0, "Manifest should start with empty batches");
    checks.push({
      name: "manifest seed shape",
      detail: `${manifestPath} -> app ${appBranch}, fork ${forkBranch}`,
    });

    const { register } = await import("../src/shared/handlers/project");
    const server = createMockServer();
    register(server as never, { platform: "desktop" });

    const getManifest = server.handlers.get("project.getWorktreeStackManifest");
    const updateManifest = server.handlers.get("project.updateWorktreeStackOrchestration");
    const getExecutionContext = server.handlers.get("project.getWorktreeStackExecutionContext");

    assert(getManifest, "Missing project.getWorktreeStackManifest handler");
    assert(updateManifest, "Missing project.updateWorktreeStackOrchestration handler");
    assert(getExecutionContext, "Missing project.getWorktreeStackExecutionContext handler");

    const initial = (await getManifest({ projectPath: options.projectPath })) as {
      manifestPath: string;
      manifest: { orchestration: { batches: unknown[]; issues: unknown[]; workers: unknown[] } } | null;
    };
    assert(initial.manifestPath === manifestPath, "Initial manifestPath mismatch");
    assert(initial.manifest, "Initial manifest missing");
    assert(initial.manifest.orchestration.batches.length === 0, "Initial batches should be empty");
    assert(initial.manifest.orchestration.issues.length === 0, "Initial issues should be empty");
    assert(initial.manifest.orchestration.workers.length === 0, "Initial workers should be empty");

    await updateManifest({
      projectPath: options.projectPath,
      leaderSessionId: "leader-session-verify",
      upsertBatches: [
        {
          id: "batch-runtime",
          title: "Runtime + app batch",
          status: "planned",
          issueIds: ["issue-runtime"],
        },
      ],
      upsertIssues: [
        {
          id: "issue-runtime",
          title: "Patch paired fork flow",
          status: "ready",
          priority: "high",
          repo: "both",
          batchId: "batch-runtime",
        },
      ],
      upsertWorkers: [
        {
          id: "worker-runtime",
          agent: "pi-worktree-dev",
          status: "assigned",
          issueId: "issue-runtime",
          sessionId: "worker-session-verify",
          repo: "both",
          branch: appBranch,
          worktreePath: options.projectPath,
        },
      ],
    });

    const assigned = (await getManifest({ projectPath: options.projectPath })) as {
      manifest: {
        orchestration: {
          batches: Array<{ id: string; status: string }>;
          issues: Array<{ id: string; status: string; assigneeWorkerId?: string | null }>;
          workers: Array<{ id: string; status: string; repo?: string }>;
        };
      } | null;
    };
    assert(assigned.manifest, "Assigned manifest missing");
    assert(assigned.manifest.orchestration.batches[0]?.status === "active", "Batch should be active after assignment");
    assert(assigned.manifest.orchestration.issues[0]?.status === "ready", "Issue should stay ready after assignment");
    assert(
      assigned.manifest.orchestration.issues[0]?.assigneeWorkerId === "worker-runtime",
      "Issue assignee mismatch",
    );
    assert(
      assigned.manifest.orchestration.workers[0]?.status === "assigned",
      "Worker should be assigned after first update",
    );
    checks.push({
      name: "handler assignment flow",
      detail: "batch active, issue ready, worker assigned",
    });

    await updateManifest({
      projectPath: options.projectPath,
      upsertWorkers: [
        {
          id: "worker-runtime",
          status: "running",
        },
      ],
    });

    const running = (await getManifest({ projectPath: options.projectPath })) as {
      manifest: {
        orchestration: {
          batches: Array<{ status: string }>;
          issues: Array<{ status: string }>;
          workers: Array<{ status: string }>;
        };
      } | null;
    };
    assert(running.manifest, "Running manifest missing");
    assert(running.manifest.orchestration.batches[0]?.status === "active", "Batch should stay active while running");
    assert(
      running.manifest.orchestration.issues[0]?.status === "in_progress",
      "Issue should move to in_progress while worker runs",
    );
    assert(
      running.manifest.orchestration.workers[0]?.status === "running",
      "Worker should be running after second update",
    );
    checks.push({
      name: "handler running flow",
      detail: "batch active, issue in_progress, worker running",
    });

    await updateManifest({
      projectPath: options.projectPath,
      upsertWorkers: [
        {
          id: "worker-runtime",
          status: "done",
        },
      ],
    });

    const context = (await getExecutionContext({
      projectPath: options.projectPath,
      workerId: "worker-runtime",
    })) as {
      batch: { status: string } | null;
      issue: { status: string; repo?: string } | null;
      worker: { status: string; sessionId?: string | null } | null;
      appRepo: { worktreePath: string } | null;
      runtimeForkRepo: { worktreePath: string } | null;
      apiService: { port: number } | null;
      webService: { port: number } | null;
      targetRepoRoles: string[];
      targetAppWorktreePath: string | null;
      targetRuntimeForkWorktreePath: string | null;
      manifestPath: string;
    };

    assert(context.manifestPath === manifestPath, "Execution context manifestPath mismatch");
    assert(context.batch?.status === "done", "Batch should be done at the end");
    assert(context.issue?.status === "done", "Issue should be done at the end");
    assert(context.issue?.repo === "both", "Issue repo should stay both");
    assert(context.worker?.status === "done", "Worker should be done at the end");
    assert(context.worker?.sessionId === "worker-session-verify", "Worker session id mismatch");
    assert(context.appRepo?.worktreePath === options.projectPath, "Execution context app repo mismatch");
    assert(context.runtimeForkRepo?.worktreePath === options.forkPath, "Execution context runtime fork mismatch");
    assert(context.apiService?.port === options.apiPort, "Execution context api port mismatch");
    assert(context.webService?.port === options.webPort, "Execution context web port mismatch");
    assert(
      context.targetRepoRoles.join(",") === "app,runtime-fork",
      "Execution context targetRepoRoles mismatch",
    );
    assert(
      context.targetAppWorktreePath === options.projectPath,
      "Execution context target app worktree mismatch",
    );
    assert(
      context.targetRuntimeForkWorktreePath === options.forkPath,
      "Execution context target runtime fork worktree mismatch",
    );
    checks.push({
      name: "execution context resolution",
      detail: `api ${context.apiService?.port}, web ${context.webService?.port}, roles ${context.targetRepoRoles.join("+")}`,
    });

    console.log("worktree-stack orchestration verification passed");
    console.log(
      JSON.stringify(
        {
          tempRoot,
          projectPath: options.projectPath,
          forkPath: options.forkPath,
          manifestPath,
          registryFile,
          checks,
        },
        null,
        2,
      ),
    );
  } finally {
    process.env.PI_HOME = originalEnv.PI_HOME;
    process.env.PI_CHAT_HOME = originalEnv.PI_CHAT_HOME;
    process.env.PI_WORKTREE_STATE_DIR = originalEnv.PI_WORKTREE_STATE_DIR;
    process.env.PI_WORKTREE_REGISTRY_DIR = originalEnv.PI_WORKTREE_REGISTRY_DIR;

    if (!options.keepTemp) {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  }
}

await main();
