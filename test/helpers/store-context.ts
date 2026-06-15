import type { ContentBlock, ChatMessage } from "../../src/mainview/types";

export interface StoreContext {
  sessionId: string;
  projectPath: string;
  sessionPath: string;
  cleanup: () => void;
}

const INITIAL_CHAT_STATE = {
  messagesBySession: {},
  inputText: "",
  isStreaming: false,
  streamContentVersion: 0,
  loadingSessions: new Set<string>(),
  historyLoadVersion: 0,
};

const INITIAL_SESSION_STATE = {
  sessionsByProject: {},
  activeSessionId: null as string | null,
  projectTabs: [],
  activeProjectId: null as string | null,
  loading: false,
  agentSubscriptions: {} as Record<string, string>,
  batchSubscriptions: {} as Record<string, string>,
  sessionReady: {} as Record<string, boolean>,
  sessionContextMap: {} as Record<string, unknown>,
  sessionStatusMap: {} as Record<string, string>,
  currentModel: null as unknown,
  currentThinkingLevel: "medium",
  availableModels: [] as unknown[],
  projectStartFailed: {} as Record<string, boolean>,
  projectStartError: {} as Record<string, string>,
  _projectVersion: 0,
};

export function resetChatStore(useChatStore: {
  getState: () => {
    setMessagesForSession: (sid: string, msgs: ChatMessage[]) => void;
    incrementStreamVersion: () => void;
  };
  setState: (partial: Partial<typeof INITIAL_CHAT_STATE>) => void;
}): void {
  useChatStore.setState(INITIAL_CHAT_STATE);
}

export function resetSessionStore(useSessionStore: {
  setState: (partial: Partial<typeof INITIAL_SESSION_STATE>) => void;
}): void {
  useSessionStore.setState(INITIAL_SESSION_STATE);
}

export function makeStoreContext(
  useChatStore: {
    getState: () => {
      messagesBySession: Record<string, ChatMessage[]>;
      setMessagesForSession: (sid: string, msgs: ChatMessage[]) => void;
      incrementStreamVersion: () => void;
    };
    setState: (partial: Partial<typeof INITIAL_CHAT_STATE>) => void;
  },
  useSessionStore: {
    getState: () => {
      updateSessionStatus: (sid: string, status: string) => void;
      updateSessionContext: (sid: string, usage: Record<string, unknown>) => void;
    };
    setState: (partial: Partial<typeof INITIAL_SESSION_STATE>) => void;
  },
  overrides?: Partial<StoreContext>,
): StoreContext {
  const sessionId = overrides?.sessionId ?? `test-session-${Date.now()}`;
  const projectPath = overrides?.projectPath ?? "/tmp/test-project";
  const sessionPath = overrides?.sessionPath ?? `/tmp/test-sessions/${sessionId}`;

  resetChatStore(useChatStore);
  resetSessionStore(useSessionStore);

  return {
    sessionId,
    projectPath,
    sessionPath,
    cleanup: () => {
      resetChatStore(useChatStore);
      resetSessionStore(useSessionStore);
    },
  };
}

export function findToolExecBlock(
  messages: ChatMessage[],
  toolCallId: string,
): Extract<ContentBlock, { type: "toolExecution" }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== "assistant") continue;
    const block = messages[i].content.find(
      (b): b is Extract<ContentBlock, { type: "toolExecution" }> =>
        b.type === "toolExecution" && b.toolCallId === toolCallId,
    );
    if (block) return block;
  }
  return undefined;
}

export function findMessagesByRole(messages: ChatMessage[], role: string): ChatMessage[] {
  return messages.filter((m) => m.role === role);
}

export function getAssistantContent(messages: ChatMessage[]): ContentBlock[] {
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  return last?.content ?? [];
}
