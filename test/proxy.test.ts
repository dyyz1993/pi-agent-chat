import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch before importing the module
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import {
  isProxyEnabled,
  enableProxy,
  disableProxy,
  tryEnable,
  proxyUrlSync,
  proxyUrl,
  warmupProxyCache,
} from "../src/mainview/lib/proxy";

describe("proxy module", () => {
  beforeEach(() => {
    disableProxy();
    mockFetch.mockReset();
  });

  describe("isProxyEnabled / enableProxy / disableProxy", () => {
    it("starts disabled", () => {
      expect(isProxyEnabled()).toBe(false);
    });

    it("enableProxy activates proxy", () => {
      enableProxy();
      expect(isProxyEnabled()).toBe(true);
    });

    it("disableProxy deactivates proxy and clears cache", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ publicUrl: "https://abc.shanbox.xyz:8443" }),
      });
      await proxyUrl("http://192.168.0.4:3100/test");
      expect(isProxyEnabled()).toBe(true);

      disableProxy();
      expect(isProxyEnabled()).toBe(false);
    });
  });

  describe("proxyUrlSync", () => {
    it("returns original URL when proxy disabled", () => {
      const url = "http://192.168.0.4:3100/api/health";
      expect(proxyUrlSync(url)).toBe(url);
    });

    it("returns original URL for https URLs", () => {
      enableProxy();
      const url = "https://example.com/path";
      expect(proxyUrlSync(url)).toBe(url);
    });

    it("returns original URL for file:// URLs", () => {
      enableProxy();
      const url = "file:///Users/test/file.txt";
      expect(proxyUrlSync(url)).toBe(url);
    });

    it("returns original URL when host not in cache", () => {
      enableProxy();
      const url = "http://192.168.0.4:3100/api/health";
      expect(proxyUrlSync(url)).toBe(url);
    });

    it("transforms URL when host is in cache", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ publicUrl: "https://abc.shanbox.xyz:8443" }),
      });
      // First, populate cache via async proxyUrl
      await proxyUrl("http://192.168.0.4:3100/test");

      // Now sync should work
      const result = proxyUrlSync("http://192.168.0.4:3100/api/health");
      expect(result).toBe("https://abc.shanbox.xyz:8443/api/health");
    });

    it("returns original URL for invalid URLs", () => {
      enableProxy();
      expect(proxyUrlSync("not-a-url")).toBe("not-a-url");
    });
  });

  describe("proxyUrl (async)", () => {
    it("returns original URL when proxy disabled", async () => {
      const url = "http://192.168.0.4:3100/test";
      const result = await proxyUrl(url);
      expect(result).toBe(url);
    });

    it("returns original URL for https URLs", async () => {
      enableProxy();
      const url = "https://example.com/path";
      const result = await proxyUrl(url);
      expect(result).toBe(url);
    });

    it("registers host and returns proxied URL", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ publicUrl: "https://abc123.shanbox.xyz:8443" }),
      });

      const result = await proxyUrl("http://192.168.0.4:3100/api/test?q=1");
      expect(result).toBe("https://abc123.shanbox.xyz:8443/api/test?q=1");
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/proxy-register",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ host: "192.168.0.4", port: 3100 }),
        }),
      );
    });

    it("caches result for subsequent calls", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ publicUrl: "https://abc.shanbox.xyz:8443" }),
      });

      await proxyUrl("http://192.168.0.4:3100/first");
      const result = await proxyUrl("http://192.168.0.4:3100/second");

      // fetch should only be called once (second hits cache)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(result).toBe("https://abc.shanbox.xyz:8443/second");
    });

    it("returns original URL when registration fails", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });

      const url = "http://192.168.0.4:3100/test";
      const result = await proxyUrl(url);
      expect(result).toBe(url);
    });

    it("returns original URL when fetch throws", async () => {
      enableProxy();
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const url = "http://192.168.0.4:3100/test";
      const result = await proxyUrl(url);
      expect(result).toBe(url);
    });

    it("deduplicates concurrent registrations", async () => {
      enableProxy();
      let resolveRegistration: (v: unknown) => void;
      const registrationPromise = new Promise((resolve) => {
        resolveRegistration = resolve;
      });
      mockFetch.mockReturnValueOnce({
        ok: true,
        json: () => registrationPromise.then(() => ({ publicUrl: "https://abc.shanbox.xyz:8443" })),
      });

      const p1 = proxyUrl("http://192.168.0.4:3100/a");
      const p2 = proxyUrl("http://192.168.0.4:3100/b");

      resolveRegistration!(undefined);

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe("https://abc.shanbox.xyz:8443/a");
      expect(r2).toBe("https://abc.shanbox.xyz:8443/b");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("tryEnable", () => {
    it("enables proxy on successful registration", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ publicUrl: "https://abc.shanbox.xyz:8443" }),
      });

      await tryEnable("192.168.0.4:3100");
      expect(isProxyEnabled()).toBe(true);
    });

    it("disables proxy on failed registration", async () => {
      mockFetch.mockResolvedValueOnce({ ok: false, status: 502 });

      await tryEnable("192.168.0.4:3100");
      expect(isProxyEnabled()).toBe(false);
    });

    it("disables proxy on empty host", async () => {
      await tryEnable("");
      expect(isProxyEnabled()).toBe(false);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("warmupProxyCache", () => {
    it("does nothing when proxy disabled", async () => {
      await warmupProxyCache(["192.168.0.4:3100"]);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("registers all hosts when enabled", async () => {
      enableProxy();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ publicUrl: "https://a1.shanbox.xyz:8443" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ publicUrl: "https://b2.shanbox.xyz:8443" }),
        });

      await warmupProxyCache(["192.168.0.4:3100", "192.168.0.5:8080"]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });
});
