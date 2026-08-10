import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
  renderHook,
  within,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  ProjectRuntimePendingRequests,
  UIPendingCenter,
  useProjectPendingCount,
} from "../../../src/mainview/components/chat/UIPendingCenter";
import { ContentBlockRenderer } from "../../../src/mainview/components/chat/ContentBlockRenderer";
import {
  AskUserQuestionToolCard,
  ConfirmCard,
  PathPermissionCard,
} from "../../../src/mainview/components/chat/tool-renderers/UICardRenderer";
import type { UIInteractionBlock } from "../../../src/mainview/types";
import type { UIPendingRequest } from "../../../src/mainview/stores/use-ui-dialog-store";

const mockFns = vi.hoisted(() => ({
  setPanelOpen: vi.fn(),
  togglePanel: vi.fn(),
  respondById: vi.fn(),
  dismissById: vi.fn(),
  setHooksEnabled: vi.fn(),
  apiCall: vi.fn(),
  setActiveSession: vi.fn(),
  jumpToSessionById: vi.fn(),
}));

let currentPending: UIPendingRequest[] = [];
let mockPanelOpen = false;
const mockSetPanelOpen = mockFns.setPanelOpen;
const mockTogglePanel = mockFns.togglePanel;
const mockRespondById = mockFns.respondById;
const mockDismissById = mockFns.dismissById;
const mockSetHooksEnabled = mockFns.setHooksEnabled;
const mockApiCall = mockFns.apiCall;
const mockJumpToSessionById = mockFns.jumpToSessionById;

let mockActiveProjectId: string | null = null;
let mockProjectTabs: { id: string; name: string; path: string }[] = [];
let mockSessionsByProject: Record<
  string,
  { sessionId: string; name: string; firstMessage?: string; sessionPath?: string }[]
> = {};
let mockSubsessionsByParent: Record<
  string,
  Array<{ sessionId: string; sessionPath: string; description?: string; instruction?: string }>
> = {};
const mockSetActiveSession = mockFns.setActiveSession;

vi.mock("../../../src/mainview/stores/use-ui-dialog-store", () => ({
  useUIDialogStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        pending: currentPending,
        panelOpen: mockPanelOpen,
        setPanelOpen: mockSetPanelOpen,
        togglePanel: mockTogglePanel,
        respondById: mockRespondById,
        dismissById: mockDismissById,
      }),
    {
      getState: () => ({
        pending: currentPending,
        panelOpen: mockPanelOpen,
        setPanelOpen: mockSetPanelOpen,
        togglePanel: mockTogglePanel,
        respondById: mockRespondById,
        dismissById: mockDismissById,
      }),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        activeProjectId: mockActiveProjectId,
        projectTabs: mockProjectTabs,
        sessionsByProject: mockSessionsByProject,
      }),
    {
      getState: () => ({
        activeProjectId: mockActiveProjectId,
        projectTabs: mockProjectTabs,
        sessionsByProject: mockSessionsByProject,
        setActiveSession: mockSetActiveSession,
      }),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-subagent-store", () => ({
  useSubagentStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        subsessionsByParent: mockSubsessionsByParent,
      }),
    {
      getState: () => ({
        subsessionsByParent: mockSubsessionsByParent,
      }),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-hooks-store", () => ({
  useHooksStore: (sel: (s: Record<string, unknown>) => unknown) =>
    sel({
      setEnabled: mockSetHooksEnabled,
    }),
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: mockFns.apiCall,
  },
}));

vi.mock("../../../src/mainview/components/chat/primitives/useJumpToSession", () => ({
  jumpToSessionById: mockFns.jumpToSessionById,
}));

vi.mock("react-i18next", () => ({
  initReactI18next: {
    type: "3rdParty",
    init: vi.fn(),
  },
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) return `${key} ${JSON.stringify(opts)}`;
      return key;
    },
  }),
}));

function makeRequest(
  overrides: Partial<UIPendingRequest> & { requestId: string; sessionId: string },
): UIPendingRequest {
  return {
    method: "confirm",
    title: "Test title",
    message: "Test message",
    ...overrides,
  };
}

function setupProject() {
  mockActiveProjectId = "proj-1";
  mockProjectTabs = [{ id: "proj-1", name: "My Project", path: "/projects/my-project" }];
  mockSessionsByProject = {
    "/projects/my-project": [
      { sessionId: "sess-1", name: "Session A" },
      { sessionId: "sess-2", name: "Session B" },
    ],
  };
}

describe("UIPendingCenter", () => {
  beforeEach(() => {
    currentPending = [];
    mockPanelOpen = false;
    mockActiveProjectId = null;
    mockProjectTabs = [];
    mockSessionsByProject = {};
    mockSubsessionsByParent = {};
  });

  afterEach(() => {
    vi.useRealTimers();
    cleanup();
    vi.clearAllMocks();
    mockApiCall.mockResolvedValue(undefined);
    mockSetHooksEnabled.mockResolvedValue(undefined);
  });

  it("renders nothing when no pending requests", () => {
    setupProject();
    const { container } = render(<UIPendingCenter />);
    expect(container.innerHTML).toBe("");
  });

  it("renders button with badge when pending requests exist in current project", () => {
    setupProject();
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1" })];
    render(<UIPendingCenter />);
    const button = screen.getByTitle(/uiPending\.pendingRequestsCount/i);
    expect(button).toBeInTheDocument();
    expect(button).toHaveTextContent("1");
  });

  it("does not auto-open the project pending modal when an inline request appears", async () => {
    setupProject();
    const { rerender } = render(<UIPendingCenter />);
    expect(mockSetPanelOpen).not.toHaveBeenCalledWith(true);

    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-2" })];
    rerender(<UIPendingCenter />);

    await waitFor(() => {
      expect(screen.getByTitle(/uiPending\.pendingRequestsCount/i)).toBeInTheDocument();
    });
    expect(mockSetPanelOpen).not.toHaveBeenCalledWith(true);
  });

  it("renders badge count > 9 as 9+", () => {
    setupProject();
    currentPending = Array.from({ length: 12 }, (_, i) =>
      makeRequest({ requestId: `r${i}`, sessionId: "sess-1" }),
    );
    render(<UIPendingCenter />);
    expect(screen.getByText("9+")).toBeInTheDocument();
  });

  it("renders nothing when pending requests exist but NOT in current project", () => {
    setupProject();
    currentPending = [makeRequest({ requestId: "r1", sessionId: "other-sess" })];
    const { container } = render(<UIPendingCenter />);
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing when no active project", () => {
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1" })];
    const { container } = render(<UIPendingCenter />);
    expect(container.innerHTML).toBe("");
  });

  it("opens modal on button click via togglePanel", () => {
    setupProject();
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1" })];
    render(<UIPendingCenter />);
    const button = screen.getByTitle(/uiPending\.pendingRequestsCount/i);
    fireEvent.click(button);
    expect(mockTogglePanel).toHaveBeenCalledOnce();
  });

  it("shows modal with session groups when panelOpen is true", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({ requestId: "r1", sessionId: "sess-1", method: "confirm" }),
      makeRequest({ requestId: "r2", sessionId: "sess-1", method: "input" }),
      makeRequest({ requestId: "r3", sessionId: "sess-2", method: "confirm" }),
    ];
    render(<UIPendingCenter />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("Session A")).toBeInTheDocument();
    expect(screen.getByText("Session B")).toBeInTheDocument();
  });

  it("renders the pending requests panel as an anchored popover instead of a full-screen modal", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1" })];

    render(<UIPendingCenter />);

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "false");
    expect(dialog).toHaveAttribute("data-ui-pending-scope", "chat");
    expect(dialog.parentElement).toHaveClass("fixed");
    expect(dialog).not.toHaveClass("fixed");
    expect(dialog).not.toHaveClass("inset-0");
  });

  it("shows correct count per session group", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({ requestId: "r1", sessionId: "sess-1" }),
      makeRequest({ requestId: "r2", sessionId: "sess-1" }),
      makeRequest({ requestId: "r3", sessionId: "sess-2" }),
    ];
    render(<UIPendingCenter />);
    const badges = screen.getAllByText(/^[12]$/);
    expect(badges).toHaveLength(2);
    expect(badges.map((b) => b.textContent).sort()).toEqual(["1", "2"]);
  });

  it("shows total pending count in modal header", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({ requestId: "r1", sessionId: "sess-1" }),
      makeRequest({ requestId: "r2", sessionId: "sess-2" }),
    ];
    render(<UIPendingCenter />);
    expect(screen.getByText("uiPending.pendingRequestsTitle")).toBeInTheDocument();
  });

  it("bulk allows one-time approval requests without choosing persistent permissions", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({
        requestId: "runtime-approval",
        sessionId: "sess-1",
        method: "select",
        options: ["1. Allow once", "2. Always allow: Exact command", "3. Deny once"],
        permissionMeta: {
          type: "permission_runtime",
          requestId: "runtime-approval",
          provider: "dangerous-command",
          subject: "command.run",
          toolCallId: "tool-1",
        },
      }),
      makeRequest({
        requestId: "path-approval",
        sessionId: "sess-2",
        method: "select",
        options: ["✅ Allow once", "📁 Always allow", "❌ Deny"],
        permissionMeta: {
          type: "path_boundary",
          path: "/tmp/outside.txt",
          cwd: "/projects/my-project",
          toolName: "write",
          scope: "write",
          relativeTo: "outside project",
        },
      }),
      makeRequest({
        requestId: "plain-question",
        sessionId: "sess-1",
        method: "input",
        title: "Needs text",
      }),
    ];

    render(<UIPendingCenter />);
    fireEvent.click(screen.getByRole("button", { name: /uiPending\.batchAllowOnce/ }));

    expect(mockRespondById).toHaveBeenCalledWith("runtime-approval", {
      value: "1. Allow once",
    });
    expect(mockRespondById).toHaveBeenCalledWith("path-approval", {
      value: "✅ Allow once",
    });
    expect(mockRespondById).not.toHaveBeenCalledWith("plain-question", expect.anything());
  });

  it("bulk denies one-time approval requests and hook confirmations", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({
        requestId: "runtime-approval",
        sessionId: "sess-1",
        method: "select",
        options: ["1. Allow once", "2. Always allow: Exact command", "3. Deny once"],
        permissionMeta: {
          type: "permission_runtime",
          requestId: "runtime-approval",
          provider: "dangerous-command",
          subject: "command.run",
          toolCallId: "tool-1",
        },
      }),
      makeRequest({
        requestId: "hook-confirm",
        sessionId: "sess-1",
        method: "confirm",
        title: "Hook approval",
        hookMeta: {
          toolName: "bash",
          matcher: "npm *",
          command: "npm run build",
          hookCommand: "bash ~/.pi/hooks/pre-tool-use.sh",
          eventName: "PreToolUse",
          source: "project",
          reason: "Needs approval",
        },
      }),
    ];

    render(<UIPendingCenter />);
    fireEvent.click(screen.getByRole("button", { name: /uiPending\.batchDenyOnce/ }));

    expect(mockRespondById).toHaveBeenCalledWith("runtime-approval", {
      value: "3. Deny once",
    });
    expect(mockDismissById).toHaveBeenCalledWith("hook-confirm");
  });

  it("uses the unified session jump and closes modal on goto session click", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1" })];
    render(<UIPendingCenter />);
    const gotoBtn = screen.getByTitle("uiPending.gotoSession");
    fireEvent.click(gotoBtn);
    expect(mockJumpToSessionById).toHaveBeenCalledWith("sess-1");
    expect(mockSetPanelOpen).toHaveBeenCalledWith(false);
  });

  it("auto-closes modal when all pending are resolved (pendingCount drops to 0)", async () => {
    setupProject();
    const req = makeRequest({ requestId: "r1", sessionId: "sess-1" });

    currentPending = [req];
    mockPanelOpen = true;
    const { rerender } = render(<UIPendingCenter />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    currentPending = [];
    mockPanelOpen = true;
    act(() => {
      rerender(<UIPendingCenter />);
    });
    await waitFor(() => {
      expect(mockSetPanelOpen).toHaveBeenCalledWith(false);
    });
  });

  it("shows fallback session name (firstMessage slice) when name is empty", () => {
    setupProject();
    mockPanelOpen = true;
    mockSessionsByProject["/projects/my-project"] = [
      {
        sessionId: "sess-1",
        name: "",
        firstMessage: "A very long first message that should be truncated",
      },
    ];
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1" })];
    render(<UIPendingCenter />);
    expect(screen.getByText("A very long first message that")).toBeInTheDocument();
  });

  it("shows sessionId slice when both name and firstMessage are empty", () => {
    setupProject();
    mockPanelOpen = true;
    mockSessionsByProject["/projects/my-project"] = [
      { sessionId: "sess-1-abcdefghij", name: "", firstMessage: "" },
    ];
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1-abcdefghij" })];
    render(<UIPendingCenter />);
    expect(screen.getByText("sess-1-a")).toBeInTheDocument();
  });

  it("renders confirm panel card with confirm and cancel buttons", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1", method: "confirm" })];
    render(<UIPendingCenter />);
    const buttons = screen.getAllByRole("button");
    const confirmBtn = buttons.find((b) => b.textContent?.includes("uiPending.confirm"));
    const cancelBtn = buttons.find((b) => b.textContent?.includes("common:cancel"));
    expect(confirmBtn).toBeDefined();
    expect(cancelBtn).toBeDefined();
  });

  it("renders input panel card with text input", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1", method: "input" })];
    render(<UIPendingCenter />);
    expect(screen.getByPlaceholderText("uiCard.pleaseInput")).toBeInTheDocument();
  });

  it("renders editor card with textarea when method is editor", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({
        requestId: "r1",
        sessionId: "sess-1",
        method: "editor",
        title: "Edit file",
        message: "Please review",
        prefill: "existing code",
      }),
    ];
    render(<UIPendingCenter />);
    const textarea = screen.getByDisplayValue("existing code");
    expect(textarea).toBeInTheDocument();
    expect(screen.getAllByText("uiPending.editor").length).toBeGreaterThanOrEqual(2);
    const buttons = screen.getAllByRole("button");
    const confirmBtn = buttons.find((b) => b.textContent?.includes("uiPending.confirm"));
    const dismissBtn = buttons.find((b) => b.textContent?.includes("common:dismiss"));
    expect(confirmBtn).toBeDefined();
    expect(dismissBtn).toBeDefined();
  });

  it("renders select panel card with options", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({
        requestId: "r1",
        sessionId: "sess-1",
        method: "select",
        options: ["OptionA extra-desc", "OptionB"],
      }),
    ];
    render(<UIPendingCenter />);
    expect(screen.getByText("OptionA")).toBeInTheDocument();
    expect(screen.getByText("extra-desc")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("uiCard.customAnswer")).toBeInTheDocument();
  });

  it("renders confirm card without hooks error", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1", method: "confirm" })];
    expect(() => render(<UIPendingCenter />)).not.toThrow();
    const buttons = screen.getAllByRole("button");
    expect(buttons.some((b) => b.textContent?.includes("uiPending.confirm"))).toBe(true);
  });

  it("renders input card without hooks error", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1", method: "input" })];
    expect(() => render(<UIPendingCenter />)).not.toThrow();
    expect(screen.getByPlaceholderText("uiCard.pleaseInput")).toBeInTheDocument();
  });

  it("renders select card without hooks error", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({ requestId: "r1", sessionId: "sess-1", method: "select", options: ["A"] }),
    ];
    expect(() => render(<UIPendingCenter />)).not.toThrow();
    expect(screen.getByText("A")).toBeInTheDocument();
  });

  function advanceAskAutoDelay() {
    act(() => {
      vi.advanceTimersByTime(500);
    });
  }

  it("renders askUserQuestion as a step wizard and submits all answers", () => {
    vi.useFakeTimers();
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({
        requestId: "ask-1",
        sessionId: "sess-1",
        method: "askUserQuestion",
        questions: [
          {
            id: "scope",
            header: "1 / 2 Scope",
            question: "Pick scope",
            options: [{ label: "Local", description: "Local only" }],
          },
          {
            id: "checks",
            header: "2 / 2 Checks",
            question: "Pick checks",
            multiSelect: true,
            options: [
              { label: "Single", description: "Single choice" },
              { label: "Multi", description: "Multiple choices" },
            ],
          },
        ],
      }),
    ];

    render(<UIPendingCenter />);

    expect(screen.getByText("1 / 2 Scope")).toBeInTheDocument();
    expect(screen.queryByText("2 / 2 Checks")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Local/i }));

    expect(screen.getByText("1 / 2 Scope")).toBeInTheDocument();
    expect(screen.getByText(/uiCard\.selectionSaved/)).toBeInTheDocument();
    expect(screen.queryByText("2 / 2 Checks")).not.toBeInTheDocument();

    advanceAskAutoDelay();

    expect(screen.queryByText("1 / 2 Scope")).not.toBeInTheDocument();
    expect(screen.getByText("2 / 2 Checks")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /common:back/i })).toBeInTheDocument();

    const submitButton = screen.getByRole("button", { name: /common:submit/i });
    expect(submitButton).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Single/i }));
    fireEvent.click(screen.getByRole("button", { name: /Multi/i }));
    expect(submitButton).not.toBeDisabled();
    fireEvent.click(submitButton);

    expect(mockRespondById).toHaveBeenCalledWith("ask-1", {
      action: "responded",
      answers: {
        scope: { selected: ["Local"] },
        checks: { selected: ["Single", "Multi"] },
      },
    });
  });

  it("lets askUserQuestion navigate back to the previous step", () => {
    vi.useFakeTimers();
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({
        requestId: "ask-1",
        sessionId: "sess-1",
        method: "askUserQuestion",
        questions: [
          {
            id: "scope",
            header: "1 / 2 Scope",
            question: "Pick scope",
            options: [{ label: "Local", description: "Local only" }],
          },
          {
            id: "checks",
            header: "2 / 2 Checks",
            question: "Pick checks",
            options: [{ label: "Single", description: "Single choice" }],
          },
        ],
      }),
    ];

    render(<UIPendingCenter />);
    fireEvent.click(screen.getByRole("button", { name: /Local/i }));
    advanceAskAutoDelay();
    fireEvent.click(screen.getByRole("button", { name: /common:back/i }));

    expect(screen.getByText("1 / 2 Scope")).toBeInTheDocument();
    expect(screen.queryByText("2 / 2 Checks")).not.toBeInTheDocument();
  });

  it("treats custom askUserQuestion input as exclusive and keeps manual next", () => {
    vi.useFakeTimers();
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({
        requestId: "ask-1",
        sessionId: "sess-1",
        method: "askUserQuestion",
        questions: [
          {
            id: "scope",
            header: "1 / 2 Scope",
            question: "Pick scope",
            options: [{ label: "Local", description: "Local only" }],
          },
          {
            id: "confirm",
            header: "2 / 2 Confirm",
            question: "Confirm",
            options: [{ label: "Done", description: "Ready" }],
          },
        ],
      }),
    ];

    render(<UIPendingCenter />);

    fireEvent.click(screen.getByRole("button", { name: /Local/i }));
    advanceAskAutoDelay();
    fireEvent.click(screen.getByRole("button", { name: /common:back/i }));
    fireEvent.change(screen.getByPlaceholderText("uiCard.customAnswer"), {
      target: { value: "Shared" },
    });
    fireEvent.click(screen.getAllByRole("button", { name: /common:next/i }).at(-1)!);
    fireEvent.click(screen.getByRole("button", { name: /Done/i }));

    expect(mockRespondById).not.toHaveBeenCalled();
    advanceAskAutoDelay();

    expect(mockRespondById).toHaveBeenCalledWith("ask-1", {
      action: "responded",
      answers: {
        scope: { selected: [], text: "Shared" },
        confirm: { selected: ["Done"] },
      },
    });
  });

  it("combines multi-select askUserQuestion options with a custom answer", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [
      makeRequest({
        requestId: "ask-1",
        sessionId: "sess-1",
        method: "askUserQuestion",
        questions: [
          {
            id: "checks",
            header: "Checks",
            question: "Pick checks",
            multiSelect: true,
            options: [
              { label: "Layout", description: "Layout issues" },
              { label: "Touch", description: "Touch issues" },
            ],
          },
        ],
      }),
    ];

    render(<UIPendingCenter />);

    fireEvent.click(screen.getByRole("button", { name: /Layout/i }));
    fireEvent.change(screen.getByPlaceholderText("uiCard.customAnswer"), {
      target: { value: "Keyboard issue" },
    });
    fireEvent.click(screen.getByRole("button", { name: /common:submit/i }));

    expect(mockRespondById).toHaveBeenCalledWith("ask-1", {
      action: "responded",
      answers: {
        checks: { selected: ["Layout"], text: "Keyboard issue" },
      },
    });
  });

  it("renders ask-user-question tool output as a structured answer card", () => {
    render(
      <AskUserQuestionToolCard
        block={{
          type: "toolExecution",
          toolCallId: "tool-ask-1",
          toolName: "ask-user-question",
          args: JSON.stringify({
            title: "交互样式反馈三步提问",
            questions: [
              {
                id: "style_feedback",
                header: "样式评价",
                question: "你觉得这个交互样式如何？",
                options: [{ label: "很好", description: "样式符合预期" }],
              },
            ],
          }),
          status: "done",
          output:
            'User answered: {"style_feedback":{"selected":["还要调整"],"text":"按钮放到底部"}}',
        }}
      />,
    );

    expect(screen.getByText("交互样式反馈三步提问")).toBeInTheDocument();
    expect(screen.getByText("样式评价")).toBeInTheDocument();
    expect(screen.getByText("（你觉得这个交互样式如何？）")).toBeInTheDocument();
    expect(screen.getByText("还要调整")).toBeInTheDocument();
    expect(screen.getByText("按钮放到底部")).toBeInTheDocument();
    expect(screen.queryByText("ask-user-question")).not.toBeInTheDocument();
    expect(screen.queryByText("style_feedback")).not.toBeInTheDocument();
    expect(screen.queryByText(/User answered/)).not.toBeInTheDocument();
  });

  it("falls back to the default tool card when ask-user-question validation fails", () => {
    render(
      <ContentBlockRenderer
        block={{
          type: "toolExecution",
          toolCallId: "tool-ask-error",
          toolName: "ask-user-question",
          args: JSON.stringify({
            title: "移动端调整详情",
            questions: [
              {
                id: "mobile_issues",
                header: "移动端问题排查",
                question: "移动端具体哪些地方需要调整？",
                multiSelect: true,
                options: [{ label: "布局错位", description: "元素位置偏移，未正确适配屏幕尺寸" }],
              },
            ],
          }),
          status: "error",
          output:
            'Validation failed for tool "ask-user-question": - questions.0.options: must not have more than 4 items',
        }}
        msgId="msg-ask-error"
        blockIndex={0}
        uiBlockMap={new Map()}
      />,
    );

    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(
      screen.getAllByText(/Validation failed for tool "ask-user-question"/).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("移动端调整详情")).not.toBeInTheDocument();
    expect(document.querySelector("svg.text-status-error")).toBeInTheDocument();
  });

  it("falls back to the default tool card when write fails", () => {
    render(
      <ContentBlockRenderer
        block={{
          type: "toolExecution",
          toolCallId: "tool-write-error",
          toolName: "write",
          args: JSON.stringify({
            path: "/opt/pi-agent-permission-test.txt",
            content: "hello",
          }),
          status: "error",
          output:
            'Permission provider "pi-hooks" failed: Project is not trusted; refusing to write project settings',
        }}
        msgId="msg-write-error"
        blockIndex={0}
        uiBlockMap={new Map()}
      />,
    );

    expect(screen.getByText("Input")).toBeInTheDocument();
    expect(screen.getByText("Output")).toBeInTheDocument();
    expect(screen.getAllByText(/Project is not trusted/).length).toBeGreaterThan(0);
    expect(screen.queryByText("opt/pi-agent-permission-test.txt/")).not.toBeInTheDocument();
  });

  it("renders pending ask-user-question tool calls as a compact anchor", () => {
    render(
      <AskUserQuestionToolCard
        block={{
          type: "toolExecution",
          toolCallId: "tool-ask-1",
          toolName: "ask-user-question",
          args: "{}",
          status: "running",
        }}
        uiBlock={{
          type: "uiInteraction",
          id: "ask-1",
          method: "askUserQuestion",
          status: "pending",
          title: "Question from tool",
          message: "Choose one",
          questions: [
            {
              id: "scope",
              header: "Scope",
              question: "Pick scope",
              options: [{ label: "Local", description: "Local only" }],
            },
          ],
        }}
      />,
    );

    expect(screen.getByText("Question from tool")).toBeInTheDocument();
    expect(screen.getByText(/uiPending\.handleRequest/)).toBeInTheDocument();
    expect(screen.queryByText("Pick scope")).not.toBeInTheDocument();
    expect(screen.queryByText("Local")).not.toBeInTheDocument();
  });

  it("renders editor card without hooks error", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1", method: "editor" })];
    expect(() => render(<UIPendingCenter />)).not.toThrow();
  });

  it("does not crash when rendering different card types sequentially (hooks rule)", () => {
    setupProject();

    const methods: Array<{ method: UIPendingRequest["method"]; options?: string[] }> = [
      { method: "askUserQuestion" },
      { method: "confirm" },
      { method: "input" },
      { method: "select", options: ["Opt1"] },
      { method: "editor" },
    ];

    for (const { method, options } of methods) {
      cleanup();
      mockPanelOpen = true;
      currentPending = [
        makeRequest({
          requestId: "r1",
          sessionId: "sess-1",
          method,
          ...(options ? { options } : {}),
        }),
      ];
      expect(() => render(<UIPendingCenter />)).not.toThrow();
    }
  });
});

describe("ProjectRuntimePendingRequests", () => {
  beforeEach(() => {
    currentPending = [];
    mockActiveProjectId = null;
    mockProjectTabs = [];
    mockSessionsByProject = {};
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders pending requests for the active session in the runtime action area", () => {
    currentPending = [
      makeRequest({
        requestId: "r1",
        sessionId: "sess-1",
        method: "confirm",
        title: "Hook permission",
        message: "Allow this command?",
        hookMeta: {
          toolName: "bash",
          matcher: "npm *",
          command: "npm run build",
          reason: "Needs approval",
        },
      }),
      makeRequest({
        requestId: "r2",
        sessionId: "sess-2",
        method: "confirm",
        title: "Other session",
        message: "Should stay hidden",
      }),
    ];

    setupProject();
    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByText("Hook permission")).toBeInTheDocument();
    expect(screen.getByText("Allow this command?")).toBeInTheDocument();
    expect(screen.getByText("npm run build")).toBeInTheDocument();
    expect(screen.getByText("uiCard.allowOnce")).toBeInTheDocument();
    expect(screen.queryByText("Other session")).not.toBeInTheDocument();
    expect(document.querySelector('[data-ui-request-id="r1"]')).toBeInTheDocument();
  });

  it("renders Goal approvals through the same structured UI request dock", () => {
    currentPending = [
      makeRequest({
        requestId: "goal-contract-1",
        sessionId: "sess-1",
        method: "askUserQuestion",
        title: "Approve Goal contract",
        message: "请确认 Goal 合同",
        questions: [
          {
            id: "goal-contract",
            header: "Goal contract",
            question: "Approve this complete Goal contract?",
            options: [
              { label: "Approve", description: "Allow the displayed Goal contract." },
              { label: "Reject", description: "Do not grant the Goal contract." },
            ],
          },
        ],
        permissionMeta: {
          type: "goal_approval",
          kind: "contract",
          goalId: "goal-1",
          generation: 2,
          objective: "Build a Tetris game",
        },
      }),
    ];

    setupProject();
    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByText("Approve Goal contract")).toBeInTheDocument();
    expect(screen.getByText("Approve this complete Goal contract?")).toBeInTheDocument();
    expect(screen.getByText("Approve")).toBeInTheDocument();
  });

  it("shows auto-deny timeout for active-session hook approval requests", () => {
    currentPending = [
      makeRequest({
        requestId: "hook-timeout",
        sessionId: "sess-1",
        method: "confirm",
        title: "Hook permission",
        message: "Allow this command?",
        timeout: 60_000,
        hookMeta: {
          toolName: "bash",
          matcher: "npm *",
          command: "npm run build",
          reason: "Needs approval",
        },
      }),
    ];

    setupProject();
    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByText("Hook permission")).toBeInTheDocument();
    expect(screen.getByText('uiCard.autoDeny {"seconds":60}')).toBeInTheDocument();
  });

  it("can dock active-session requests above the composer instead of in document flow", () => {
    currentPending = [
      makeRequest({
        requestId: "composer-r1",
        sessionId: "sess-1",
        method: "confirm",
        title: "Composer dock request",
        message: "Confirm from composer overlay",
      }),
    ];

    setupProject();
    const { container } = render(
      <ProjectRuntimePendingRequests activeSessionId="sess-1" placement="composerOverlay" />,
    );

    const dock = document.querySelector('[data-ui-dock-request-id="composer-r1"]');
    expect(dock).toHaveAttribute("data-placement", "composerOverlay");
    expect(dock).toHaveClass("pointer-events-auto");
    expect(container.firstElementChild).toHaveClass("absolute", "bottom-full", "z-30");
    expect(screen.getByText("Composer dock request")).toBeInTheDocument();
  });

  it("renders custom hook confirm and cancel labels in the runtime action area", () => {
    currentPending = [
      makeRequest({
        requestId: "hook-labels",
        sessionId: "sess-1",
        method: "confirm",
        title: "Hook permission",
        message: "Allow this command?",
        confirmText: "允许一次",
        cancelText: "取消执行",
        hookMeta: {
          toolName: "bash",
          matcher: "echo *",
          command: "echo HOT_RELOAD_PERM_TEST",
          reason: "Needs approval",
        },
      }),
    ];

    setupProject();
    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByText("允许一次")).toBeInTheDocument();
    expect(screen.getByText("取消执行")).toBeInTheDocument();
    expect(screen.queryByText("uiCard.allowOnce")).not.toBeInTheDocument();
  });

  it("keeps simultaneous hook requests in one active-session dock", () => {
    currentPending = [
      makeRequest({
        requestId: "hook-1",
        sessionId: "sess-1",
        method: "confirm",
        title: "Dangerous bash",
        message: "Allow npm build?",
        hookMeta: {
          toolName: "bash",
          matcher: "npm *",
          command: "npm run build",
          hookCommand: "bash ~/.claude/hooks/pre-tool-use.sh",
          eventName: "PreToolUse",
          source: "global",
          reason: "Needs approval",
        },
      }),
      makeRequest({
        requestId: "hook-2",
        sessionId: "sess-1",
        method: "confirm",
        title: "Second hook",
        message: "Allow test command?",
        hookMeta: {
          toolName: "bash",
          matcher: "bun *",
          command: "bun test",
          hookCommand: "bash ~/.claude/hooks/pre-tool-use.sh",
          eventName: "PreToolUse",
          source: "project",
          reason: "Needs approval",
        },
      }),
      makeRequest({
        requestId: "path-1",
        sessionId: "sess-1",
        method: "select",
        title: "Path Access",
        message: "Allow write outside project?",
        options: ["✅ Allow once", "📁 Always allow", "❌ Deny"],
        permissionMeta: {
          type: "path_boundary",
          path: "/tmp/outside.txt",
          cwd: "/projects/my-project",
          toolName: "write",
          scope: "write",
          relativeTo: "outside project",
        },
      }),
      makeRequest({
        requestId: "other-session",
        sessionId: "sess-2",
        method: "confirm",
        title: "Other session hook",
      }),
    ];

    setupProject();
    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByText("Dangerous bash")).toBeInTheDocument();
    expect(screen.getByText("npm run build")).toBeInTheDocument();
    expect(screen.getByText("Second hook")).toBeInTheDocument();
    expect(screen.getByText("Path Access")).toBeInTheDocument();
    expect(screen.queryByText("Other session hook")).not.toBeInTheDocument();
    expect(document.querySelector('[data-ui-dock-request-id="hook-1"]')).toBeInTheDocument();
    expect(document.querySelector('[data-ui-dock-request-id="hook-2"]')).toBeInTheDocument();
    expect(document.querySelector('[data-ui-dock-request-id="path-1"]')).toBeInTheDocument();
  });

  it("submits path-boundary permission choices from the active-session dock", () => {
    setupProject();
    currentPending = [
      makeRequest({
        requestId: "path-1",
        sessionId: "sess-1",
        method: "select",
        title: "Path Access",
        options: ["✅ Allow once", "📁 Always allow", "❌ Deny"],
        permissionMeta: {
          type: "path_boundary",
          path: "/tmp/outside.txt",
          cwd: "/projects/my-project",
          toolName: "write",
          scope: "write",
          relativeTo: "outside project",
        },
      }),
    ];

    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByText("Path Access")).toBeInTheDocument();
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Session A")).toBeInTheDocument();
    expect(screen.getByText("Operation")).toBeInTheDocument();
    expect(screen.getAllByText("write").length).toBeGreaterThan(0);
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("/tmp/outside.txt")).toBeInTheDocument();
    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Allow once/i }));

    expect(mockRespondById).toHaveBeenCalledWith("path-1", { value: "✅ Allow once" });
  });

  it("submits runtime permission choices from the active-session dock", () => {
    setupProject();
    currentPending = [
      makeRequest({
        requestId: "perm-1",
        sessionId: "sess-1",
        method: "select",
        title: "Confirm command",
        message: "Run command flagged for recursive rm?",
        options: [
          "1. Allow once",
          "2. Always allow: Exact command",
          "3. Always allow: Any git commit that skips verification",
          "4. Deny once",
          "5. Always deny: Exact command",
          "6. Always deny: Any git commit that skips verification",
        ],
        permissionMeta: {
          type: "permission_runtime",
          requestId: "perm-1",
          provider: "dangerous-command",
          subject: "command.run",
          rememberOptions: [
            {
              id: "allow-exact",
              label: "Exact command",
              subject: "command.run",
              pattern: "git commit --no-verify -m wip",
              scope: "project",
              action: "allow",
            },
            {
              id: "allow-family",
              label: "Any git commit that skips verification",
              subject: "command.run",
              pattern: "git commit *--no-verify*",
              scope: "project",
              action: "allow",
            },
            {
              id: "deny-exact",
              label: "Exact command",
              subject: "command.run",
              pattern: "git commit --no-verify -m wip",
              scope: "project",
              action: "deny",
            },
            {
              id: "deny-family",
              label: "Any git commit that skips verification",
              subject: "command.run",
              pattern: "git commit *--no-verify*",
              scope: "project",
              action: "deny",
            },
          ],
          toolCallId: "tool-1",
          metadata: {
            command: "git commit --no-verify -m wip",
          },
        },
      }),
    ];

    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByText("Confirm command")).toBeInTheDocument();
    expect(screen.getByText("Session")).toBeInTheDocument();
    expect(screen.getByText("Session A")).toBeInTheDocument();
    expect(screen.getByText("Operation")).toBeInTheDocument();
    expect(screen.getByText("command.run")).toBeInTheDocument();
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.getByText("Risk")).toBeInTheDocument();
    expect(screen.getByText("High")).toBeInTheDocument();
    expect(screen.getByText("dangerous-command")).toBeInTheDocument();
    expect(screen.getByText("command.run")).toBeInTheDocument();
    expect(screen.getByText("git commit --no-verify -m wip")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny once" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Always allow" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Always deny" })).not.toBeInTheDocument();
    expect(screen.getByText("git commit *--no-verify*")).toBeInTheDocument();
    expect(screen.queryByText("Always deny: Exact command")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Always allow: Any git commit that skips verification",
      }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "More permission actions" }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Always allow" }));

    expect(mockRespondById).toHaveBeenCalledWith("perm-1", {
      value: "3. Always allow: Any git commit that skips verification",
    });
  });

  it("keeps raw Deny as the primary one-time deny action", () => {
    setupProject();
    currentPending = [
      makeRequest({
        requestId: "perm-path-1",
        sessionId: "sess-1",
        method: "select",
        title: "Path permission",
        message: "Allow write outside project?",
        options: [
          "1. Allow once",
          "2. Always allow: Any write under /opt",
          "3. Deny",
          "4. Always deny: This exact path",
        ],
        permissionMeta: {
          type: "permission_runtime",
          requestId: "perm-path-1",
          provider: "path-access",
          subject: "file.write",
          rememberOptions: [
            {
              id: "allow-opt",
              label: "Any write under /opt",
              subject: "file.write",
              pattern: "/opt/**",
              scope: "project",
              action: "allow",
            },
            {
              id: "deny-exact-path",
              label: "This exact path",
              subject: "file.write",
              pattern: "/opt/pi-agent-permission-test.txt",
              scope: "project",
              action: "deny",
            },
          ],
          toolCallId: "tool-1",
          metadata: {
            path: "/opt/pi-agent-permission-test.txt",
          },
        },
      }),
    ];

    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Always allow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Always deny" })).not.toBeInTheDocument();
    expect(screen.getByText("Match")).toBeInTheDocument();
    expect(screen.getByText("Project settings")).toBeInTheDocument();
    expect(screen.getByText("/opt/**")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Always deny: This exact path" }),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Deny" }));

    expect(mockRespondById).toHaveBeenCalledWith("perm-path-1", {
      value: "3. Deny",
    });
  });

  it("renders path permission cards with no more than three primary choices", () => {
    const block: UIInteractionBlock = {
      type: "uiInteraction",
      id: "path-card-1",
      method: "select",
      status: "pending",
      title: "Path Access",
      options: ["1. Allow once", "2. Always allow", "3. Deny", "4. Always deny: This exact path"],
      permissionMeta: {
        type: "path_boundary",
        path: "/opt/pi-agent-permission-test.txt",
        cwd: "/Users/xuyingzhou/Project/study-web/猴子",
        toolName: "Write",
        scope: "write",
        relativeTo: "outside project directory",
      },
    };

    render(<PathPermissionCard block={block} />);

    expect(screen.getByRole("button", { name: "Allow once" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Always allow" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deny" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Always deny/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(3);
    expect(screen.getByText("Match")).toBeInTheDocument();
    expect(screen.getByText("Current session only")).toBeInTheDocument();
    expect(screen.getByText("/opt/∗∗")).toBeInTheDocument();
  });

  it("shows auto-deny timeout on pending hook confirm cards", () => {
    const block: UIInteractionBlock = {
      type: "uiInteraction",
      id: "hook-confirm-1",
      method: "confirm",
      status: "pending",
      title: "Bash confirmation",
      message: "Allow this command?",
      timeout: 60_000,
      hookMeta: {
        toolName: "bash",
        matcher: "npm *",
        command: "npm run build",
        hookCommand: "bash ~/.pi/hooks/pre-tool-use.sh",
        eventName: "PreToolUse",
        source: "project",
        reason: "Needs approval",
      },
    };

    render(<ConfirmCard block={block} />);

    expect(screen.getByText("Bash confirmation")).toBeInTheDocument();
    expect(screen.getByText("npm run build")).toBeInTheDocument();
    expect(screen.getByText('uiCard.autoDeny {"seconds":60}')).toBeInTheDocument();
  });

  it("does not render pending requests from other sessions in the runtime action area", () => {
    setupProject();
    currentPending = [
      makeRequest({ requestId: "r1", sessionId: "sess-2", title: "Other session permission" }),
    ];

    const { container } = render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(container.innerHTML).toBe("");
    expect(screen.queryByText("Other session permission")).not.toBeInTheDocument();
    expect(screen.queryByText("uiPending.gotoSession")).not.toBeInTheDocument();
  });

  it("renders active session requests even when project session metadata is not loaded", () => {
    currentPending = [
      makeRequest({
        requestId: "r1",
        sessionId: "sess-1",
        title: "Current session permission",
        message: "Current session only",
      }),
    ];

    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByText("Current session permission")).toBeInTheDocument();
    expect(screen.getByText("Current session only")).toBeInTheDocument();
  });

  it("renders bash command confirm requests without hook metadata in the runtime action area", () => {
    setupProject();
    currentPending = [
      makeRequest({
        requestId: "r1",
        sessionId: "sess-1",
        title: "Bash 命令确认",
        message: "YOLO 跨项目写入测试",
      }),
    ];

    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByText("Bash 命令确认")).toBeInTheDocument();
    expect(screen.getByText("YOLO 跨项目写入测试")).toBeInTheDocument();
    expect(screen.getAllByText("uiPending.confirm").length).toBeGreaterThan(0);
  });

  it("renders nothing when the active session has no pending requests", () => {
    setupProject();
    currentPending = [makeRequest({ requestId: "r1", sessionId: "other-session" })];

    const { container } = render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(container.innerHTML).toBe("");
  });

  it("surfaces nested subtask questions in the parent session dock with source label", () => {
    mockSessionsByProject = {
      "/projects/my-project": [
        { sessionId: "sess-parent", name: "Parent Session", sessionPath: "/sessions/parent.jsonl" },
      ],
    };
    mockSubsessionsByParent = {
      "/sessions/parent.jsonl": [
        {
          sessionId: "sess-grandchild",
          sessionPath: "/sessions/grandchild.jsonl",
          description: "Grandchild Task",
          instruction: "Answer from nested subtask",
        },
      ],
    };
    currentPending = [
      makeRequest({
        requestId: "grandchild-ask",
        sessionId: "sess-grandchild",
        parentSessionId: "sess-parent",
        method: "askUserQuestion",
        title: "Grandchild asks",
        questions: [
          {
            id: "decision",
            header: "Decision",
            question: "Answer from nested subtask?",
            options: [{ label: "Yes", description: "Continue" }],
          },
        ],
      }),
    ];

    render(<ProjectRuntimePendingRequests activeSessionId="sess-parent" />);
    expect(screen.getByText("Grandchild asks")).toBeInTheDocument();
    expect(screen.getByTitle("Grandchild Task")).toBeInTheDocument();
    expect(
      document.querySelector('[data-ui-dock-request-id="grandchild-ask"]'),
    ).toBeInTheDocument();
    cleanup();

    render(<ProjectRuntimePendingRequests activeSessionId="sess-grandchild" />);

    expect(screen.getByText("Grandchild asks")).toBeInTheDocument();
    expect(screen.getByText("Answer from nested subtask?")).toBeInTheDocument();
    expect(
      document.querySelector('[data-ui-dock-request-id="grandchild-ask"]'),
    ).toBeInTheDocument();
  });
});

describe("useProjectPendingCount", () => {
  beforeEach(() => {
    currentPending = [];
    mockActiveProjectId = null;
    mockProjectTabs = [];
    mockSessionsByProject = {};
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("returns 0 when no active project", () => {
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1" })];
    const { result } = renderHook(() => useProjectPendingCount());
    expect(result.current).toBe(0);
  });

  it("returns correct count for current project only", () => {
    setupProject();
    currentPending = [
      makeRequest({ requestId: "r1", sessionId: "sess-1" }),
      makeRequest({ requestId: "r2", sessionId: "sess-2" }),
      makeRequest({ requestId: "r3", sessionId: "other-sess" }),
    ];
    const { result } = renderHook(() => useProjectPendingCount());
    expect(result.current).toBe(2);
  });

  it("returns 0 when no pending requests", () => {
    setupProject();
    const { result } = renderHook(() => useProjectPendingCount());
    expect(result.current).toBe(0);
  });
});

describe("UIPendingCenter nested subtask requests", () => {
  beforeEach(() => {
    mockActiveProjectId = "proj-1";
    mockProjectTabs = [{ id: "proj-1", name: "My Project", path: "/projects/my-project" }];
    mockSessionsByProject = {
      "/projects/my-project": [
        { sessionId: "sess-parent", name: "Parent Session" },
        { sessionId: "sess-child", name: "Child Task" },
        { sessionId: "sess-grandchild", name: "Grandchild Task" },
      ],
    };
    mockPanelOpen = true;
    currentPending = [];
    mockSubsessionsByParent = {};
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("groups nested child requests in the project pending center and jumps to the owning session", () => {
    currentPending = [
      makeRequest({
        requestId: "grandchild-ask",
        sessionId: "sess-grandchild",
        method: "askUserQuestion",
        title: "Grandchild asks",
        questions: [
          {
            id: "decision",
            header: "Decision",
            question: "Answer from nested subtask?",
            options: [{ label: "Yes", description: "Continue" }],
          },
        ],
      }),
      makeRequest({
        requestId: "child-hook",
        sessionId: "sess-child",
        method: "confirm",
        title: "Child hook approval",
        message: "Allow child task command?",
      }),
    ];

    render(<UIPendingCenter />);

    expect(screen.getAllByText("Grandchild Task").length).toBeGreaterThan(0);
    expect(screen.getByText("Child Task")).toBeInTheDocument();
    expect(screen.getAllByText("Grandchild asks").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Child hook approval").length).toBeGreaterThan(0);

    const grandchildGroup = screen.getAllByText("Grandchild Task")[0]?.closest(".border");
    expect(grandchildGroup).not.toBeNull();
    fireEvent.click(within(grandchildGroup as HTMLElement).getByText("uiPending.gotoSession"));

    expect(mockSetPanelOpen).toHaveBeenCalledWith(false);
    expect(mockJumpToSessionById).toHaveBeenCalledWith("sess-grandchild");
  });
});

describe("UIPendingCenter subagent request recovery", () => {
  beforeEach(() => {
    mockActiveProjectId = "proj-1";
    mockProjectTabs = [{ id: "proj-1", name: "My Project", path: "/projects/my-project" }];
    mockSessionsByProject = {
      "/projects/my-project": [
        {
          sessionId: "sess-parent",
          name: "Parent Session",
          sessionPath: "/sessions/parent.jsonl",
        },
      ],
    };
    mockSubsessionsByParent = {
      "/sessions/parent.jsonl": [
        {
          sessionId: "sess_sub_001",
          sessionPath: "/sessions/sess_sub_001.jsonl",
          description: "Child Task",
          instruction: "Handle child approval",
        },
      ],
    };
    currentPending = [];
    mockPanelOpen = true;
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("counts and renders current-project subagent requests even when child session is only in subsessionsByParent", () => {
    currentPending = [
      makeRequest({
        requestId: "subagent-approval",
        sessionId: "sess_sub_001",
        method: "askUserQuestion",
        title: "Child approval",
        message: "Allow child write?",
        questions: [
          {
            id: "approval",
            header: "Approval",
            question: "Allow child write?",
            options: [{ label: "Allow", description: "Continue child task" }],
          },
        ],
      }),
    ];

    const { result } = renderHook(() => useProjectPendingCount());
    expect(result.current).toBe(1);

    render(<UIPendingCenter />);
    expect(screen.getByTitle(/uiPending\.pendingRequestsCount/i)).toHaveTextContent("1");
    expect(screen.getAllByText("Child approval").length).toBeGreaterThan(0);
    expect(screen.getByText("uiPending.fromSession")).toBeInTheDocument();
    expect(screen.getAllByText("uiPending.subtaskSource").length).toBeGreaterThan(0);
    expect(screen.getByText("↳ uiPending.subtaskSource")).toBeInTheDocument();
  });

  it("bulk handles current-project subagent approval requests", () => {
    currentPending = [
      makeRequest({
        requestId: "subagent-runtime-approval",
        sessionId: "sess_sub_001",
        method: "select",
        title: "Child runtime approval",
        options: ["1. Allow once", "2. Always allow: Exact command", "3. Deny once"],
        permissionMeta: {
          type: "permission_runtime",
          requestId: "subagent-runtime-approval",
          provider: "dangerous-command",
          subject: "command.run",
          toolCallId: "tool-1",
        },
      }),
    ];

    render(<UIPendingCenter />);
    expect(screen.getByTitle(/uiPending\.pendingRequestsCount/i)).toHaveTextContent("1");
    expect(screen.getByText("↳ uiPending.subtaskSource")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /uiPending\.batchAllowOnce/ }));

    expect(mockRespondById).toHaveBeenCalledWith("subagent-runtime-approval", {
      value: "1. Allow once",
    });
  });

  it("keeps project pending visible for live child requests before subagent list is restored", () => {
    mockSubsessionsByParent = {};
    currentPending = [
      makeRequest({
        requestId: "live-subagent-approval",
        sessionId: "sess_sub_live",
        title: "Live child approval",
        message: "Allow child command?",
        parentSessionId: "sess-parent",
      }),
    ];

    const { result } = renderHook(() => useProjectPendingCount());
    expect(result.current).toBe(1);

    render(<UIPendingCenter />);
    expect(screen.getByTitle(/uiPending\.pendingRequestsCount/i)).toHaveTextContent("1");
    expect(screen.getAllByText("Live child approval").length).toBeGreaterThan(0);
  });
});
