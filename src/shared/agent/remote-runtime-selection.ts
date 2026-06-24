import { config } from "../../server-config";
import type { RemoteProjectRecord, SshRuntimeKind } from "../modules/project";
import { getRemoteProjectByPath } from "../lib/project-config";

export type ActiveRuntimeSelection =
  | { kind: "local"; remoteProject: null }
  | { kind: "ssh-command"; remoteProject: RemoteProjectRecord }
  | {
      kind: "remote-agent-child";
      source: "env" | "remote-project";
      remoteProject: RemoteProjectRecord | null;
      target: string;
      remoteCwd: string;
      sshArgs?: string[];
      port?: number;
      keyPath?: string;
      shell: string;
      remotePiAgentDir?: string;
    };

export function getRemoteProjectSshRuntimeKind(
  remoteProject: Pick<RemoteProjectRecord, "sshRuntimeKind">,
): SshRuntimeKind {
  return remoteProject.sshRuntimeKind === "ssh-command"
    ? "ssh-command"
    : "remote-agent-child";
}

export function shouldCreateLocalRuntimeCwd(
  runtime: Pick<ActiveRuntimeSelection, "kind">,
): boolean {
  return runtime.kind !== "remote-agent-child";
}

export function splitSshArgsForRemoteChild(input: {
  target: string;
  sshArgs?: string[];
}): { target: string; port?: number; keyPath?: string; extraSshArgs: string[] } {
  const args = input.sshArgs ?? [];
  const extraSshArgs: string[] = [];
  let target = input.target;
  let port: number | undefined;
  let keyPath: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "-p" && next) {
      const parsed = Number.parseInt(next, 10);
      if (Number.isFinite(parsed)) port = parsed;
      index += 1;
      continue;
    }
    if (arg === "-i" && next) {
      keyPath = next;
      index += 1;
      continue;
    }
    if (arg === "-l" && next) {
      if (!target.includes("@")) target = `${next}@${target}`;
      index += 1;
      continue;
    }
    extraSshArgs.push(arg);
  }

  return { target, port, keyPath, extraSshArgs };
}

export async function resolveActiveRuntimeSelection(cwd: string): Promise<ActiveRuntimeSelection> {
  const remoteProject = await getRemoteProjectByPath(cwd).catch(() => null);
  if (config.remoteChildEnabled) {
    if (!config.remoteSshTarget || !config.remoteChildProjectPath) {
      throw new Error(
        "REMOTE_CHILD_ENABLED requires REMOTE_SSH_TARGET and REMOTE_CHILD_PROJECT_PATH or REMOTE_PROJECT_PATH",
      );
    }
    return {
      kind: "remote-agent-child",
      source: "env",
      remoteProject,
      target: config.remoteSshTarget,
      remoteCwd: config.remoteChildProjectPath,
      port: config.remoteSshPort,
      keyPath: config.remoteSshKey || undefined,
      shell: config.remoteChildShell,
      remotePiAgentDir: config.remotePiAgentDir || undefined,
    };
  }

  if (!remoteProject) return { kind: "local", remoteProject: null };
  if (getRemoteProjectSshRuntimeKind(remoteProject) === "ssh-command") {
    return { kind: "ssh-command", remoteProject };
  }

  const connection = splitSshArgsForRemoteChild({
    target: remoteProject.host,
    sshArgs: remoteProject.sshArgs,
  });
  return {
    kind: "remote-agent-child",
    source: "remote-project",
    remoteProject,
    target: connection.target,
    remoteCwd: remoteProject.remotePath,
    port: connection.port,
    keyPath: connection.keyPath,
    sshArgs: connection.extraSshArgs.length > 0 ? connection.extraSshArgs : undefined,
    shell: remoteProject.shell ?? config.remoteChildShell,
    remotePiAgentDir: config.remotePiAgentDir || undefined,
  };
}

export function buildRemoteChildSshArgs(
  runtime: Extract<ActiveRuntimeSelection, { kind: "remote-agent-child" }>,
): string[] {
  return [
    "-o",
    "BatchMode=yes",
    "-o",
    "ConnectTimeout=8",
    ...(runtime.port ? ["-p", String(runtime.port)] : []),
    ...(runtime.keyPath ? ["-i", runtime.keyPath] : []),
    ...(runtime.sshArgs ?? []),
  ];
}
