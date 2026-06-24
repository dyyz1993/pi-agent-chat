import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";

export function expandTildePath(path: string): string {
  return path.replace(/^~(?=$|\/)/, homedir());
}

export function getPiAgentDir(): string {
  const agentDir = process.env.PI_CODING_AGENT_DIR;
  return resolve(agentDir ? expandTildePath(agentDir) : join(homedir(), ".pi", "agent"));
}

export function getLegacyTrustStorePath(): string {
  return join(getPiAgentDir(), "trust.json");
}

export function getSessionsRoot(): string {
  return join(getPiAgentDir(), "sessions");
}

export function getUserMemoryDir(): string {
  return join(getPiAgentDir(), "memory");
}

export function getLegacyMemoryProjectDir(projectPath: string): string {
  return join(getUserMemoryDir(), getSessionBucketKey(projectPath));
}

export function normalizeProjectPath(projectPath: string): string {
  const resolved = resolve(projectPath);
  try {
    return realpathSync.native(resolved);
  } catch {
    return resolved;
  }
}

export function getProjectUserStateDir(projectPath: string): string {
  return join(getPiAgentDir(), "projects", encodeProjectPath(normalizeProjectPath(projectPath)));
}

export function getProjectTrustStorePath(projectPath: string): string {
  return join(getProjectUserStateDir(projectPath), "trust.json");
}

export function getProjectPathPermissionsPath(projectPath: string): string {
  return join(getProjectUserStateDir(projectPath), "path-permissions.json");
}

export function getProjectExecutionSandboxPath(projectPath: string): string {
  return join(getProjectUserStateDir(projectPath), "execution-sandbox.json");
}

export function getSessionBucketKey(projectPath: string): string {
  return `--${projectPath.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
}

export function getProjectSessionDir(projectPath: string): string {
  return join(getSessionsRoot(), getSessionBucketKey(projectPath));
}

export function encodeProjectPath(projectPath: string): string {
  return `${fnv1aHash(projectPath)}--${sanitizeBasename(projectPath)}`;
}

function fnv1aHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeBasename(path: string): string {
  return (
    basename(path)
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 48) || "project"
  );
}

export function isPathInsideUserMemoryDir(path: string): boolean {
  const memoryBase = resolve(getUserMemoryDir());
  const projectStateBase = resolve(join(getPiAgentDir(), "projects"));
  const resolvedPath = resolve(path);
  const insideUserMemory =
    resolvedPath === memoryBase ||
    resolvedPath.startsWith(`${memoryBase}/`) ||
    resolvedPath.startsWith(`${memoryBase}\\`);
  const insideProjectMemory =
    resolvedPath.startsWith(`${projectStateBase}/`) ||
    resolvedPath.startsWith(`${projectStateBase}\\`);
  const projectRelative = resolvedPath.slice(projectStateBase.length).replace(/^[/\\]/, "");
  const projectSegments = projectRelative.split(/[/\\]/);
  const isProjectMemoryPath = projectSegments.length >= 2 && projectSegments[1] === "memory";
  return insideUserMemory || (insideProjectMemory && isProjectMemoryPath);
}

export function hasPiAgentDir(): boolean {
  return existsSync(getPiAgentDir());
}
