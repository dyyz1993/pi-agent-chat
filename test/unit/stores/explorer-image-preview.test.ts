import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
  },
}));

vi.mock("../../../src/mainview/stores/use-app-store", () => ({
  useAppStore: {
    getState: () => ({
      addLog: vi.fn(),
    }),
  },
}));

const mockOpenFileOverlay = vi.fn();
const mockCloseOverlay = vi.fn();

vi.mock("../../../src/mainview/stores/use-chat-overlay-store", () => ({
  useChatOverlayStore: {
    getState: () => ({
      openFile: mockOpenFileOverlay,
      close: mockCloseOverlay,
    }),
  },
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { apiClient } from "../../../src/mainview/lib/api-client";
import { useExplorerStore } from "../../../src/mainview/stores/use-explorer-store";

const mockedCall = apiClient.call as ReturnType<typeof vi.fn>;

describe("useExplorerStore image preview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExplorerStore.setState({
      treeNodes: [],
      currentPath: "",
      selectedPath: null,
      filePreview: null,
      loadingFile: false,
      editingNode: null,
      _explorerVersion: 0,
      _fileWatchSubId: null,
      _refreshDebounceTimer: null,
      _pendingRefreshDirs: new Set(),
    });
  });

  it("loads SVG previews through file.readFile so remote paths are resolved by RPC", async () => {
    mockedCall.mockResolvedValueOnce({
      content: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
      size: 72,
    });

    await useExplorerStore.getState().openFile({
      name: "dragon-boat.svg",
      path: "/remote/project/drawings/dragon-boat.svg",
      type: "file",
      size: 72,
    });

    expect(mockedCall).toHaveBeenCalledWith("file.readFile", {
      path: "/remote/project/drawings/dragon-boat.svg",
    });
    expect(useExplorerStore.getState().filePreview).toMatchObject({
      name: "dragon-boat.svg",
      mimeType: "image/svg+xml",
      content: '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
      imageUrl: null,
      isImage: true,
    });
  });

  it("loads raster image previews through file.readBinaryFile and renders a data URL", async () => {
    mockedCall.mockResolvedValueOnce({
      base64: "iVBORw0KGgo=",
      size: 8,
    });

    await useExplorerStore.getState().openFile({
      name: "screen.png",
      path: "/remote/project/screen.png",
      type: "file",
      size: 8,
    });

    expect(mockedCall).toHaveBeenCalledWith("file.readBinaryFile", {
      path: "/remote/project/screen.png",
    });
    expect(useExplorerStore.getState().filePreview).toMatchObject({
      name: "screen.png",
      mimeType: "image/png",
      imageUrl: "data:image/png;base64,iVBORw0KGgo=",
      isImage: true,
    });
  });
});
