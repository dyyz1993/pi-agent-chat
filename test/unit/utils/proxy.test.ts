import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

import {
  isLocalAddress,
  isProxyEnabled,
  getProxyStatus,
  enableProxy,
  disableProxy,
  refreshProxyStatus,
  tryEnable,
  proxyUrlSync,
  checkProxyUrl,
} from "../../../src/mainview/lib/proxy";

describe("proxy module", () => {
  beforeEach(() => {
    disableProxy();
    localStorage.clear();
    mockFetch.mockReset();
  });

  describe("isLocalAddress", () => {
    it("detects localhost", () => {
      expect(isLocalAddress("localhost")).toBe(true);
    });

    it("detects 127.0.0.1", () => {
      expect(isLocalAddress("127.0.0.1")).toBe(true);
    });

    it("detects ::1", () => {
      expect(isLocalAddress("::1")).toBe(true);
    });

    it("detects 192.168.x.x", () => {
      expect(isLocalAddress("192.168.0.4")).toBe(true);
      expect(isLocalAddress("192.168.1.255")).toBe(true);
    });

    it("detects 10.x.x.x", () => {
      expect(isLocalAddress("10.0.0.1")).toBe(true);
    });

    it("detects 172.16-31.x.x", () => {
      expect(isLocalAddress("172.16.0.1")).toBe(true);
      expect(isLocalAddress("172.31.255.255")).toBe(true);
    });

    it("rejects 172.32.x.x (not private)", () => {
      expect(isLocalAddress("172.32.0.1")).toBe(false);
    });

    it("rejects public IPs", () => {
      expect(isLocalAddress("8.8.8.8")).toBe(false);
      expect(isLocalAddress("1.2.3.4")).toBe(false);
    });

    it("rejects empty", () => {
      expect(isLocalAddress("")).toBe(false);
    });
  });

  describe("isProxyEnabled / enableProxy / disableProxy", () => {
    it("starts disabled", () => {
      expect(isProxyEnabled()).toBe(false);
    });

    it("enableProxy activates proxy", () => {
      enableProxy();
      expect(isProxyEnabled()).toBe(true);
      expect(getProxyStatus().preferred).toBe(true);
      expect(localStorage.getItem("pi-local-proxy-enabled")).toBe("true");
    });

    it("disableProxy deactivates proxy", () => {
      enableProxy();
      disableProxy();
      expect(isProxyEnabled()).toBe(false);
      expect(getProxyStatus().preferred).toBe(false);
      expect(localStorage.getItem("pi-local-proxy-enabled")).toBeNull();
    });
  });

  describe("refreshProxyStatus", () => {
    it("keeps proxy active when preference is enabled and server is configured", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configured: true }),
      });

      const status = await refreshProxyStatus();

      expect(status.preferred).toBe(true);
      expect(status.configured).toBe(true);
      expect(status.active).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith("/api/proxy-status", { method: "GET" });
    });

    it("disables active proxy when server is not configured but keeps user preference", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configured: false }),
      });

      const status = await refreshProxyStatus();

      expect(status.preferred).toBe(true);
      expect(status.configured).toBe(false);
      expect(status.active).toBe(false);
      expect(localStorage.getItem("pi-local-proxy-enabled")).toBe("true");
    });
  });

  describe("proxyUrlSync", () => {
    it("returns original URL when proxy disabled", () => {
      expect(proxyUrlSync("http://192.168.0.4:3100/api")).toBe("http://192.168.0.4:3100/api");
    });

    it("returns original URL for https URLs", () => {
      enableProxy();
      expect(proxyUrlSync("https://example.com/path")).toBe("https://example.com/path");
    });

    it("returns original URL for file:// URLs", () => {
      enableProxy();
      expect(proxyUrlSync("file:///Users/test/file.txt")).toBe("file:///Users/test/file.txt");
    });

    it("returns original URL for public http URLs", () => {
      enableProxy();
      expect(proxyUrlSync("http://example.com/path")).toBe("http://example.com/path");
    });

    it("converts localhost http URL to /__proxy__/ path", () => {
      enableProxy();
      expect(proxyUrlSync("http://localhost:8080/index.html")).toBe(
        "/__proxy__/localhost:8080/index.html",
      );
    });

    it("converts 127.0.0.1 http URL to /__proxy__/ path", () => {
      enableProxy();
      expect(proxyUrlSync("http://127.0.0.1:3000/api/test")).toBe(
        "/__proxy__/127.0.0.1:3000/api/test",
      );
    });

    it("converts LAN IP http URL to /__proxy__/ path", () => {
      enableProxy();
      expect(proxyUrlSync("http://192.168.0.4:3100/health")).toBe(
        "/__proxy__/192.168.0.4:3100/health",
      );
    });

    it("preserves query string", () => {
      enableProxy();
      expect(proxyUrlSync("http://localhost:8080/page?q=1&r=2")).toBe(
        "/__proxy__/localhost:8080/page?q=1&r=2",
      );
    });

    it("preserves hash fragment", () => {
      enableProxy();
      expect(proxyUrlSync("http://localhost:8080/page#section")).toBe(
        "/__proxy__/localhost:8080/page#section",
      );
    });

    it("preserves query + hash together", () => {
      enableProxy();
      expect(proxyUrlSync("http://localhost:8080/page?q=1&r=2#section")).toBe(
        "/__proxy__/localhost:8080/page?q=1&r=2#section",
      );
    });

    it("preserves path without trailing slash", () => {
      enableProxy();
      expect(proxyUrlSync("http://192.168.1.100:9000")).toBe("/__proxy__/192.168.1.100:9000/");
    });

    it("returns original URL for invalid input", () => {
      enableProxy();
      expect(proxyUrlSync("not-a-url")).toBe("not-a-url");
    });
  });

  describe("checkProxyUrl", () => {
    it("returns original URL when proxy disabled", async () => {
      const result = await checkProxyUrl("http://localhost:8080/test");
      expect(result.url).toBe("http://localhost:8080/test");
      expect(result.error).toBeUndefined();
    });

    it("returns original URL for non-local addresses", async () => {
      enableProxy();
      const result = await checkProxyUrl("https://example.com/path");
      expect(result.url).toBe("https://example.com/path");
      expect(result.error).toBeUndefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns /__proxy__/ path when target is reachable", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ reachable: true }),
      });

      const result = await checkProxyUrl("http://localhost:8080/index.html");
      expect(result.url).toBe("/__proxy__/localhost:8080/index.html");
      expect(result.error).toBeUndefined();
      expect(mockFetch).toHaveBeenCalledWith(
        "/api/proxy-check",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ host: "localhost", port: 8080 }),
        }),
      );
    });

    it("returns error when target is not reachable", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ reachable: false }),
      });

      const result = await checkProxyUrl("http://localhost:8080/index.html");
      expect(result.url).toBe("http://localhost:8080/index.html");
      expect(result.error).toContain("127.0.0.1");
    });

    it("returns original URL on network error", async () => {
      enableProxy();
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const result = await checkProxyUrl("http://localhost:8080/test");
      expect(result.url).toBe("http://localhost:8080/test");
      expect(result.error).toBeUndefined();
    });
  });

  describe("tryEnable", () => {
    it("enables proxy on successful registration", async () => {
      enableProxy();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ configured: true }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ publicUrl: "https://abc.shanbox.xyz:8443" }),
        });

      await tryEnable("192.168.0.4:3100");
      expect(isProxyEnabled()).toBe(true);
    });

    it("disables proxy on failed registration", async () => {
      enableProxy();
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ configured: true }),
        })
        .mockResolvedValueOnce({ ok: false, status: 502 });

      await tryEnable("192.168.0.4:3100");
      expect(isProxyEnabled()).toBe(false);
    });

    it("disables proxy on empty host", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configured: true }),
      });

      await tryEnable("");
      expect(isProxyEnabled()).toBe(false);
      expect(mockFetch).toHaveBeenCalledWith("/api/proxy-status", { method: "GET" });
    });

    it("disables proxy on network error", async () => {
      enableProxy();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configured: true }),
      });
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await tryEnable("192.168.0.4:3100");
      expect(isProxyEnabled()).toBe(false);
    });

    it("does not register when user preference is disabled", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ configured: true }),
      });

      await tryEnable("192.168.0.4:3100");

      expect(isProxyEnabled()).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith("/api/proxy-status", { method: "GET" });
    });
  });
});
