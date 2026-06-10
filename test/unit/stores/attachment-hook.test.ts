import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: vi.fn(),
    getBaseUrl: vi.fn(() => "http://localhost:3100"),
    getAuthToken: vi.fn(() => "test-token"),
    getTransport: vi.fn(() => "websocket"),
  },
}));

import { useAttachmentStore } from "../../../src/mainview/stores/use-attachment-store";
import { apiClient } from "../../../src/mainview/lib/api-client";

const mockCall = apiClient.call as ReturnType<typeof vi.fn>;
const mockGetBaseUrl = apiClient.getBaseUrl as ReturnType<typeof vi.fn>;
const mockGetAuthToken = apiClient.getAuthToken as ReturnType<typeof vi.fn>;
const mockGetTransport = apiClient.getTransport as ReturnType<typeof vi.fn>;

beforeEach(() => {
  mockCall.mockReset();
  mockGetBaseUrl.mockClear();
  mockGetAuthToken.mockClear();
  mockGetTransport.mockClear();
  useAttachmentStore.setState({ attachments: [] });
});

function createMockFile(name: string, size: number, type: string): File {
  const blob = new Blob(["x".repeat(size)], { type });
  return new File([blob], name, { type });
}

describe("useAttachmentStore", () => {
  it("initial state: attachments=[]", () => {
    expect(useAttachmentStore.getState().attachments).toEqual([]);
  });

  it("addFiles adds attachments", async () => {
    const file = createMockFile("test.txt", 100, "text/plain");
    await useAttachmentStore.getState().addFiles([file]);
    const atts = useAttachmentStore.getState().attachments;
    expect(atts).toHaveLength(1);
    expect(atts[0].name).toBe("test.txt");
    expect(atts[0].status).toBe("pending");
  });

  it("removeFile deletes the attachment by id", async () => {
    const file = createMockFile("a.txt", 10, "text/plain");
    await useAttachmentStore.getState().addFiles([file]);
    const id = useAttachmentStore.getState().attachments[0].id;
    useAttachmentStore.getState().removeFile(id);
    expect(useAttachmentStore.getState().attachments).toHaveLength(0);
  });

  it("clearAll resets attachments to []", async () => {
    const file = createMockFile("b.txt", 10, "text/plain");
    await useAttachmentStore.getState().addFiles([file]);
    useAttachmentStore.getState().clearAll();
    expect(useAttachmentStore.getState().attachments).toEqual([]);
  });

  it("multiple addFiles accumulate", async () => {
    await useAttachmentStore.getState().addFiles([createMockFile("a.txt", 10, "text/plain")]);
    await useAttachmentStore.getState().addFiles([createMockFile("b.txt", 20, "text/plain")]);
    expect(useAttachmentStore.getState().attachments).toHaveLength(2);
  });

  it("removeFile with non-existent id does not throw", async () => {
    await useAttachmentStore.getState().addFiles([createMockFile("c.txt", 10, "text/plain")]);
    expect(() => useAttachmentStore.getState().removeFile("nonexistent")).not.toThrow();
    expect(useAttachmentStore.getState().attachments).toHaveLength(1);
  });
});
