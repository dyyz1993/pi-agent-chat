import type { ChannelDataEvent } from "../modules/agent";

export const AGENT_CHANNEL_NAMES = [
  "bash",
  "todo",
  "subagent",
  "lsp",
  "rules-engine",
  "memory",
  "coordinator",
  "supervisor",
  "goal",
  "file-snapshot",
  "file-review",
] as const;

export type AgentChannelName = (typeof AGENT_CHANNEL_NAMES)[number];

export interface ChannelRegistrableClient {
  channel: (name: string) => {
    onReceive: (handler: (data: unknown) => void) => unknown;
  };
}

export function registerAgentChannels(options: {
  client: ChannelRegistrableClient;
  getSessionId: () => string;
  handleCoordinatorCall: (sessionId: string, data: unknown, channelName: string) => void;
  handleChannelData: (sessionId: string, event: ChannelDataEvent) => void;
}): number {
  let registered = 0;
  for (const name of AGENT_CHANNEL_NAMES) {
    try {
      options.client.channel(name).onReceive((data: unknown) => {
        const sessionId = options.getSessionId();
        if (name === "coordinator") {
          options.handleCoordinatorCall(sessionId, data, name);
          return;
        }
        options.handleChannelData(sessionId, {
          type: "channel_data",
          name,
          data,
        } as ChannelDataEvent);
      });
      registered += 1;
    } catch {
      // sandbox mode: channels not supported, skip
    }
  }
  return registered;
}
