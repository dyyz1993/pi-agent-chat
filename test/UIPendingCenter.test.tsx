import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
  renderHook,
} from "@testing-library/react";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  ProjectRuntimePendingRequests,
  UIPendingCenter,
  useProjectPendingCount,
} from "../src/mainview/components/chat/UIPendingCenter";
import { HookPermissionBanner } from "../src/mainview/components/chat/HookPermissionBanner";
import type { UIPendingRequest } from "../src/mainview/stores/use-ui-dialog-store";

let currentPending: UIPendingRequest[] = [];
let mockPanelOpen = false;
const mockSetPanelOpen = vi.fn();
const mockTogglePanel = vi.fn();
const mockRespondById = vi.fn();
const mockDismissById = vi.fn();

let mockActiveProjectId: string | null = null;
let mockProjectTabs: { id: string; name: string; path: string }[] = [];
let mockSessionsByProject: Record<
  string,
  { sessionId: string; name: string; firstMessage?: string }[]
> = {};
const mockSetActiveSession = vi.fn();

vi.mock("../src/mainview/stores/use-ui-dialog-store", () => ({
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

vi.mock("../src/mainview/stores/use-session-store", () => ({
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

vi.mock("react-i18next", () => ({
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
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
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

  it("calls setActiveSession and closes modal on goto session click", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1" })];
    render(<UIPendingCenter />);
    const gotoBtn = screen.getByTitle("uiPending.gotoSession");
    fireEvent.click(gotoBtn);
    expect(mockSetActiveSession).toHaveBeenCalledWith("sess-1");
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
    const { container } = render(<UIPendingCenter />);
    const textarea = container.querySelector("textarea");
    expect(textarea).toBeInTheDocument();
    expect(textarea?.value).toBe("existing code");
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
    const { container } = render(<UIPendingCenter />);
    expect(screen.getByText("OptionA")).toBeInTheDocument();
    expect(screen.getByText("extra-desc")).toBeInTheDocument();
    expect(container.querySelector('input[type="text"]')).toBeInTheDocument();
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

  it("renders editor card without hooks error", () => {
    setupProject();
    mockPanelOpen = true;
    currentPending = [makeRequest({ requestId: "r1", sessionId: "sess-1", method: "editor" })];
    expect(() => render(<UIPendingCenter />)).not.toThrow();
  });

  it("does not crash when rendering different card types sequentially (hooks rule)", () => {
    setupProject();

    const methods: Array<{ method: UIPendingRequest["method"]; options?: string[] }> = [
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
    expect(screen.getByText("Other session")).toBeInTheDocument();
    expect(document.querySelector('[data-ui-request-id="r1"]')).toBeInTheDocument();
  });

  it("renders pending requests from other sessions in the current project", () => {
    setupProject();
    currentPending = [
      makeRequest({ requestId: "r1", sessionId: "sess-2", title: "Other session permission" }),
    ];

    render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(screen.getByText("Other session permission")).toBeInTheDocument();
    expect(screen.getByText("Session B")).toBeInTheDocument();
    expect(screen.getByText("uiPending.gotoSession")).toBeInTheDocument();
  });

  it("renders nothing when the current project has no pending requests", () => {
    setupProject();
    currentPending = [makeRequest({ requestId: "r1", sessionId: "other-session" })];

    const { container } = render(<ProjectRuntimePendingRequests activeSessionId="sess-1" />);

    expect(container.innerHTML).toBe("");
  });
});

describe("HookPermissionBanner", () => {
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

  it("renders hook permission requests from other sessions in the current project", () => {
    setupProject();
    currentPending = [
      makeRequest({
        requestId: "r1",
        sessionId: "sess-2",
        title: "Other session permission",
        message: "Allow build?",
        hookMeta: {
          toolName: "bash",
          matcher: "npm *",
          command: "npm run build",
          reason: "Needs approval",
        },
      }),
    ];

    render(<HookPermissionBanner sessionId="sess-1" />);

    expect(screen.getByText("Session B")).toBeInTheDocument();
    expect(screen.getByText("uiPending.gotoSession")).toBeInTheDocument();
    expect(screen.getByText("npm run build")).toBeInTheDocument();
    expect(screen.getByText("uiCard.allowOnce")).toBeInTheDocument();

    fireEvent.click(screen.getByText("uiPending.gotoSession"));
    expect(mockSetActiveSession).toHaveBeenCalledWith("sess-2");
  });

  it("renders bash command confirm requests without hook metadata", () => {
    setupProject();
    currentPending = [
      makeRequest({
        requestId: "r1",
        sessionId: "sess-1",
        title: "Bash 命令确认",
        message: "YOLO 跨项目写入测试",
      }),
    ];

    render(<HookPermissionBanner sessionId="sess-1" />);

    expect(screen.getByText("Bash")).toBeInTheDocument();
    expect(screen.getByText("Bash 命令确认")).toBeInTheDocument();
    expect(screen.getByText("YOLO 跨项目写入测试")).toBeInTheDocument();
    expect(screen.getByText("uiCard.allowOnce")).toBeInTheDocument();
  });

  it("renders nothing for non-hook pending requests", () => {
    setupProject();
    currentPending = [
      makeRequest({ requestId: "r1", sessionId: "sess-1", title: "Generic confirm" }),
    ];

    const { container } = render(<HookPermissionBanner sessionId="sess-1" />);

    expect(container.innerHTML).toBe("");
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
