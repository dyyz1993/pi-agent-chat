import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn().mockResolvedValue(undefined),
    getBaseUrl: vi.fn().mockReturnValue("http://localhost:3000"),
    getAuthToken: vi.fn().mockReturnValue("test-token"),
  },
}));

import { uploadEntriesWeb, importFilesDesktop } from "../../../src/mainview/utils/drop-handler";
import type { DropEntry } from "../../../src/mainview/utils/drop-handler";
import { apiClient } from "../../../src/mainview/lib/api-client";

const mockCall = vi.mocked(apiClient.call);
const mockGetBaseUrl = vi.mocked(apiClient.getBaseUrl);
const mockGetAuthToken = vi.mocked(apiClient.getAuthToken);

beforeEach(() => {
  vi.clearAllMocks();
  mockCall.mockResolvedValue(undefined);
  mockGetBaseUrl.mockReturnValue("http://localhost:3000");
  mockGetAuthToken.mockReturnValue("test-token");
});

describe("uploadEntriesWeb", () => {
  it("returns 0 for empty entries", async () => {
    expect(await uploadEntriesWeb([], "/dest")).toBe(0);
  });

  it("uploads files and creates directories", async () => {
    const fileContent = new Uint8Array([1, 2, 3]);
    const mockFile = { arrayBuffer: vi.fn().mockResolvedValue(fileContent.buffer) };
    const dirEntry: DropEntry = {
      name: "folder",
      relativePath: "folder",
      isDirectory: true,
      children: [
        {
          name: "a.txt",
          relativePath: "folder/a.txt",
          file: mockFile as unknown as File,
          isDirectory: false,
        },
      ],
    };

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const count = await uploadEntriesWeb([dirEntry], "/dest");
    expect(count).toBe(2);
    expect(mockCall).toHaveBeenCalledWith("file.createDir", {
      dirPath: "/dest",
      name: "folder",
    });
    expect(mockFetch).toHaveBeenCalled();
  });
});

describe("importFilesDesktop", () => {
  it("returns 0 for empty entries", async () => {
    expect(await importFilesDesktop([], "/dest")).toBe(0);
  });

  it("calls file.copy for files with path property", async () => {
    const mockFile = Object.assign(new Blob(["hi"]), { path: "/tmp/a.txt" });
    const entry: DropEntry = {
      name: "a.txt",
      relativePath: "a.txt",
      file: mockFile as unknown as File,
      isDirectory: false,
    };

    const count = await importFilesDesktop([entry], "/dest");
    expect(count).toBe(1);
    expect(mockCall).toHaveBeenCalledWith("file.copy", {
      srcPath: "/tmp/a.txt",
      destDir: "/dest",
    });
  });

  it("falls back to HTTP upload when no path property", async () => {
    const fileContent = new Uint8Array([1, 2, 3]);
    const mockFile = Object.assign(new Blob(["hi"]), {
      arrayBuffer: vi.fn().mockResolvedValue(fileContent.buffer),
    });
    const entry: DropEntry = {
      name: "b.txt",
      relativePath: "b.txt",
      file: mockFile as unknown as File,
      isDirectory: false,
    };

    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", mockFetch);

    const count = await importFilesDesktop([entry], "/dest");
    expect(count).toBe(1);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:3000/file/upload?path=%2Fdest%2Fb.txt&token=test-token",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
