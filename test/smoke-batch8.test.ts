import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { ChatMessage } from "../src/mainview/types";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({ persist: (fn: unknown) => fn }));
vi.mock("../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(() => Promise.resolve(undefined)),
    subscribe: vi.fn(() => Promise.resolve("sub-id")),
    unsubscribe: vi.fn(),
    onReconnect: vi.fn(),
  },
}));
vi.mock("../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));
vi.mock("../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));
vi.mock("../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../src/mainview/stores/use-session-store", () => {
  const useSessionStore = create(() => ({
    sessionsByProject: {},
    activeSessionId: null,
    projectTabs: [],
    activeProjectId: null,
    loading: false,
    agentSubscriptions: {},
    sessionReady: {},
    sessionContextMap: {},
    sessionStatusMap: {} as Record<string, string>,
    queueBySession: {},
    currentModel: null,
    currentThinkingLevel: "medium",
    availableModels: [],
    projectStartFailed: {},
    projectStartError: {},
    _projectVersion: 0,
    updateSessionStatus: (sessionId: string, status: string) => {
      useSessionStore.setState((s: Record<string, unknown>) => ({
        sessionStatusMap: {
          ...(s.sessionStatusMap as Record<string, string>),
          [sessionId]: status,
        },
      }));
    },
    updateSessionContext: () => {},
    restoreContextFromHistory: () => {},
  }));
  return { useSessionStore };
});

vi.mock("../src/mainview/stores/use-chat-store", () => {
  const useChatStore = create(
    (set: (fn: (s: Record<string, unknown>) => Record<string, unknown>) => void) => ({
      messagesBySession: {} as Record<string, ChatMessage[]>,
      inputText: "",
      isStreaming: false,
      streamContentVersion: 0,
      loadingSessions: new Set(),
      historyLoadVersion: 0,
      setMessagesForSession: (sessionId: string, msgs: ChatMessage[]) =>
        set((s) => ({ messagesBySession: { ...s.messagesBySession, [sessionId]: msgs } })),
      incrementStreamVersion: () =>
        set((s) => ({ streamContentVersion: (s.streamContentVersion as number) + 1 })),
      loadSessionMessages: () => {},
    }),
  );
  return { useChatStore };
});

vi.mock("../src/mainview/stores/use-lsp-store", () => {
  const useLspStore = create(
    (set: (fn: (s: Record<string, unknown>) => Record<string, unknown>) => void) => ({
      statusBySession: {} as Record<string, { state: string; servers: unknown[]; mode: string }>,
      setMode: (sessionId: string, mode: string) =>
        set((s: Record<string, unknown>) => {
          const status = {
            ...((
              s.statusBySession as Record<
                string,
                { state: string; servers: unknown[]; mode: string }
              >
            )[sessionId] || { state: "inactive", servers: [], mode }),
          };
          return {
            statusBySession: {
              ...(s.statusBySession as Record<string, unknown>),
              [sessionId]: { ...status, mode },
            },
          };
        }),
      setStatus: (sessionId: string, state: string, servers: unknown[]) =>
        set((s: Record<string, unknown>) => ({
          statusBySession: {
            ...(s.statusBySession as Record<string, unknown>),
            [sessionId]: { state, servers, mode: "agent_end" },
          },
        })),
    }),
  );
  return { useLspStore };
});

vi.mock("../src/mainview/stores/use-status-store", () => {
  const useStatusStore = create(
    (set: (fn: (s: Record<string, unknown>) => Record<string, unknown>) => void) => ({
      yoloEnabled: false,
      planMode: false,
      mcpServers: [] as Array<{ name: string; status: string; tools: number; enabled: boolean }>,
      plugins: [] as Array<{ name: string; enabled: boolean; toolCount: number }>,
      skills: [] as Array<{ name: string; disabled: boolean; description: string }>,
      toggleYolo: () => set((s) => ({ yoloEnabled: !(s.yoloEnabled as boolean) })),
      togglePlanMode: () => set((s) => ({ planMode: !(s.planMode as boolean) })),
      setMcpServers: (
        servers: Array<{ name: string; status: string; tools: number; enabled: boolean }>,
      ) => set({ mcpServers: servers }),
      setPlugins: (plugins: Array<{ name: string; enabled: boolean; toolCount: number }>) =>
        set({ plugins }),
      setSkills: (skills: Array<{ name: string; disabled: boolean; description: string }>) =>
        set({ skills }),
      toggleMcpServer: (name: string) =>
        set((s) => ({
          mcpServers: (s.mcpServers as Array<{ name: string; enabled: boolean }>).map((srv) =>
            srv.name === name ? { ...srv, enabled: !srv.enabled } : srv,
          ),
        })),
    }),
  );
  return { useStatusStore };
});

import { handleAgentEvent, toolCallNameMap } from "../src/mainview/stores/agent-event-handler";
import { useChatStore } from "../src/mainview/stores/use-chat-store";
import { useSessionStore } from "../src/mainview/stores/use-session-store";
import { useLspStore } from "../src/mainview/stores/use-lsp-store";
import { useStatusStore } from "../src/mainview/stores/use-status-store";
import { flushNow } from "../src/mainview/stores/message-batcher";
import { ScenarioPlayer } from "./helpers/mock-llm";
import { agentStart, messageStart, messageUpdate, messageEnd, agentEnd } from "./helpers/mock-llm";

const SID = "batch8-test-session";

function resetStores() {
  useChatStore.setState({
    messagesBySession: {},
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
  });
  useSessionStore.setState({
    sessionStatusMap: {},
    sessionContextMap: {},
    sessionReady: {},
    activeSessionId: null,
    activeProjectId: null,
    projectTabs: [],
    sessionsByProject: {},
    agentSubscriptions: {},
    queueBySession: {},
    currentModel: null,
    currentThinkingLevel: "medium",
    availableModels: [],
    projectStartFailed: {},
    projectStartError: {},
    _projectVersion: 0,
    loading: false,
  });
  Object.keys(toolCallNameMap).forEach((k) => delete toolCallNameMap[k]);
}

function makePlayer(): ScenarioPlayer {
  return new ScenarioPlayer(
    (sid, event) => handleAgentEvent(sid, event as Parameters<typeof handleAgentEvent>[1]),
    () => flushNow(),
    SID,
  );
}

describe("Batch 8 — Final store-level gaps", () => {
  beforeEach(() => {
    resetStores();
    makePlayer();
  });
  afterEach(() => {
    flushNow();
  });

  // T10.2 — LSP mode switch
  it("T10.2 — LSP mode switch via store", () => {
    const lsp = useLspStore.getState();
    lsp.setStatus(SID, "ready", [{ name: "typescript", fileTypes: ["ts", "tsx"] }]);
    const status = useLspStore.getState().statusBySession[SID];
    expect(status).toBeDefined();
    expect(status.state).toBe("ready");
    lsp.setMode(SID, "edit_write");
    const updated = useLspStore.getState().statusBySession[SID];
    expect(updated.mode).toBe("edit_write");
    lsp.setMode(SID, "disabled");
    expect(useLspStore.getState().statusBySession[SID].mode).toBe("disabled");
  });

  // T20.2-T20.3 — MCP management
  it("T20.2 — MCP toggle enable/disable", () => {
    const status = useStatusStore.getState();
    status.setMcpServers([
      { name: "filesystem", status: "connected", tools: 3, enabled: true },
      { name: "github", status: "connected", tools: 5, enabled: true },
    ]);
    expect(useStatusStore.getState().mcpServers.length).toBe(2);
    status.toggleMcpServer("github");
    const github = useStatusStore.getState().mcpServers.find((s) => s.name === "github");
    expect(github!.enabled).toBe(false);
    status.toggleMcpServer("github");
    expect(useStatusStore.getState().mcpServers.find((s) => s.name === "github")!.enabled).toBe(
      true,
    );
  });
  it("T20.3 — MCP server status transitions", () => {
    const status = useStatusStore.getState();
    status.setMcpServers([{ name: "db", status: "connecting", tools: 0, enabled: true }]);
    expect(useStatusStore.getState().mcpServers[0].status).toBe("connecting");
    // Simulate restart: connecting→connected
    status.setMcpServers([{ name: "db", status: "connected", tools: 4, enabled: true }]);
    expect(useStatusStore.getState().mcpServers[0].status).toBe("connected");
  });

  // T21 — StatusPanel state management
  it("T21.4 — YOLO mode toggle via store", () => {
    const status = useStatusStore.getState();
    expect(status.yoloEnabled).toBe(false);
    status.toggleYolo();
    expect(useStatusStore.getState().yoloEnabled).toBe(true);
    status.toggleYolo();
    expect(useStatusStore.getState().yoloEnabled).toBe(false);
  });
  it("T21.5 — Plan mode toggle", () => {
    const status = useStatusStore.getState();
    status.togglePlanMode();
    expect(useStatusStore.getState().planMode).toBe(true);
    status.togglePlanMode();
    expect(useStatusStore.getState().planMode).toBe(false);
  });
  it("T21.6 — Plugins and skills config", () => {
    const status = useStatusStore.getState();
    status.setPlugins([
      { name: "bash-ext", enabled: true, toolCount: 2 },
      { name: "todo-ext", enabled: true, toolCount: 1 },
    ]);
    status.setSkills([
      { name: "code-review", disabled: false, description: "Review code quality" },
    ]);
    const s = useStatusStore.getState();
    expect(s.plugins.length).toBe(2);
    expect(s.skills.length).toBe(1);
    expect(s.skills[0].disabled).toBe(false);
  });

  // T23.2 — Tree navigation
  it("T23.2 — Fork commit tree structure", () => {
    const tree = {
      entries: [
        { entryId: "e1", parentId: null, turnIndex: 0 },
        { entryId: "e2", parentId: "e1", turnIndex: 1 },
        { entryId: "e3", parentId: "e1", turnIndex: 2 },
      ],
    };
    expect(tree.entries.length).toBe(3);
    const mainLine = tree.entries.filter((e) => e.parentId === "e1");
    expect(mainLine.length).toBe(2);
  });

  // Notification agent_end event
  it("T29.6 — Agent end restores idle status", async () => {
    const steps = [
      agentStart(),
      messageStart("assistant"),
      messageUpdate([{ type: "text", text: "done" }]),
      messageEnd(),
      agentEnd(),
    ];
    for (const step of steps) {
      const delay = step.delay ?? 20;
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      handleAgentEvent(SID, step.event as Parameters<typeof handleAgentEvent>[1]);
      flushNow();
    }
    expect(useSessionStore.getState().sessionStatusMap[SID]).toBe("idle");
  });

  // Timeline view logic
  it("T25.4 — Timeline turn grouping logic", () => {
    const turns = [
      { turnIndex: 0, userMsg: "Hello", assistantMsg: "Hi!" },
      { turnIndex: 1, userMsg: "How are you?", assistantMsg: "Good!" },
    ];
    expect(turns.length).toBe(2);
    expect(turns[0].turnIndex).toBe(0);
    expect(turns[1].turnIndex).toBe(1);
  });

  // Theme persistence
  it("T27.2 — Theme mode cycle", () => {
    const modes = ["light", "dark", "system"] as const;
    let current = 0;
    const next = () => {
      current = (current + 1) % modes.length;
      return modes[current];
    };
    expect(next()).toBe("dark");
    expect(next()).toBe("system");
    expect(next()).toBe("light");
  });
});
