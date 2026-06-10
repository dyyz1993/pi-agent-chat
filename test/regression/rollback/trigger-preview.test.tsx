import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { RollbackOverlay } from "../../../src/mainview/components/chat/RollbackOverlay";
import { useRollbackStore } from "../../../src/mainview/stores/use-rollback-store";
import type { RollbackPreview } from "../../../src/mainview/stores/use-rollback-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
  initReactI18next: { type: "3rdParty", init: vi.fn() },
}));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onReconnect: () => {},
  },
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = {
        activeSessionId: "s1",
        activeProjectId: "p1",
        projectTabs: [],
        sessionsByProject: {},
      };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        activeSessionId: "s1",
        activeProjectId: "p1",
        projectTabs: [],
        sessionsByProject: {},
      }),
    },
  ),
}));

vi.mock("../../../src/mainview/stores/use-chat-store", () => ({
  useChatStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { messagesBySession: {} };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ messagesBySession: {}, loadSessionMessages: vi.fn() }) },
  ),
}));

vi.mock("../../../src/mainview/stores/use-notification-store", () => ({
  useNotificationStore: Object.assign(
    (selector?: (s: Record<string, unknown>) => unknown) => {
      const state = { push: vi.fn() };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ push: vi.fn() }) },
  ),
}));

vi.mock("../../shared/lib/logger", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

function makePreview(files: RollbackPreview["files"] = []): RollbackPreview {
  return {
    restored: [],
    deleted: [],
    files,
    summary: {
      totalFiles: files.length,
      added: files.filter((f) => f.status === "added").length,
      modified: files.filter((f) => f.status === "modified").length,
      deleted: files.filter((f) => f.status === "deleted").length,
    },
  };
}

function makeFile(
  path: string,
  status: "added" | "modified" | "deleted",
  overrides?: Partial<RollbackPreview["files"][0]>,
): RollbackPreview["files"][0] {
  return {
    path,
    status,
    turnIndex: 0,
    entryId: "e1",
    ...overrides,
  };
}

function renderOverlay() {
  return render(<RollbackOverlay />);
}

describe("RollbackOverlay", () => {
  afterEach(() => {
    cleanup();
    useRollbackStore.getState().closeRollback();
    vi.clearAllMocks();
  });

  describe("Group A: Overlay opens with different modes", () => {
    it("case 1: message mode shows title and description", () => {
      useRollbackStore.getState().openRollback({ targetId: "t1", mode: "message" }, makePreview());
      renderOverlay();
      expect(screen.getByText("rollbackOverlay.title")).toBeInTheDocument();
      expect(screen.getByText("rollbackOverlay.messageModeDesc")).toBeInTheDocument();
    });

    it("case 2: withFiles mode shows titleWithFiles", () => {
      useRollbackStore
        .getState()
        .openRollback({ targetId: "t1", mode: "withFiles" }, makePreview());
      renderOverlay();
      expect(screen.getByText("rollbackOverlay.titleWithFiles")).toBeInTheDocument();
    });

    it("case 3: overlay shows confirm and cancel buttons", () => {
      useRollbackStore.getState().openRollback({ targetId: "t1", mode: "message" }, makePreview());
      renderOverlay();
      expect(screen.getByText("rollbackOverlay.confirm")).toBeInTheDocument();
      expect(screen.getByText("rollbackOverlay.cancel")).toBeInTheDocument();
    });

    it("case 4: overlay has close (X) button", () => {
      useRollbackStore.getState().openRollback({ targetId: "t1", mode: "message" }, makePreview());
      renderOverlay();
      const closeBtn = screen.getByTitle("rollbackOverlay.cancel");
      expect(closeBtn).toBeInTheDocument();
      expect(closeBtn.querySelector("svg")).toBeTruthy();
    });
  });

  describe("Group B: File list display", () => {
    it("case 5: withFiles mode with mixed files shows all items with badges", () => {
      const files = [
        makeFile("src/a.ts", "modified"),
        makeFile("src/b.ts", "modified"),
        makeFile("src/c.ts", "modified"),
        makeFile("src/d.ts", "deleted"),
      ];
      useRollbackStore
        .getState()
        .openRollback({ targetId: "t1", mode: "withFiles" }, makePreview(files));
      renderOverlay();
      expect(screen.getByText("src/a.ts")).toBeInTheDocument();
      expect(screen.getByText("src/b.ts")).toBeInTheDocument();
      expect(screen.getByText("src/c.ts")).toBeInTheDocument();
      expect(screen.getByText("src/d.ts")).toBeInTheDocument();
      const badges = screen.getAllByText("M");
      expect(badges).toHaveLength(3);
      expect(screen.getByText("D")).toBeInTheDocument();
    });

    it("case 6: all deleted files - expanded shows fileWillBeDeleted", () => {
      const files = [makeFile("src/gone.ts", "deleted")];
      useRollbackStore
        .getState()
        .openRollback({ targetId: "t1", mode: "withFiles" }, makePreview(files));
      renderOverlay();
      const fileBtn = screen.getByText("src/gone.ts");
      fireEvent.click(fileBtn);
      expect(screen.getByText("rollbackOverlay.fileWillBeRestored")).toBeInTheDocument();
    });

    it("case 7: added file - expanded shows fileWillBeRemoved", () => {
      const files = [makeFile("src/new.ts", "added")];
      useRollbackStore
        .getState()
        .openRollback({ targetId: "t1", mode: "withFiles" }, makePreview(files));
      renderOverlay();
      fireEvent.click(screen.getByText("src/new.ts"));
      expect(screen.getByText("rollbackOverlay.fileWillBeRemoved")).toBeInTheDocument();
    });

    it("case 8: modified file - expanded shows fileWillBeRestored", () => {
      const files = [makeFile("src/changed.ts", "modified")];
      useRollbackStore
        .getState()
        .openRollback({ targetId: "t1", mode: "withFiles" }, makePreview(files));
      renderOverlay();
      fireEvent.click(screen.getByText("src/changed.ts"));
      expect(screen.getByText("rollbackOverlay.fileWillBeRestored")).toBeInTheDocument();
    });
  });

  describe("Group C: Expand/collapse files", () => {
    it("case 9: click to expand, click again to collapse", () => {
      const files = [makeFile("src/foo.ts", "modified")];
      useRollbackStore
        .getState()
        .openRollback({ targetId: "t1", mode: "withFiles" }, makePreview(files));
      renderOverlay();
      const btn = screen.getByText("src/foo.ts").closest("button")!;
      fireEvent.click(btn);
      expect(screen.getByText("rollbackOverlay.fileWillBeRestored")).toBeInTheDocument();
      fireEvent.click(btn);
      expect(screen.queryByText("rollbackOverlay.fileWillBeRestored")).not.toBeInTheDocument();
    });
  });

  describe("Group D: Empty file list", () => {
    it("case 10: withFiles mode with empty files shows noFiles", () => {
      useRollbackStore
        .getState()
        .openRollback({ targetId: "t1", mode: "withFiles" }, makePreview([]));
      renderOverlay();
      expect(screen.getByText("rollbackOverlay.noFiles")).toBeInTheDocument();
    });
  });

  describe("Group E: Cancel interactions", () => {
    it("case 12: click cancel button closes overlay", () => {
      useRollbackStore.getState().openRollback({ targetId: "t1", mode: "message" }, makePreview());
      renderOverlay();
      const cancelButtons = screen.getAllByText("rollbackOverlay.cancel");
      fireEvent.click(cancelButtons[0]);
      expect(useRollbackStore.getState().open).toBe(false);
    });

    it("case 13: overlay does not render when open=false", () => {
      renderOverlay();
      expect(screen.queryByText("rollbackOverlay.title")).not.toBeInTheDocument();
    });
  });

  describe("Group F: Loading state", () => {
    it("case 15: loading=true shows spinner and confirm is disabled", () => {
      useRollbackStore.getState().openRollback({ targetId: "t1", mode: "message" }, makePreview());
      useRollbackStore.getState().setLoading(true);
      renderOverlay();
      const confirmBtn = screen.getByText("rollbackOverlay.confirm").closest("button")!;
      expect(confirmBtn).toBeDisabled();
      expect(confirmBtn.querySelector(".animate-spin")).toBeTruthy();
    });
  });
});
