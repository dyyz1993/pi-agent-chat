import type { RemoteProjectRecord } from "../modules/project";

export type PiRuntimeKind = "local" | "ssh-command" | "remote-agent-child" | "remote-server";

export function buildSshCommandRuntimeEnv(
  remoteProject: Pick<RemoteProjectRecord, "host" | "remotePath">,
): Record<string, string> {
  return {
    PI_RUNTIME_KIND: "ssh-command",
    PI_REMOTE_SSH_TOOL_PROXY: "1",
    PI_REMOTE_SSH_HOST: remoteProject.host,
    PI_REMOTE_SSH_CWD: remoteProject.remotePath,
  };
}

export function buildRemoteAgentChildRuntimeEnv(options: {
  remotePiAgentDir?: string;
  nodeOptions: string;
  skipMcp?: boolean;
  modelProxyEnv?: Record<string, string>;
}): Record<string, string> {
  return {
    ...(options.remotePiAgentDir ? { PI_CODING_AGENT_DIR: options.remotePiAgentDir } : {}),
    PI_RUNTIME_KIND: "remote-agent-child",
    NODE_OPTIONS: options.nodeOptions,
    ...(options.skipMcp ? { PI_SKIP_MCP: "1" } : {}),
    ...(options.modelProxyEnv ?? {}),
  };
}
