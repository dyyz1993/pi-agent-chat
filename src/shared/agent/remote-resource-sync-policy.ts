import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { config } from "../../server-config";
import {
  normalizeRemoteResourceTypes,
  resolveRemoteSyncedAgentDir,
} from "../../sandbox/remote-resource-sync";
import type {
  RemoteResourceSyncOptions,
  RemoteResourceSyncSource,
  RemoteSyncResourceType,
} from "../../sandbox/remote-resource-sync";
import { getProjectUserStateDir } from "../lib/pi-agent-paths";
import {
  getLegacyTrustStorePath,
  getProjectTrustStorePath,
  normalizeProjectPath,
} from "../lib/pi-agent-paths";
import type { ActiveRuntimeSelection } from "./remote-runtime-selection";

export interface RemoteResourceSyncPlan {
  remoteAgentDir: string;
  localAgentDir?: string;
  resourceTypes?: RemoteSyncResourceType[];
  extraSources: RemoteResourceSyncSource[];
}

export function resolveRemoteResourceSyncPlan(options: {
  runtime: Extract<ActiveRuntimeSelection, { kind: "remote-agent-child" }>;
  cwd: string;
}): RemoteResourceSyncPlan | null {
  const projectSyncConfig =
    options.runtime.source === "remote-project"
      ? options.runtime.remoteProject?.remoteResourceSync
      : undefined;
  const hasProjectSyncConfig = projectSyncConfig !== undefined;
  const explicitResourceTypes = Array.isArray(projectSyncConfig?.resourceTypes);
  const resourceTypes = explicitResourceTypes
    ? normalizeRemoteResourceTypes(projectSyncConfig?.resourceTypes)
    : undefined;
  const enabled = hasProjectSyncConfig
    ? projectSyncConfig?.enabled !== false
    : config.remoteResourceSyncEnabled;

  if (!enabled || (explicitResourceTypes && resourceTypes && resourceTypes.length === 0))
    return null;

  return {
    remoteAgentDir: resolveRemoteSyncedAgentDir({
      remoteResourceAgentDir: config.remoteResourceSyncRemoteAgentDir || undefined,
      remoteChildRemoteRuntimeDir: config.remoteChildRemoteRuntimeDir,
    }),
    localAgentDir: config.remoteResourceSyncLocalAgentDir || undefined,
    resourceTypes,
    extraSources: getProjectRemoteResourceExtraSources(options.cwd, resourceTypes),
  };
}

export function toRemoteResourceSyncOptions(
  plan: RemoteResourceSyncPlan,
  runtime: Extract<ActiveRuntimeSelection, { kind: "remote-agent-child" }>,
): Pick<
  RemoteResourceSyncOptions,
  | "target"
  | "port"
  | "keyPath"
  | "remoteShell"
  | "remoteAgentDir"
  | "localAgentDir"
  | "resourceTypes"
  | "extraSources"
> {
  return {
    target: runtime.target,
    port: runtime.port,
    keyPath: runtime.keyPath,
    remoteShell: runtime.shell,
    remoteAgentDir: plan.remoteAgentDir,
    localAgentDir: plan.localAgentDir,
    resourceTypes: plan.resourceTypes,
    extraSources: plan.extraSources,
  };
}

export function getRemoteProjectTrustArgs(options: {
  runtime: Extract<ActiveRuntimeSelection, { kind: "remote-agent-child" }>;
  cwd: string;
}): string[] {
  if (options.runtime.source !== "remote-project" || !options.runtime.remoteProject) return [];
  const decision = readProjectTrustDecision(remoteTrustProjectPath(options.runtime.remoteProject));
  if (decision === true) return ["--approve"];
  if (decision === false) return ["--no-approve"];
  return [];
}

function getProjectRemoteResourceExtraSources(
  projectPath: string,
  resourceTypes?: RemoteSyncResourceType[],
): RemoteResourceSyncSource[] {
  const effectiveTypes = normalizeRemoteResourceTypes(resourceTypes);
  if (!effectiveTypes.includes("skills")) return [];

  const projectSkillsDir = join(getProjectUserStateDir(projectPath), "skills");
  return existsSync(projectSkillsDir) ? [{ type: "skills", localPath: projectSkillsDir }] : [];
}

function remoteTrustProjectPath(remoteProject: { host: string; remotePath: string }): string {
  const hostSegment = encodeURIComponent(remoteProject.host);
  const remotePath = `/${remoteProject.remotePath.replace(/^\/+/, "")}`.replace(/\/+$/, "") || "/";
  return normalizeProjectPath(`/__pi_remote__/ssh/${hostSegment}${remotePath}`);
}

function readProjectTrustDecision(projectPath: string): boolean | null {
  let current = normalizeProjectPath(projectPath);
  while (true) {
    const trustStorePath = getProjectTrustStorePath(current);
    const decision = readTrustFileDecision(trustStorePath);
    if (decision === true || decision === false) return decision;
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return readLegacyTrustDecision(projectPath);
}

function readLegacyTrustDecision(projectPath: string): boolean | null {
  const data = readTrustFile(getLegacyTrustStorePath());
  let current = normalizeProjectPath(projectPath);
  while (true) {
    const decision = data[current];
    if (decision === true || decision === false) return decision;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readTrustFileDecision(path: string): boolean | null {
  const data = readTrustFile(path);
  const decision = data.decision;
  return decision === true || decision === false ? decision : null;
}

function readTrustFile(path: string): Record<string, boolean | null | undefined> {
  if (!existsSync(path)) return {};
  const parsed = JSON.parse(readFileSync(path, "utf-8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
  const data: Record<string, boolean | null | undefined> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (value === true || value === false || value === null) data[key] = value;
  }
  return data;
}
