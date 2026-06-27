import { describe, it, expect, vi, beforeEach } from "vitest";
import { apiClient } from "../../../src/mainview/lib/api-client";
import { copyToClipboard } from "../../../src/mainview/utils/clipboard";

describe("copyToClipboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete window.__electrobunBunBridge;
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
    Object.defineProperty(window, "isSecureContext", {
      value: true,
      writable: true,
      configurable: true,
    });
    document.execCommand = vi.fn().mockReturnValue(true);
  });

  it("uses clipboard.writeText when available and returns true", async () => {
    const result = await copyToClipboard("hello");
    expect(result).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("hello");
  });

  it("falls back to execCommand when clipboard.writeText throws", async () => {
    (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("denied"),
    );

    const result = await copyToClipboard("hello");
    expect(result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("falls back when navigator.clipboard is unavailable", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      writable: true,
      configurable: true,
    });

    const result = await copyToClipboard("hello");
    expect(result).toBe(true);
    expect(document.execCommand).toHaveBeenCalledWith("copy");
  });

  it("handles normal text copy correctly", async () => {
    const result = await copyToClipboard("normal text with symbols: !@#$%");
    expect(result).toBe(true);
  });

  it("handles empty string", async () => {
    const result = await copyToClipboard("");
    expect(result).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("");
  });

  it("uses desktop native clipboard when running inside Electrobun", async () => {
    window.__electrobunBunBridge = { postMessage: vi.fn() };
    vi.mocked(apiClient.call).mockResolvedValue({ ok: true });

    const result = await copyToClipboard("desktop text");

    expect(result).toBe(true);
    expect(apiClient.call).toHaveBeenCalledWith("system.writeClipboard", { text: "desktop text" });
    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(document.execCommand).not.toHaveBeenCalled();
  });

  it("falls back to the web clipboard when desktop native clipboard fails", async () => {
    window.__electrobunBunBridge = { postMessage: vi.fn() };
    vi.mocked(apiClient.call).mockRejectedValue(new Error("native denied"));

    const result = await copyToClipboard("fallback text");

    expect(result).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith("fallback text");
  });
});
