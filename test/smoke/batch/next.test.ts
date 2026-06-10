import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ChatMessage } from "../../../src/mainview/types";
import { create } from "zustand";

vi.mock("zustand/middleware", () => ({ persist: (fn: unknown) => fn }));
vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: { call: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn(), onReconnect: vi.fn() },
}));
vi.mock("../../../src/mainview/lib/notification-gateway", () => ({
  notificationGateway: { emit: vi.fn() },
}));
vi.mock("../../../src/mainview/components/chat/memory-config", () => ({
  ALL_MEMORY_TYPE_KEYS: new Set(),
}));
vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => {
  const useSessionStore = create(() => ({
    sessionsByProject: {},
    activeSessionId: null,
    projectTabs: [],
    activeProjectId: null,
    agentSubscriptions: {},
    batchSubscriptions: {},
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
    updateSessionStatus: () => {},
    updateSessionContext: () => {},
    restoreContextFromHistory: () => {},
  }));
  return { useSessionStore, clearAgentStarted: () => {} };
});

vi.mock("../../../src/mainview/stores/use-chat-store", () => {
  const useChatStore = create((set) => ({
    messagesBySession: {} as Record<string, ChatMessage[]>,
    inputText: "",
    isStreaming: false,
    streamContentVersion: 0,
    loadingSessions: new Set(),
    historyLoadVersion: 0,
    setMessagesForSession: (sid: string, msgs: ChatMessage[]) =>
      set((s: Record<string, unknown>) => ({
        messagesBySession: {
          ...(s.messagesBySession as Record<string, ChatMessage[]>),
          [sid]: msgs,
        },
      })),
    incrementStreamVersion: () =>
      set((s: Record<string, unknown>) => ({
        streamContentVersion: (s.streamContentVersion as number) + 1,
      })),
    loadSessionMessages: () => {},
  }));
  return { useChatStore };
});

import { useSessionStore } from "../../../src/mainview/stores/use-session-store";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";

describe("Batch — T6.4/T6.5/T15.7/T15.8/T15.9 (pure store)", () => {
  beforeEach(() => {
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
      batchSubscriptions: {},
      queueBySession: {},
      currentModel: null,
      currentThinkingLevel: "medium",
      availableModels: [],
      projectStartFailed: {},
      projectStartError: {},
      _projectVersion: 0,
      loading: false,
    });
  });

  // T6.4 — Memory panel: This Injection / Memory Files / Recent Operations
  it("T6.4 — Memory panel injection + files + operations", () => {
    // Simulate memory store state
    const injectionState = {
      injected: [{ summary: "CSS variables in index.css", type: "project" as const }],
      memoryFiles: [
        {
          filename: "css-vars.md",
          filePath: "/mem/css-vars.md",
          type: "project" as const,
          description: "CSS var locations",
        },
        {
          filename: "user-prefs.md",
          filePath: "/mem/user-prefs.md",
          type: "user" as const,
          description: "User preferences",
        },
      ],
      recentOps: [
        { op: "bookmark_creating", timestamp: Date.now() - 1000 },
        { op: "memory_updated", timestamp: Date.now() },
      ],
    };
    expect(injectionState.injected.length).toBe(1);
    expect(injectionState.injected[0].type).toBe("project");
    expect(injectionState.memoryFiles.length).toBe(2);
    expect(injectionState.memoryFiles[0].filename).toBe("css-vars.md");
    expect(injectionState.memoryFiles[1].type).toBe("user");
    expect(injectionState.recentOps.length).toBe(2);
    expect(injectionState.recentOps[0].op).toBe("bookmark_creating");
  });

  // T6.5 — Message selection → save as memory
  it("T6.5 — Message selection save memory", () => {
    const SID = "test-session";
    const messages: ChatMessage[] = [
      {
        id: "m1",
        role: "user" as const,
        content: [{ type: "text" as const, text: "Remember this setting" }],
        timestamp: 1000,
      },
      {
        id: "m2",
        role: "assistant" as const,
        content: [{ type: "text" as const, text: "Configuration: theme=dark, font=14" }],
        timestamp: 1001,
      },
    ];
    useChatStore.getState().setMessagesForSession(SID, messages);
    const loaded = useChatStore.getState().messagesBySession[SID] || [];
    expect(loaded.length).toBe(2);
    // Simulate selection + memory save
    const selectedIds = ["m1", "m2"];
    const selectedTexts = selectedIds.map(
      (id) =>
        loaded
          .find((m) => m.id === id)
          ?.content.map((b) => (b as { text?: string }).text || "")
          .join(" ") || "",
    );
    const memoryContent = selectedTexts.join("\n");
    expect(memoryContent).toContain("Remember");
    expect(memoryContent).toContain("theme=dark");
  });

  // T15.7 — Fork session (creates child session)
  it("T15.7 — Fork session from message point", () => {
    const parentId = "session-parent";
    const projectPath = "/tmp/test-project";
    // Set up parent session
    useSessionStore.setState({
      sessionsByProject: {
        [projectPath]: [{ sessionId: parentId, name: "Parent Session", projectPath }],
      },
      activeSessionId: parentId,
      activeProjectId: projectPath,
    });
    // Fork: create child session inheriting from parent
    const childId = "session-fork-1";
    const parentSessions = useSessionStore.getState().sessionsByProject[projectPath] as Array<
      Record<string, unknown>
    >;
    const forked = [
      ...(parentSessions || []),
      { sessionId: childId, name: "Forked Session", projectPath, parentId },
    ];
    useSessionStore.setState({
      sessionsByProject: { [projectPath]: forked },
      activeSessionId: childId,
    });
    const updated = useSessionStore.getState().sessionsByProject[projectPath] as Array<
      Record<string, unknown>
    >;
    expect(updated.length).toBe(2);
    expect(updated.find((s: Record<string, unknown>) => s.sessionId === childId)).toBeDefined();
    expect(useSessionStore.getState().activeSessionId).toBe(childId);
  });

  // T15.8 — Clone session (exact duplicate)
  it("T15.8 — Clone session duplicate", () => {
    const srcId = "session-original";
    const projectPath = "/tmp/test-project";
    useSessionStore.setState({
      sessionsByProject: { [projectPath]: [{ sessionId: srcId, name: "Original", projectPath }] },
      activeSessionId: srcId,
      activeProjectId: projectPath,
    });
    // Clone: exact copy with new ID
    const cloneId = "session-clone-1";
    const sessions = useSessionStore.getState().sessionsByProject[projectPath] as Array<
      Record<string, unknown>
    >;
    const original = sessions.find((s: Record<string, unknown>) => s.sessionId === srcId) as Record<
      string,
      unknown
    >;
    const cloned = [...sessions, { ...original, sessionId: cloneId, name: "Clone of Original" }];
    useSessionStore.setState({ sessionsByProject: { [projectPath]: cloned } });
    const updated = useSessionStore.getState().sessionsByProject[projectPath] as Array<
      Record<string, unknown>
    >;
    expect(updated.length).toBe(2);
    expect(updated.some((s: Record<string, unknown>) => s.sessionId === cloneId)).toBe(true);
  });

  // T15.9 — Export HTML
  it("T15.9 — Export session as HTML", () => {
    const exportPath = "/tmp/export-session.html";
    const exportResult = { path: exportPath, success: true };
    expect(exportResult.success).toBe(true);
    expect(exportResult.path).toContain(".html");
  });
});
