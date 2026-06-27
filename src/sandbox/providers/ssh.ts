import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { createLogger } from "../../shared/lib/logger";
import { getProjectRoot } from "../../shared/lib/paths";
import type { ISandboxProvider, SandboxInstance, SandboxStatus } from "../types";

const log = createLogger("remote-ssh");

interface RemoteSshState {
  userId: string;
  endpoint: string;
  localPort: number;
  remoteBridgePort: number;
  remoteAgentDir: string;
  createdAt: number;
  lastActiveAt: number;
  status: SandboxStatus;
}

export interface RemoteSshProviderOptions {
  target: string;
  port?: number;
  keyPath?: string;
  localBasePort: number;
  remoteBridgePort: number;
  remoteProjectPath: string;
  remoteAgentDir: string;
  remotePiCliPath: string;
  remoteNodePath: string;
  remotePiAgentDir?: string;
  childNodeOptions: string;
  bootstrapPiPackage: boolean;
  localPiPackagePath: string;
  localWorkspacePackagesPath?: string;
  remoteShell: string;
}

export interface LocalScopePackage {
  name: string;
  path: string;
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

export function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shDoubleQuoteBody(value: string): string {
  return value.replace(/["\\`$]/g, (char) => `\\${char}`);
}

export function shRemotePath(value: string): string {
  if (value.startsWith("~/")) {
    return `"${"${HOME}"}/${shDoubleQuoteBody(value.slice(2))}"`;
  }
  return shQuote(value);
}

export function buildSshArgs(options: {
  target: string;
  port?: number;
  keyPath?: string;
  extra?: string[];
}): string[] {
  const args: string[] = [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=2",
  ];
  if (options.keyPath) args.push("-i", options.keyPath);
  if (options.port) args.push("-p", String(options.port));
  args.push(...(options.extra ?? []), options.target);
  return args;
}

export function buildScpArgs(options: {
  target: string;
  port?: number;
  keyPath?: string;
  localPath: string;
  remotePath: string;
}): string[] {
  const args: string[] = ["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"];
  if (options.keyPath) args.push("-i", options.keyPath);
  if (options.port) args.push("-P", String(options.port));
  args.push(options.localPath, `${options.target}:${options.remotePath}`);
  return args;
}

export function buildLsofListenPidsArgs(localPort: number): string[] {
  return ["-n", "-P", "-t", `-iTCP:${localPort}`, "-sTCP:LISTEN"];
}

export function encodeRemoteInstanceId(userId: string): string {
  return userId.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "default";
}

export function getRemoteAgentBundlePath(): string {
  const bundlePath = resolve(getProjectRoot(), "dist-server", "sandbox-agent.js");
  if (!existsSync(bundlePath)) {
    throw new Error(`Remote SSH runtime requires ${bundlePath}. Run: bash scripts/build-server.sh`);
  }
  return bundlePath;
}

export function buildRemoteStartCommand(options: RemoteSshProviderOptions): string {
  const remoteAgentPath = `${options.remoteAgentDir}/sandbox-agent.js`;
  const pidPath = `${options.remoteAgentDir}/bridge.pid`;
  const logPath = `${options.remoteAgentDir}/bridge.log`;
  const envParts = [
    `PI_CHILD_NODE_OPTIONS=${shQuote(options.childNodeOptions)}`,
    options.remotePiAgentDir ? `PI_CODING_AGENT_DIR=${shRemotePath(options.remotePiAgentDir)}` : "",
  ].filter(Boolean);

  return [
    `mkdir -p ${shRemotePath(options.remoteAgentDir)} ${shRemotePath(options.remoteProjectPath)}`,
    `if test -f ${shRemotePath(pidPath)}; then kill "$(cat ${shRemotePath(pidPath)})" 2>/dev/null || true; fi`,
    [
      "cd",
      shRemotePath(options.remoteProjectPath),
      "&&",
      "nohup",
      "env",
      ...envParts,
      shRemotePath(options.remoteNodePath),
      shRemotePath(remoteAgentPath),
      `--port=${options.remoteBridgePort}`,
      `--cli-path=${shRemotePath(options.remotePiCliPath)}`,
      `--cwd=${shRemotePath(options.remoteProjectPath)}`,
      `>${shRemotePath(logPath)}`,
      "2>&1",
      "&",
      `echo $! > ${shRemotePath(pidPath)}`,
    ].join(" "),
  ].join(" && ");
}

export function getDefaultLocalPiPackagePath(): string {
  return resolve(getProjectRoot(), ".yalc", "@dyyz1993", "pi-coding-agent");
}

function readPackageName(packageDir: string): string | null {
  try {
    const packageJson = JSON.parse(readFileSync(join(packageDir, "package.json"), "utf8")) as {
      name?: unknown;
    } | null;
    return typeof packageJson?.name === "string" ? packageJson.name : null;
  } catch {
    return null;
  }
}

export function getLocalScopePackages(
  localPiPackagePath: string,
  localWorkspacePackagesPath?: string,
): LocalScopePackage[] {
  const piPackageName = readPackageName(localPiPackagePath);
  const scopeName = piPackageName?.startsWith("@") ? piPackageName.split("/")[0] : null;
  if (scopeName && localWorkspacePackagesPath && existsSync(localWorkspacePackagesPath)) {
    return readdirSync(localWorkspacePackagesPath)
      .map((entry) => {
        const packageDir = join(localWorkspacePackagesPath, entry);
        const packageName = readPackageName(packageDir);
        return packageName?.startsWith(`${scopeName}/`) && packageName !== piPackageName
          ? { name: packageName.slice(scopeName.length + 1), path: packageDir }
          : null;
      })
      .filter((entry): entry is LocalScopePackage => Boolean(entry));
  }

  const scopeDir = dirname(localPiPackagePath);
  if (!existsSync(scopeDir)) return [];
  const currentPackageName = basename(localPiPackagePath);
  return readdirSync(scopeDir)
    .filter((entry) => entry !== currentPackageName)
    .map((entry) => ({ name: entry, path: join(scopeDir, entry) }))
    .filter((entry) => existsSync(join(entry.path, "package.json")));
}

export function getLocalScopePackageNames(
  localPiPackagePath: string,
  localWorkspacePackagesPath?: string,
): string[] {
  return getLocalScopePackages(localPiPackagePath, localWorkspacePackagesPath).map(
    (entry) => entry.name,
  );
}

export class RemoteSshProvider implements ISandboxProvider {
  private readonly options: RemoteSshProviderOptions;
  private readonly remotes = new Map<string, RemoteSshState>();
  private nextLocalPort: number;
  private nextRemoteBridgePort: number;

  constructor(options: RemoteSshProviderOptions) {
    this.options = options;
    this.nextLocalPort = options.localBasePort;
    this.nextRemoteBridgePort = options.remoteBridgePort;
  }

  async getOrCreate(userId: string): Promise<SandboxInstance> {
    const existing = this.remotes.get(userId);
    if (existing && (await this.isEndpointReady(existing.endpoint))) {
      existing.lastActiveAt = Date.now();
      return this.toInstance(existing);
    }
    return this.createRemote(userId);
  }

  async destroy(userId: string): Promise<void> {
    const state = this.remotes.get(userId);
    if (!state) return;
    await this.killTunnel(state.localPort).catch(() => {});
    await this.ssh(
      `if test -f ${shRemotePath(`${state.remoteAgentDir}/bridge.pid`)}; then kill "$(cat ${shRemotePath(`${state.remoteAgentDir}/bridge.pid`)})" 2>/dev/null || true; fi`,
    ).catch(() => {});
    this.remotes.delete(userId);
  }

  async getStatus(userId: string): Promise<SandboxInstance | null> {
    const state = this.remotes.get(userId);
    return state ? this.toInstance(state) : null;
  }

  keepAlive(userId: string): void {
    const state = this.remotes.get(userId);
    if (state) state.lastActiveAt = Date.now();
  }

  async shutdown(): Promise<void> {
    for (const userId of this.remotes.keys()) {
      await this.destroy(userId);
    }
  }

  private async createRemote(userId: string): Promise<SandboxInstance> {
    if (!this.options.target) throw new Error("REMOTE_SSH_TARGET is required for ssh runtime");
    if (!this.options.remoteProjectPath) {
      throw new Error("REMOTE_PROJECT_PATH is required for ssh runtime");
    }

    const localPort = this.nextLocalPort++;
    const remoteBridgePort = this.nextRemoteBridgePort++;
    const remoteAgentDir = `${this.options.remoteAgentDir}/instances/${encodeRemoteInstanceId(userId)}`;
    const endpoint = `http://127.0.0.1:${localPort}`;
    const bundlePath = getRemoteAgentBundlePath();
    const remoteBundlePath = `${remoteAgentDir}/${basename(bundlePath)}`;

    log.info("starting remote ssh runtime", {
      userId,
      target: this.options.target,
      remoteProjectPath: this.options.remoteProjectPath,
      localPort,
      remoteBridgePort,
      remoteAgentDir,
    });

    await this.ssh(`mkdir -p ${shRemotePath(remoteAgentDir)}`);
    await this.scp(bundlePath, remoteBundlePath);
    const remotePiCliPath = await this.resolveRemotePiCliPath();
    await this.ssh(
      buildRemoteStartCommand({
        ...this.options,
        remoteAgentDir,
        remoteBridgePort,
        remotePiCliPath,
      }),
    );
    await this.killTunnel(localPort).catch(() => {});
    await this.establishTunnel(localPort, remoteBridgePort);
    await this.waitForReady(endpoint);

    const state: RemoteSshState = {
      userId,
      endpoint,
      localPort,
      remoteBridgePort,
      remoteAgentDir,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      status: "ready",
    };
    this.remotes.set(userId, state);
    return this.toInstance(state);
  }

  private async ssh(command: string): Promise<string> {
    const remoteCommand = `${this.options.remoteShell} ${shQuote(command)}`;
    return exec("ssh", [...buildSshArgs(this.options), remoteCommand]);
  }

  private async scp(localPath: string, remotePath: string): Promise<void> {
    await exec(
      "scp",
      buildScpArgs({
        ...this.options,
        localPath,
        remotePath,
      }),
    );
  }

  private async resolveRemotePiCliPath(): Promise<string> {
    if (this.options.remotePiCliPath !== "pi") {
      return this.options.remotePiCliPath;
    }

    const existing = await this.ssh("command -v pi || true");
    if (existing.trim()) {
      return "pi";
    }

    if (!this.options.bootstrapPiPackage) {
      throw new Error(
        "Remote host has no pi command. Set REMOTE_BOOTSTRAP_PI_PACKAGE=true or REMOTE_PI_CLI_PATH.",
      );
    }

    return this.bootstrapPiPackage();
  }

  private async bootstrapPiPackage(): Promise<string> {
    const localPackagePath = this.options.localPiPackagePath;
    if (!existsSync(localPackagePath)) {
      throw new Error(`Local pi package not found: ${localPackagePath}`);
    }

    const tempDir = mkdtempSync(join(tmpdir(), "pi-remote-ssh-"));
    const tarball = join(tempDir, "pi-coding-agent.tgz");
    try {
      await exec("tar", ["-czf", tarball, "-C", localPackagePath, "."]);
      await this.ssh(`mkdir -p ${shRemotePath(this.options.remoteAgentDir)}`);
      const remoteTarball = `${this.options.remoteAgentDir}/pi-coding-agent.tgz`;
      const remotePackageDir = `${this.options.remoteAgentDir}/pi-coding-agent`;
      await this.scp(tarball, remoteTarball);
      await this.ssh(
        [
          `rm -rf ${shRemotePath(remotePackageDir)}`,
          `mkdir -p ${shRemotePath(remotePackageDir)}`,
          `tar xzf ${shRemotePath(remoteTarball)} -C ${shRemotePath(remotePackageDir)}`,
          [
            "cd",
            shRemotePath(remotePackageDir),
            "&&",
            "npm install --omit=dev --ignore-scripts --no-audit --no-fund",
          ].join(" "),
        ].join(" && "),
      );
      await this.installLocalScopePackages(remotePackageDir, tempDir);
      return `${remotePackageDir}/dist/cli.js`;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  private async installLocalScopePackages(
    remotePackageDir: string,
    tempDir: string,
  ): Promise<void> {
    const localPackages = getLocalScopePackages(
      this.options.localPiPackagePath,
      this.options.localWorkspacePackagesPath,
    );
    if (localPackages.length === 0) return;

    const packageName = readPackageName(this.options.localPiPackagePath);
    const scopeName = packageName?.startsWith("@")
      ? packageName.split("/")[0]
      : basename(dirname(this.options.localPiPackagePath));
    const remoteScopeDir = `${remotePackageDir}/node_modules/${scopeName}`;
    await this.ssh(`mkdir -p ${shRemotePath(remoteScopeDir)}`);

    for (const localPackage of localPackages) {
      const packageTarball = join(tempDir, `${localPackage.name}.tgz`);
      await exec("tar", ["-czf", packageTarball, "-C", localPackage.path, "."]);

      const remotePackageTarball = `${this.options.remoteAgentDir}/${basename(packageTarball)}`;
      const remotePackageDir = `${remoteScopeDir}/${localPackage.name}`;
      await this.scp(packageTarball, remotePackageTarball);
      await this.ssh(
        [
          `rm -rf ${shRemotePath(remotePackageDir)}`,
          `mkdir -p ${shRemotePath(remotePackageDir)}`,
          `tar xzf ${shRemotePath(remotePackageTarball)} -C ${shRemotePath(remotePackageDir)}`,
        ].join(" && "),
      );
    }
  }

  private async establishTunnel(localPort: number, remoteBridgePort: number): Promise<void> {
    const args = buildSshArgs({
      ...this.options,
      extra: ["-f", "-N", "-L", `${localPort}:127.0.0.1:${remoteBridgePort}`],
    });
    await exec("ssh", args);
  }

  private async killTunnel(localPort: number): Promise<void> {
    const out = await exec("lsof", buildLsofListenPidsArgs(localPort)).catch(() => "");
    for (const pid of out.trim().split("\n").filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGKILL");
      } catch {
        // best effort
      }
    }
  }

  private async waitForReady(endpoint: string, maxRetries = 20): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      if (await this.isEndpointReady(endpoint)) return;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));
    }
    throw new Error(`Remote SSH runtime ${endpoint} did not become ready`);
  }

  private async isEndpointReady(endpoint: string): Promise<boolean> {
    try {
      const res = await fetch(`${endpoint}/health`);
      return res.ok;
    } catch {
      return false;
    }
  }

  private toInstance(state: RemoteSshState): SandboxInstance {
    return {
      userId: state.userId,
      projectPath: this.options.remoteProjectPath,
      endpoint: state.endpoint,
      status: state.status,
      createdAt: state.createdAt,
      lastActiveAt: state.lastActiveAt,
      localPort: state.localPort,
    };
  }
}
