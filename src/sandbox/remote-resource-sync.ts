import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import { getPiAgentDir } from "../shared/lib/pi-agent-paths";
import { buildScpArgs, buildSshArgs, shQuote, shRemotePath } from "./providers/ssh";

export type RemoteSyncResourceType = "skills" | "agents" | "rules";

export interface RemoteResourceSyncOptions {
  target: string;
  port?: number;
  keyPath?: string;
  remoteShell: string;
  remoteAgentDir: string;
  localAgentDir?: string;
  resourceTypes?: RemoteSyncResourceType[];
  extraSources?: RemoteResourceSyncSource[];
  userAgentsSkillsDir?: string | false;
}

export interface RemoteResourceSyncSource {
  type: RemoteSyncResourceType;
  localPath: string;
}

export interface RemoteResourceSyncManifest {
  schemaVersion: "remote-resource-sync/v1";
  managedBy: "pi-agent-chat";
  generatedAt: string;
  localAgentDir: string;
  resources: Array<{
    type: RemoteSyncResourceType;
    hash: string;
    files: number;
    bytes: number;
  }>;
  blocked: Array<{
    path: string;
    reason: string;
  }>;
  hash: string;
}

export interface RemoteResourceSyncResult {
  remoteAgentDir: string;
  hash: string;
  uploaded: boolean;
  resources: RemoteResourceSyncManifest["resources"];
  blocked: RemoteResourceSyncManifest["blocked"];
}

export const DEFAULT_RESOURCE_TYPES: RemoteSyncResourceType[] = ["skills", "agents", "rules"];
const REMOTE_RESOURCE_TYPES = new Set<RemoteSyncResourceType>(DEFAULT_RESOURCE_TYPES);
const SKIP_DIR_NAMES = new Set([
  ".git",
  "node_modules",
  ".DS_Store",
  "__tests__",
  "dist",
  "build",
]);
const BLOCKED_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  "auth.json",
  "oauth.json",
  "models.json",
  "id_rsa",
  "id_ed25519",
  "known_hosts",
]);

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

function wrapRemoteShell(remoteShell: string, command: string): string {
  return `${remoteShell} ${shQuote(command)}`;
}

function shouldSkipEntry(name: string): string | null {
  if (SKIP_DIR_NAMES.has(name)) return "excluded development/cache directory";
  if (BLOCKED_FILE_NAMES.has(name)) return "blocked sensitive filename";
  if (name.endsWith(".pem") || name.endsWith(".key")) return "blocked sensitive file extension";
  return null;
}

function copySafeDirectory(
  source: string,
  destination: string,
  blocked: RemoteResourceSyncManifest["blocked"],
): void {
  const sourceStat = lstatSync(source);
  if (sourceStat.isSymbolicLink()) {
    blocked.push({ path: source, reason: "symbolic links are not synced" });
    return;
  }
  if (!sourceStat.isDirectory()) return;

  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(source).sort()) {
    const reason = shouldSkipEntry(entry);
    const sourcePath = join(source, entry);
    if (reason) {
      blocked.push({ path: sourcePath, reason });
      continue;
    }

    const destinationPath = join(destination, entry);
    const stat = lstatSync(sourcePath);
    if (stat.isSymbolicLink()) {
      blocked.push({ path: sourcePath, reason: "symbolic links are not synced" });
      continue;
    }
    if (stat.isDirectory()) {
      copySafeDirectory(sourcePath, destinationPath, blocked);
      continue;
    }
    if (stat.isFile()) {
      cpSync(sourcePath, destinationPath, { dereference: false });
    }
  }
}

function updateHashWithDirectory(
  hash: ReturnType<typeof createHash>,
  dir: string,
  prefix = "",
): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  if (!existsSync(dir)) return { files, bytes };

  for (const entry of readdirSync(dir).sort()) {
    const fullPath = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const child = updateHashWithDirectory(hash, fullPath, rel);
      files += child.files;
      bytes += child.bytes;
    } else if (stat.isFile()) {
      const content = readFileSync(fullPath);
      hash.update(`file:${rel}:${stat.size}:`);
      hash.update(content);
      files += 1;
      bytes += stat.size;
    }
  }
  return { files, bytes };
}

export function resolveRemoteSyncedAgentDir(options: {
  remoteResourceAgentDir?: string;
  remoteChildRemoteRuntimeDir: string;
}): string {
  return options.remoteResourceAgentDir ?? `${options.remoteChildRemoteRuntimeDir}/agent-resources`;
}

export function collectRemoteSyncSources(options?: {
  localAgentDir?: string;
  resourceTypes?: RemoteSyncResourceType[];
  extraSources?: RemoteResourceSyncSource[];
  userAgentsSkillsDir?: string | false;
}): RemoteResourceSyncSource[] {
  const localAgentDir = options?.localAgentDir ?? getPiAgentDir();
  const resourceTypes = normalizeRemoteResourceTypes(options?.resourceTypes);
  const userAgentsSkillsDir =
    options?.userAgentsSkillsDir === false
      ? null
      : (options?.userAgentsSkillsDir ?? join(homedir(), ".agents", "skills"));
  const defaultSources = resourceTypes.map((type) => ({
    type,
    localPath: join(localAgentDir, type),
  }));
  if (resourceTypes.includes("skills") && userAgentsSkillsDir) {
    defaultSources.push({ type: "skills", localPath: userAgentsSkillsDir });
  }
  const seen = new Set<string>();
  const sources = defaultSources
    .concat(options?.extraSources ?? [])
    .filter(
      (source) =>
        REMOTE_RESOURCE_TYPES.has(source.type) &&
        existsSync(source.localPath) &&
        lstatSync(source.localPath).isDirectory(),
    )
    .filter((source) => {
      const key = `${source.type}\0${source.localPath}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return sources;
}

export function normalizeRemoteResourceTypes(
  resourceTypes?: RemoteSyncResourceType[],
): RemoteSyncResourceType[] {
  return (resourceTypes ?? DEFAULT_RESOURCE_TYPES).filter((type) =>
    REMOTE_RESOURCE_TYPES.has(type),
  );
}

export function stageRemoteResourceSync(options?: {
  localAgentDir?: string;
  resourceTypes?: RemoteSyncResourceType[];
  extraSources?: RemoteResourceSyncSource[];
  userAgentsSkillsDir?: string | false;
  now?: Date;
}): {
  stagingDir: string;
  manifest: RemoteResourceSyncManifest;
  hasResources: boolean;
} {
  const localAgentDir = options?.localAgentDir ?? getPiAgentDir();
  const stagingDir = mkdtempSync(join(tmpdir(), "pi-remote-resource-sync-"));
  const blocked: RemoteResourceSyncManifest["blocked"] = [];
  const resources: RemoteResourceSyncManifest["resources"] = [];

  for (const source of collectRemoteSyncSources({
    localAgentDir,
    resourceTypes: options?.resourceTypes,
    extraSources: options?.extraSources,
    userAgentsSkillsDir: options?.userAgentsSkillsDir,
  })) {
    const destination = join(stagingDir, source.type);
    copySafeDirectory(source.localPath, destination, blocked);
  }

  for (const type of normalizeRemoteResourceTypes(options?.resourceTypes)) {
    const destination = join(stagingDir, type);
    if (!existsSync(destination)) continue;
    const resourceHash = createHash("sha256");
    const stats = updateHashWithDirectory(resourceHash, destination, type);
    resources.push({
      type,
      hash: resourceHash.digest("hex"),
      files: stats.files,
      bytes: stats.bytes,
    });
  }

  const manifestBase = {
    schemaVersion: "remote-resource-sync/v1" as const,
    managedBy: "pi-agent-chat" as const,
    generatedAt: (options?.now ?? new Date()).toISOString(),
    localAgentDir,
    resources,
    blocked,
  };
  const aggregateHash = createHash("sha256");
  aggregateHash.update(JSON.stringify(manifestBase.resources));
  aggregateHash.update(JSON.stringify(manifestBase.blocked));
  for (const resource of resources) {
    const resourceDir = join(stagingDir, resource.type);
    updateHashWithDirectory(aggregateHash, resourceDir, resource.type);
  }
  const manifest: RemoteResourceSyncManifest = {
    ...manifestBase,
    hash: aggregateHash.digest("hex"),
  };
  const manifestDir = join(stagingDir, ".remote-resource-sync");
  mkdirSync(manifestDir, { recursive: true });
  writeFileSync(join(manifestDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return { stagingDir, manifest, hasResources: resources.length > 0 };
}

export function buildRemoteResourceSyncReadyCommand(options: {
  remoteAgentDir: string;
  hash: string;
}): string {
  return `test "$(cat ${shRemotePath(`${options.remoteAgentDir}/.remote-resource-sync/manifest.json`)} 2>/dev/null | grep '"hash"' | head -1 | sed 's/.*"hash"[[:space:]]*:[[:space:]]*"\\([^"]*\\)".*/\\1/' || true)" = ${shQuote(options.hash)}`;
}

export function buildRemoteResourceSyncInstallCommand(options: {
  remoteAgentDir: string;
  remoteTarball: string;
  hash: string;
}): string {
  const stagingDir = `${options.remoteAgentDir}/.remote-resource-sync/staging-${options.hash.slice(0, 12)}`;
  const syncDir = `${options.remoteAgentDir}/.remote-resource-sync`;
  return [
    `mkdir -p ${shRemotePath(syncDir)}`,
    `rm -rf ${shRemotePath(stagingDir)}`,
    `mkdir -p ${shRemotePath(stagingDir)}`,
    `tar xzf ${shRemotePath(options.remoteTarball)} -C ${shRemotePath(stagingDir)}`,
    `rm -rf ${shRemotePath(`${options.remoteAgentDir}/skills`)} ${shRemotePath(`${options.remoteAgentDir}/agents`)} ${shRemotePath(`${options.remoteAgentDir}/rules`)}`,
    `if test -d ${shRemotePath(`${stagingDir}/skills`)}; then mv ${shRemotePath(`${stagingDir}/skills`)} ${shRemotePath(`${options.remoteAgentDir}/skills`)}; fi`,
    `if test -d ${shRemotePath(`${stagingDir}/agents`)}; then mv ${shRemotePath(`${stagingDir}/agents`)} ${shRemotePath(`${options.remoteAgentDir}/agents`)}; fi`,
    `if test -d ${shRemotePath(`${stagingDir}/rules`)}; then mv ${shRemotePath(`${stagingDir}/rules`)} ${shRemotePath(`${options.remoteAgentDir}/rules`)}; fi`,
    `cp ${shRemotePath(`${stagingDir}/.remote-resource-sync/manifest.json`)} ${shRemotePath(`${syncDir}/manifest.json`)}`,
    `rm -rf ${shRemotePath(stagingDir)} ${shRemotePath(options.remoteTarball)}`,
  ].join(" && ");
}

export async function syncRemoteAgentResources(
  options: RemoteResourceSyncOptions,
): Promise<RemoteResourceSyncResult> {
  if (!options.target) {
    throw new Error("Remote resource sync requires an SSH target.");
  }

  const { stagingDir, manifest } = stageRemoteResourceSync({
    localAgentDir: options.localAgentDir,
    resourceTypes: options.resourceTypes,
    extraSources: options.extraSources,
    userAgentsSkillsDir: options.userAgentsSkillsDir,
  });
  const sshBase = {
    target: options.target,
    port: options.port,
    keyPath: options.keyPath,
  };
  let tarball = "";
  try {
    const readyCommand = wrapRemoteShell(
      options.remoteShell,
      buildRemoteResourceSyncReadyCommand({
        remoteAgentDir: options.remoteAgentDir,
        hash: manifest.hash,
      }),
    );
    const isReady = await exec("ssh", [...buildSshArgs(sshBase), readyCommand])
      .then(() => true)
      .catch(() => false);
    if (isReady) {
      return {
        remoteAgentDir: options.remoteAgentDir,
        hash: manifest.hash,
        uploaded: false,
        resources: manifest.resources,
        blocked: manifest.blocked,
      };
    }

    tarball = join(tmpdir(), `pi-remote-resources-${manifest.hash.slice(0, 16)}.tgz`);
    await exec("tar", ["-czf", tarball, "-C", stagingDir, "."]);
    const remoteTarball = `${options.remoteAgentDir}/.remote-resource-sync/${basename(tarball)}`;
    await exec("ssh", [
      ...buildSshArgs(sshBase),
      wrapRemoteShell(
        options.remoteShell,
        `mkdir -p ${shRemotePath(`${options.remoteAgentDir}/.remote-resource-sync`)}`,
      ),
    ]);
    await exec(
      "scp",
      buildScpArgs({
        ...sshBase,
        localPath: tarball,
        remotePath: remoteTarball,
      }),
    );
    await exec("ssh", [
      ...buildSshArgs(sshBase),
      wrapRemoteShell(
        options.remoteShell,
        buildRemoteResourceSyncInstallCommand({
          remoteAgentDir: options.remoteAgentDir,
          remoteTarball,
          hash: manifest.hash,
        }),
      ),
    ]);
    return {
      remoteAgentDir: options.remoteAgentDir,
      hash: manifest.hash,
      uploaded: true,
      resources: manifest.resources,
      blocked: manifest.blocked,
    };
  } finally {
    if (tarball) rmSync(tarball, { force: true });
    rmSync(stagingDir, { recursive: true, force: true });
  }
}
