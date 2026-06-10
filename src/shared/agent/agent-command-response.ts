export interface AgentCommandClient {
  send: (command: unknown) => Promise<unknown>;
}

export interface AgentListItem {
  name: string;
  description?: string;
  tier?: string;
  tools?: string[];
  permissionMode?: string;
  source?: string;
  filePath?: string;
}

export interface NormalizedAgentListItem {
  name: string;
  description?: string;
  tier?: string;
  tools?: string[];
  permissionMode?: string;
  source: string;
  filePath: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function asAgentCommandClient(client: unknown): AgentCommandClient {
  return client as AgentCommandClient;
}

export function getResponseData<T>(response: unknown): T | undefined {
  if (!isRecord(response) || !("data" in response)) return undefined;
  return response.data as T | undefined;
}

export function normalizeAgentList(agents: AgentListItem[] | undefined): NormalizedAgentListItem[] {
  return (agents ?? []).map((agent) => ({
    ...agent,
    source: agent.source ?? "builtin",
    filePath: agent.filePath ?? "",
  }));
}
