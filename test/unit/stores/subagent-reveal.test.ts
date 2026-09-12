import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("zustand/middleware", async (importOriginal) => {
  const actual = await importOriginal<typeof import("zustand/middleware")>();
  return { ...actual, persist: (fn: unknown) => fn };
});

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue({}),
    onReconnect: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-rpc-debug-store", () => ({
  useRpcDebugStore: { getState: vi.fn(() => ({ addEntry: vi.fn() })) },
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: {
    getState: vi.fn(() => ({
      loadSessionMessages: vi.fn().mockResolvedValue(undefined),
      clearSessionMessages: vi.fn(),
      messagesBySession: {},
    })),
    setState: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: { getState: vi.fn(() => ({ addLog: vi.fn() })) },
}));

vi.mock("../../../src/mainview/stores/use-explorer-store", () => ({
  useExplorerStore: { getState: vi.fn(() => ({ setCurrentPath: vi.fn(), listRootDir: vi.fn() })) },
}));

vi.mock("../../../src/mainview/stores/use-status-store", () => ({
  useStatusStore: { getState: vi.fn(() => ({ setPlugins: vi.fn(), setSkills: vi.fn() })) },
  deriveSkillScope: vi.fn(() => "project"),
  derivePluginScope: vi.fn(() => "project"),
}));

import { useSubagentStore } from "../../../src/mainview/stores/use-subagent-store";

describe("useSubagentStore reveal target", () => {
  beforeEach(() => {
    useSubagentStore.setState({ revealTarget: null });
  });

  it("revealSubagent sets a nonce-bumped target and clearRevealTarget resets it", () => {
    useSubagentStore.getState().revealSubagent("/parent.jsonl", "sub-1");
    const first = useSubagentStore.getState().revealTarget;
    expect(first).toMatchObject({ parentSessionPath: "/parent.jsonl", subsessionId: "sub-1" });
    expect(typeof first?.nonce).toBe("number");

    useSubagentStore.getState().revealSubagent("/parent.jsonl", "sub-2");
    const second = useSubagentStore.getState().revealTarget;
    expect(second?.subsessionId).toBe("sub-2");
    expect(second!.nonce).toBeGreaterThan(first!.nonce);

    useSubagentStore.getState().clearRevealTarget();
    expect(useSubagentStore.getState().revealTarget).toBeNull();
  });
});
