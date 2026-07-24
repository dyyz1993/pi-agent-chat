import { waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAttachmentStore } from "../../../src/mainview/stores/use-attachment-store";

const apiClientCallMock = vi.hoisted(() => vi.fn(async () => ({ text: "" })));

vi.mock("../../../src/mainview/lib/api-client", () => ({
  apiClient: {
    call: apiClientCallMock,
  },
}));

import {
  installDesktopEditCommandBridge,
  replaceTextRange,
} from "../../../src/mainview/lib/desktop-edit-commands";

describe("replaceTextRange", () => {
  it("replaces the selected range and returns the next caret position", () => {
    expect(replaceTextRange("hello world", 6, 11, "pi")).toEqual({
      value: "hello pi",
      caret: 8,
    });
  });

  it("inserts text when the selection is collapsed", () => {
    expect(replaceTextRange("hello", 5, 5, " world")).toEqual({
      value: "hello world",
      caret: 11,
    });
  });

  it("clamps invalid ranges", () => {
    expect(replaceTextRange("hello", -4, 99, "x")).toEqual({
      value: "x",
      caret: 1,
    });
  });
});

describe("desktop edit command bridge", () => {
  beforeEach(() => {
    useAttachmentStore.getState().clearAll();
    apiClientCallMock.mockReset();
    apiClientCallMock.mockResolvedValue({ text: "" });
  });

  it("lets active text controls keep native Command+A handling", () => {
    installDesktopEditCommandBridge();
    const textarea = document.createElement("textarea");
    textarea.value = "select this draft";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(6, 6);

    const event = new KeyboardEvent("keydown", {
        key: "a",
        metaKey: true,
        bubbles: true,
        cancelable: true,
    });
    textarea.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
    expect(textarea.selectionStart).toBe(6);
    expect(textarea.selectionEnd).toBe(6);

    textarea.remove();
  });

  it("routes Command+V through the desktop paste bridge even inside active text controls", async () => {
    installDesktopEditCommandBridge();
    apiClientCallMock
      .mockResolvedValueOnce({ pngBase64: null })
      .mockResolvedValueOnce({ text: " desktop" });

    const textarea = document.createElement("textarea");
    textarea.value = "hello";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.setSelectionRange(5, 5);

    const event = new KeyboardEvent("keydown", {
      key: "v",
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);

    await waitFor(() => {
      expect(textarea.value).toBe("hello desktop");
      expect(apiClientCallMock).toHaveBeenCalledWith("system.readClipboardImage", {});
      expect(apiClientCallMock).toHaveBeenCalledWith("system.readClipboard", {});
    });

    textarea.remove();
  });

  it("pastes a desktop clipboard image as an attachment", async () => {
    installDesktopEditCommandBridge();
    await window.__piAgentDesktopEditCommand?.("paste", { imageBase64: "iVBORw0KGgo=" });

    await waitFor(() => {
      const attachments = useAttachmentStore.getState().attachments;
      expect(attachments).toHaveLength(1);
      expect(attachments[0]).toMatchObject({
        name: "clipboard-image.png",
        type: "image/png",
        status: "pending",
      });
    });
  });
});
