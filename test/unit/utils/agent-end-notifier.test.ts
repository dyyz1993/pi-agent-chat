import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAgentEndNotification,
  buildSessionDeepLink,
  isDrelUserAgent,
  notifyAgentEnd,
  resetAgentEndPushDedupe,
  setAgentEndPushPresenceSource,
  shouldPushAgentEnd,
} from "../../../src/shared/agent/agent-end-notifier";

const ENV_BACKUP = { ...process.env };

describe("agent-end-notifier", () => {
  beforeEach(() => {
    resetAgentEndPushDedupe();
    setAgentEndPushPresenceSource(() => ({ total: 0, drel: 0 }));
    delete process.env.DREL_KEY;
    delete process.env.PUBLIC_PI_CHAT_URL;
    setAgentEndPushPresenceSource(() => 0);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    for (const key of Object.keys(process.env)) {
      if (!(key in ENV_BACKUP)) delete process.env[key];
    }
    for (const [key, value] of Object.entries(ENV_BACKUP)) {
      process.env[key] = value;
    }
  });

  describe("shouldPushAgentEnd gating", () => {
    const base = {
      configured: true,
      enabled: true,
      hasBaseUrl: true,
      aliveClients: 0,
      drelClients: 0,
      presenceSuppress: true,
    };

    it("pushes when all gates pass", () => {
      expect(shouldPushAgentEnd(base)).toEqual({ push: true, reason: "ok" });
    });

    it("skips when DREL_KEY missing", () => {
      expect(shouldPushAgentEnd({ ...base, configured: false }).reason).toBe("drel_not_configured");
    });

    it("skips when public base URL missing", () => {
      expect(shouldPushAgentEnd({ ...base, hasBaseUrl: false }).reason).toBe("no_public_base_url");
    });

    it("skips when user toggle is off", () => {
      expect(shouldPushAgentEnd({ ...base, enabled: false }).reason).toBe("disabled_by_user");
    });

    it("suppresses only on alive Drel clients when suppression is on (default)", () => {
      expect(
        shouldPushAgentEnd({ ...base, aliveClients: 2, drelClients: 1, presenceSuppress: true }),
      ).toEqual({ push: false, reason: "drel_client_online" });
    });

    it("pushes with browser-only clients even when suppression is on", () => {
      expect(
        shouldPushAgentEnd({ ...base, aliveClients: 2, drelClients: 0, presenceSuppress: true }),
      ).toEqual({ push: true, reason: "ok" });
    });

    it("pushes with Drel clients when suppression is off", () => {
      expect(
        shouldPushAgentEnd({ ...base, aliveClients: 1, drelClients: 1, presenceSuppress: false }),
      ).toEqual({ push: true, reason: "ok" });
    });
  });

  describe("buildSessionDeepLink", () => {
    it("strips trailing slash and encodes params", () => {
      const link = buildSessionDeepLink(
        "https://pichat.shanbox.19930810.xyz:8443/",
        "sess abc/1",
        "tok=en",
      );
      expect(link).toBe(
        "https://pichat.shanbox.19930810.xyz:8443/?session=sess%20abc%2F1&token=tok%3Den",
      );
    });
  });

  describe("isDrelUserAgent", () => {
    it("matches Drel container UA token case-insensitively", () => {
      expect(isDrelUserAgent("Mozilla/5.0 iPhone Drel/1.4.0 (build 42)")).toBe(true);
      expect(isDrelUserAgent("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) AppleWebKit drel-container")).toBe(true);
    });

    it("rejects desktop browser UAs", () => {
      expect(
        isDrelUserAgent(
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36",
        ),
      ).toBe(false);
      expect(isDrelUserAgent(undefined)).toBe(false);
      expect(isDrelUserAgent("")).toBe(false);
    });
  });

  describe("buildAgentEndNotification", () => {
    it("uses basename of projectPath and status label", () => {
      const n = buildAgentEndNotification({
        sessionId: "s1",
        projectPath: "/tmp/demo-project",
        outcomeStatus: "completed",
      });
      expect(n.title).toBe("任务完成 · demo-project");
      expect(n.body).toBe("点开查看会话详情");
    });

    it("labels error outcomes", () => {
      const n = buildAgentEndNotification({
        sessionId: "s1",
        projectPath: "/tmp/p",
        outcomeStatus: "error",
      });
      expect(n.title.startsWith("任务出错 · p")).toBe(true);
    });

    it("never exceeds the body limit", () => {
      const n = buildAgentEndNotification({ sessionId: "s1", outcomeStatus: "completed" });
      expect(n.body.length).toBeLessThanOrEqual(200);
    });
  });

  describe("notifyAgentEnd", () => {
    const okSettings = {
      agentEndPushEnabled: true,
      immersiveOpen: true,
      presenceSuppress: true,
    };
    const input = {
      sessionId: "sess-1",
      projectPath: "/tmp/demo",
      outcomeStatus: "completed",
    };

    function mockFetch(response: { status: number; body?: unknown }) {
      const fn = vi.fn().mockResolvedValue({
        status: response.status,
        ok: response.status < 400,
        json: async () => response.body,
      });
      vi.stubGlobal("fetch", fn);
      return fn;
    }

    it("skips without DREL_KEY and never calls fetch", async () => {
      const fn = mockFetch({ status: 200, body: { code: 200, accepted: 1 } });
      const decision = await notifyAgentEnd(input, { getSettings: async () => okSettings });
      expect(decision).toEqual({ push: false, reason: "drel_not_configured" });
      expect(fn).not.toHaveBeenCalled();
    });

    it("skips when user disabled pushes", async () => {
      process.env.DREL_KEY = "k";
      process.env.PUBLIC_PI_CHAT_URL = "https://pichat.example:8443";
      const fn = mockFetch({ status: 200, body: { code: 200, accepted: 1 } });
      const decision = await notifyAgentEnd(input, {
        getSettings: async () => ({ agentEndPushEnabled: false }),
      });
      expect(decision.reason).toBe("disabled_by_user");
      expect(fn).not.toHaveBeenCalled();
    });

    it("skips when a Drel client is online and suppression is on", async () => {
      process.env.DREL_KEY = "k";
      process.env.PUBLIC_PI_CHAT_URL = "https://pichat.example:8443";
      setAgentEndPushPresenceSource(() => ({ total: 2, drel: 1 }));
      const fn = mockFetch({ status: 200, body: { code: 200, accepted: 1 } });
      const decision = await notifyAgentEnd(input, { getSettings: async () => okSettings });
      expect(decision.reason).toBe("drel_client_online");
      expect(fn).not.toHaveBeenCalled();
    });

    it("delivers when only browser clients are online", async () => {
      process.env.DREL_KEY = "k";
      process.env.PUBLIC_PI_CHAT_URL = "https://pichat.example:8443";
      setAgentEndPushPresenceSource(() => ({ total: 2, drel: 0 }));
      const fn = mockFetch({ status: 200, body: { code: 200, attempted: 1, accepted: 1 } });
      const decision = await notifyAgentEnd(input, { getSettings: async () => okSettings });
      expect(decision.push).toBe(true);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it("sends bark-compatible payload with deep link and threadId", async () => {
      process.env.DREL_KEY = "k";
      process.env.PUBLIC_PI_CHAT_URL = "https://pichat.example:8443";
      const fn = mockFetch({ status: 200, body: { code: 200, attempted: 1, accepted: 1 } });
      const decision = await notifyAgentEnd(input, { getSettings: async () => okSettings });
      expect(decision).toEqual({ push: true, reason: "ok" });
      expect(fn).toHaveBeenCalledTimes(1);
      const [url, init] = fn.mock.calls[0] as [string, RequestInit];
      expect(url).toBe("https://api.drel.app/k");
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(payload.title).toBe("任务完成 · demo");
      expect(payload.url).toContain("https://pichat.example:8443/?session=sess-1");
      expect(payload.url).toContain("token=");
      expect(payload.threadId).toBe("sess-1");
      expect(payload.group).toBe("pi-chat");
      expect(payload.isArchive).toBe(1);
      expect(payload.mode).toBe("immersive");
    });

    it("sends normal mode when immersive is disabled", async () => {
      process.env.DREL_KEY = "k";
      process.env.PUBLIC_PI_CHAT_URL = "https://pichat.example:8443";
      const fn = mockFetch({ status: 200, body: { code: 200, attempted: 1, accepted: 1 } });
      const decision = await notifyAgentEnd(input, {
        getSettings: async () => ({ agentEndPushEnabled: true, immersiveOpen: false }),
      });
      expect(decision).toEqual({ push: true, reason: "ok" });
      const payload = JSON.parse(String(fn.mock.calls[0][1].body)) as Record<string, unknown>;
      expect(payload.mode).toBe("normal");
    });

    it("logs mode immersive in delivery when enabled", async () => {
      process.env.DREL_KEY = "k";
      process.env.PUBLIC_PI_CHAT_URL = "https://pichat.example:8443";
      const fn = mockFetch({ status: 200, body: { code: 200, attempted: 1, accepted: 1 } });
      await notifyAgentEnd(input, { getSettings: async () => okSettings });
      expect(fn).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(fn.mock.calls[0][1].body)) as Record<string, unknown>;
      expect(payload.mode).toBe("immersive");
    });

    it("treats relay rejection as failure", async () => {
      process.env.DREL_KEY = "k";
      process.env.PUBLIC_PI_CHAT_URL = "https://pichat.example:8443";
      mockFetch({ status: 200, body: { code: 400, accepted: 0 } });
      const decision = await notifyAgentEnd(input, { getSettings: async () => okSettings });
      expect(decision).toEqual({ push: false, reason: "relay_rejected" });
    });

    it("maps http errors to failure reason", async () => {
      process.env.DREL_KEY = "k";
      process.env.PUBLIC_PI_CHAT_URL = "https://pichat.example:8443";
      mockFetch({ status: 429, body: { error: { message: "rate limited" } } });
      const decision = await notifyAgentEnd(input, { getSettings: async () => okSettings });
      expect(decision).toEqual({ push: false, reason: "http_429" });
    });

    it("dedupes repeated deliveries for the same session", async () => {
      process.env.DREL_KEY = "k";
      process.env.PUBLIC_PI_CHAT_URL = "https://pichat.example:8443";
      const fn = mockFetch({ status: 200, body: { code: 200, attempted: 1, accepted: 1 } });
      const first = await notifyAgentEnd(input, { getSettings: async () => okSettings });
      const second = await notifyAgentEnd(input, { getSettings: async () => okSettings });
      expect(first.push).toBe(true);
      expect(second).toEqual({ push: false, reason: "duplicate" });
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });
});
