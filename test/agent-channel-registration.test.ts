/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from "vitest";

import {
  AGENT_CHANNEL_NAMES,
  registerAgentChannels,
  type ChannelRegistrableClient,
} from "../src/shared/agent/agent-channel-registration";

describe("agent channel registration", () => {
  it("registers all supported channels and routes coordinator channels separately", () => {
    const handlers = new Map<string, (data: unknown) => void>();
    const client: ChannelRegistrableClient = {
      channel: (name: string) => ({
        onReceive: (handler: (data: unknown) => void) => {
          handlers.set(name, handler);
        },
      }),
    };
    const handleCoordinatorCall = vi.fn();
    const handleChannelData = vi.fn();

    const count = registerAgentChannels({
      client,
      getSessionId: () => "sess-1",
      handleCoordinatorCall,
      handleChannelData,
    });

    expect(count).toBe(AGENT_CHANNEL_NAMES.length);
    handlers.get("bash")?.({ type: "list" });
    handlers.get("coordinator")?.({ __call: "session_delegate_list" });
    handlers.get("coordinator_client")?.({ __call: "session_delegate_status" });

    expect(handleChannelData).toHaveBeenCalledWith("sess-1", {
      type: "channel_data",
      name: "bash",
      data: { type: "list" },
    });
    expect(handleCoordinatorCall).toHaveBeenCalledWith(
      "sess-1",
      { __call: "session_delegate_list" },
      "coordinator",
    );
    expect(handleCoordinatorCall).toHaveBeenCalledWith(
      "sess-1",
      { __call: "session_delegate_status" },
      "coordinator_client",
    );
  });

  it("skips unsupported channels without failing registration", () => {
    const client: ChannelRegistrableClient = {
      channel: (name: string) => {
        if (name === "lsp") throw new Error("channel unsupported");
        return { onReceive: vi.fn() };
      },
    };

    const count = registerAgentChannels({
      client,
      getSessionId: () => "sess-1",
      handleCoordinatorCall: vi.fn(),
      handleChannelData: vi.fn(),
    });

    expect(count).toBe(AGENT_CHANNEL_NAMES.length - 1);
  });
});
