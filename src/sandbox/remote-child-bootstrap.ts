import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { buildScpArgs, buildSshArgs, shQuote, shRemotePath } from "./providers/ssh";

export interface RemoteChildBootstrapOptions {
  target: string;
  port?: number;
  keyPath?: string;
  remoteShell: string;
  remoteRuntimeDir: string;
  localBinaryPath: string;
  localExtensionsDir?: string;
  binaryName?: string;
}

export interface RemoteChildBootstrapResult {
  remoteBinaryPath: string;
  remoteRuntimeDir: string;
  remoteExtensionsDir?: string;
  sha256: string;
  uploaded: boolean;
  uploadedExtensions: boolean;
}

function exec(cmd: string, args: string[], timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, timeout }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`${cmd} ${args.join(" ")} failed: ${err.message}\nstderr: ${stderr}`));
        return;
      }
      resolve(stdout);
    });
  });
}

export function sha256File(path: string): string {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

function updateHashWithDirectory(hash: ReturnType<typeof createHash>, dir: string, prefix = ""): void {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir).sort()) {
    if (entry === "node_modules" || entry === "__tests__") continue;
    const fullPath = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      updateHashWithDirectory(hash, fullPath, rel);
    } else if (stat.isFile()) {
      hash.update(`file:${rel}:${stat.size}:`);
      hash.update(readFileSync(fullPath));
    }
  }
}

export function sha256RemoteChildArtifact(options: {
  localBinaryPath: string;
  localExtensionsDir?: string;
}): string {
  const hash = createHash("sha256");
  hash.update("binary:");
  hash.update(readFileSync(options.localBinaryPath));
  if (options.localExtensionsDir && existsSync(options.localExtensionsDir)) {
    hash.update("extensions:");
    updateHashWithDirectory(hash, options.localExtensionsDir);
  }
  return hash.digest("hex");
}

export function buildRemoteChildPaths(options: {
  remoteRuntimeDir: string;
  localBinaryPath: string;
  sha256: string;
  binaryName?: string;
}): { remoteVersionDir: string; remoteBinaryPath: string; remoteHashPath: string; remoteUploadPath: string } {
  const binaryName = options.binaryName ?? basename(options.localBinaryPath) ?? "pi";
  const safeBinaryName = binaryName.replace(/[^a-zA-Z0-9._-]/g, "_") || "pi";
  const remoteVersionDir = `${options.remoteRuntimeDir}/children/${options.sha256.slice(0, 16)}`;
  const remoteBinaryPath = `${remoteVersionDir}/${safeBinaryName}`;
  return {
    remoteVersionDir,
    remoteBinaryPath,
    remoteHashPath: `${remoteBinaryPath}.sha256`,
    remoteUploadPath: `${remoteBinaryPath}.uploading`,
  };
}

export function buildRemoteChildExtensionsDir(remoteVersionDir: string): string {
  return `${remoteVersionDir}/extensions`;
}

export function buildRemoteChildReadyCommand(options: {
  remoteBinaryPath: string;
  remoteHashPath: string;
  remoteExtensionsDir?: string;
  sha256: string;
}): string {
  return [
    `test -x ${shRemotePath(options.remoteBinaryPath)}`,
    `test "$(cat ${shRemotePath(options.remoteHashPath)} 2>/dev/null || true)" = ${shQuote(options.sha256)}`,
    options.remoteExtensionsDir ? `test -d ${shRemotePath(options.remoteExtensionsDir)}` : "",
  ].filter(Boolean).join(" && ");
}

export function buildRemoteChildInstallExtensionsCommand(options: {
  remoteExtensionsDir: string;
  remoteExtensionsTarball: string;
}): string {
  return [
    `rm -rf ${shRemotePath(options.remoteExtensionsDir)}`,
    `mkdir -p ${shRemotePath(options.remoteExtensionsDir)}`,
    `tar xzf ${shRemotePath(options.remoteExtensionsTarball)} -C ${shRemotePath(options.remoteExtensionsDir)}`,
  ].join(" && ");
}

export function buildRemoteChildInstallCommand(options: {
  remoteVersionDir: string;
  remoteBinaryPath: string;
  remoteHashPath: string;
  remoteUploadPath: string;
  sha256: string;
}): string {
  return [
    `mkdir -p ${shRemotePath(options.remoteVersionDir)}`,
    `mv ${shRemotePath(options.remoteUploadPath)} ${shRemotePath(options.remoteBinaryPath)}`,
    `chmod 755 ${shRemotePath(options.remoteBinaryPath)}`,
    `printf %s ${shQuote(options.sha256)} > ${shRemotePath(options.remoteHashPath)}`,
  ].join(" && ");
}

function wrapRemoteShell(remoteShell: string, command: string): string {
  return `${remoteShell} ${shQuote(command)}`;
}

function normalizeRemotePlatform(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === "darwin") return "darwin";
  if (lower === "linux") return "linux";
  return lower;
}

function normalizeRemoteArch(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === "x86_64" || lower === "amd64") return "x64";
  if (lower === "aarch64") return "arm64";
  return lower;
}

export function getRemoteChildBinaryCandidates(options: {
  cliPath: string;
  remotePlatform?: string;
  remoteArch?: string;
}): string[] {
  const resolvedCliPath = existsSync(options.cliPath) ? realpathSync(options.cliPath) : options.cliPath;
  const distDir = dirname(resolvedCliPath);
  const platform = options.remotePlatform ? normalizeRemotePlatform(options.remotePlatform) : "";
  const arch = options.remoteArch ? normalizeRemoteArch(options.remoteArch) : "";
  const names = platform
    ? [
        arch ? `pi-${platform}-${arch}` : "",
        platform && arch === "x64" ? `pi-${platform}-x86_64` : "",
        platform && arch === "arm64" ? `pi-${platform}-aarch64` : "",
      ].filter(Boolean)
    : ["pi"];
  return Array.from(new Set(names.map((name) => join(distDir, name))));
}

export async function detectRemoteSystem(options: {
  target: string;
  port?: number;
  keyPath?: string;
  remoteShell: string;
}): Promise<{ platform: string; arch: string }> {
  const output = await exec(
    "ssh",
    [
      ...buildSshArgs({
        target: options.target,
        port: options.port,
        keyPath: options.keyPath,
      }),
      wrapRemoteShell(options.remoteShell, "uname -s && uname -m"),
    ],
    15_000,
  );
  const [platform = "", arch = ""] = output.split(/\r?\n/).filter(Boolean);
  return { platform, arch };
}

export async function resolveRemoteChildLocalBinaryPath(options: {
  explicitPath?: string;
  cliPath: string;
  target: string;
  port?: number;
  keyPath?: string;
  remoteShell: string;
}): Promise<string> {
  if (options.explicitPath) return options.explicitPath;
  let remoteSystem: { platform: string; arch: string } | null = null;
  try {
    remoteSystem = await detectRemoteSystem(options);
  } catch {
    remoteSystem = null;
  }
  const candidates = getRemoteChildBinaryCandidates({
    cliPath: options.cliPath,
    remotePlatform: remoteSystem?.platform,
    remoteArch: remoteSystem?.arch,
  });
  const found = candidates.find((candidate) => existsSync(candidate));
  if (found) return found;
  return "";
}

export async function bootstrapRemoteChild(
  options: RemoteChildBootstrapOptions,
): Promise<RemoteChildBootstrapResult> {
  if (!options.target) {
    throw new Error("Remote child bootstrap requires an SSH target.");
  }
  if (!options.localBinaryPath) {
    throw new Error("Remote child bootstrap requires REMOTE_CHILD_LOCAL_BINARY_PATH.");
  }
  if (!existsSync(options.localBinaryPath)) {
    throw new Error(`Remote child binary does not exist: ${options.localBinaryPath}`);
  }

  const sha256 = sha256RemoteChildArtifact({
    localBinaryPath: options.localBinaryPath,
    localExtensionsDir: options.localExtensionsDir,
  });
  const paths = buildRemoteChildPaths({
    remoteRuntimeDir: options.remoteRuntimeDir,
    localBinaryPath: options.localBinaryPath,
    sha256,
    binaryName: options.binaryName,
  });
  const shouldUploadExtensions = Boolean(
    options.localExtensionsDir && existsSync(options.localExtensionsDir),
  );
  const remoteExtensionsDir = shouldUploadExtensions
    ? buildRemoteChildExtensionsDir(paths.remoteVersionDir)
    : undefined;
  const sshBase = {
    target: options.target,
    port: options.port,
    keyPath: options.keyPath,
  };
  const readyCommand = wrapRemoteShell(
    options.remoteShell,
    buildRemoteChildReadyCommand({ ...paths, remoteExtensionsDir, sha256 }),
  );
  const isReady = await exec("ssh", [...buildSshArgs(sshBase), readyCommand])
    .then(() => true)
    .catch(() => false);
  if (isReady) {
    return {
      remoteBinaryPath: paths.remoteBinaryPath,
      remoteRuntimeDir: paths.remoteVersionDir,
      remoteExtensionsDir,
      sha256,
      uploaded: false,
      uploadedExtensions: false,
    };
  }

  await exec(
    "ssh",
    [
      ...buildSshArgs(sshBase),
      wrapRemoteShell(options.remoteShell, `mkdir -p ${shRemotePath(paths.remoteVersionDir)}`),
    ],
  );
  await exec(
    "scp",
    buildScpArgs({
      ...sshBase,
      localPath: options.localBinaryPath,
      remotePath: paths.remoteUploadPath,
    }),
  );
  await exec(
    "ssh",
    [
      ...buildSshArgs(sshBase),
      wrapRemoteShell(options.remoteShell, buildRemoteChildInstallCommand({ ...paths, sha256 })),
    ],
  );
  let uploadedExtensions = false;
  if (shouldUploadExtensions) {
    const tempDir = mkdtempSync(join(tmpdir(), "pi-remote-child-extensions-"));
    const tarball = join(tempDir, "extensions.tgz");
    try {
      await exec("tar", ["-czf", tarball, "-C", options.localExtensionsDir, "."]);
      const remoteExtensionsTarball = `${paths.remoteVersionDir}/extensions.tgz`;
      await exec(
        "scp",
        buildScpArgs({
          ...sshBase,
          localPath: tarball,
          remotePath: remoteExtensionsTarball,
        }),
      );
      if (!remoteExtensionsDir) {
        throw new Error("Remote extensions directory was not prepared");
      }
      await exec("ssh", [
        ...buildSshArgs(sshBase),
        wrapRemoteShell(
          options.remoteShell,
          buildRemoteChildInstallExtensionsCommand({
            remoteExtensionsDir,
            remoteExtensionsTarball,
          }),
        ),
      ]);
      uploadedExtensions = true;
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }

  return {
    remoteBinaryPath: paths.remoteBinaryPath,
    remoteRuntimeDir: paths.remoteVersionDir,
    remoteExtensionsDir,
    sha256,
    uploaded: true,
    uploadedExtensions,
  };
}
