import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { RpcPanel } from "../../../src/mainview/components/rpc-panel/RpcPanel";
import { useAppStore } from "../../../src/mainview/stores/use-app-store";
import { useRpcDebugStore } from "../../../src/mainview/stores/use-rpc-debug-store";

describe("RpcPanel", () => {
  beforeEach(() => {
    useRpcDebugStore.setState({ entries: [], maxEntries: 500 });
    useAppStore.setState({ connectionStatus: "connected" });
  });

  it("renders entries with undefined payloads", () => {
    useRpcDebugStore.setState({
      entries: [
        {
          id: "entry-1",
          direction: "event",
          eventType: "test.event",
          payload: undefined,
          timestamp: Date.now(),
        },
      ],
    });

    render(<RpcPanel />);

    expect(screen.getByText("test.event")).toBeInTheDocument();
    expect(screen.getByText("undefined")).toBeInTheDocument();
  });
});
