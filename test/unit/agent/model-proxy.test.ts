/**
 * @vitest-environment node
 */
import { createServer, type Server } from "node:http";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createModelProxyServer, buildRemoteModelProxyEnv } from "../../../src/shared/agent/model-proxy";

const servers: Server[] = [];

function listen(server: Server): Promise<number> {
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("server did not bind to a TCP port"));
        return;
      }
      resolve(address.port);
    });
  });
}

const model = {
  id: "model-a",
  name: "Model A",
  api: "openai-responses",
  provider: "provider-a",
  baseUrl: "http://upstream.invalid/v1",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128000,
  maxTokens: 4096,
};

describe("model proxy", () => {
  afterEach(async () => {
    await Promise.all(
      servers.splice(0).map(
        (server) =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      ),
    );
  });

  it("injects local auth and strips proxy headers before forwarding", async () => {
    const upstreamRequests: Array<{
      authorization?: string | null;
      proxyToken?: string | null;
      url?: string;
      userAgent?: string | null;
      acceptEncoding?: string | null;
    }> = [];
    const upstream = createServer((req, res) => {
      upstreamRequests.push({
        authorization: req.headers.authorization,
        proxyToken: req.headers["x-pi-model-proxy-token"] as string | undefined,
        url: req.url,
        userAgent: req.headers["user-agent"] ?? null,
        acceptEncoding: req.headers["accept-encoding"] ?? null,
      });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    const upstreamPort = await listen(upstream);
    const upstreamBaseUrl = `http://127.0.0.1:${upstreamPort}/v1`;
    const registry = {
      getAvailable: vi.fn(() => [{ ...model, baseUrl: upstreamBaseUrl }]),
      getAll: vi.fn(() => [{ ...model, baseUrl: upstreamBaseUrl }]),
      getApiKeyAndHeaders: vi.fn(async () => ({
        ok: true,
        apiKey: "real-local-key",
        headers: { "x-extra-auth": "local" },
      })),
    };
    const proxy = createModelProxyServer({ token: "session-token", registry });
    const proxyPort = await listen(proxy);
    const encodedBaseUrl = Buffer.from(upstreamBaseUrl, "utf8").toString("base64url");

    const response = await fetch(`http://127.0.0.1:${proxyPort}/proxy/${encodedBaseUrl}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "accept-encoding": "identity",
        authorization: "Bearer pi-model-proxy-placeholder",
        "user-agent": "remote-test-client",
        "x-pi-model-proxy-token": "session-token",
        "x-pi-model-proxy-provider": "provider-a",
        "x-pi-model-proxy-model": "model-a",
        "x-pi-model-proxy-api": "openai-responses",
      },
      body: JSON.stringify({ model: "model-a" }),
    });

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(upstreamRequests).toEqual([
      {
        authorization: "Bearer real-local-key",
        proxyToken: undefined,
        url: "/v1/responses",
        userAgent: upstreamRequests[0]?.userAgent,
        acceptEncoding: upstreamRequests[0]?.acceptEncoding,
      },
    ]);
    expect(upstreamRequests[0]?.userAgent).not.toBe("remote-test-client");
    expect(upstreamRequests[0]?.acceptEncoding).not.toBe("identity");
  });

  it("strips upstream compression headers after fetch decodes the response body", async () => {
    const payload = JSON.stringify({ ok: true });
    const compressed = gzipSync(payload);
    const upstream = createServer((_req, res) => {
      res.writeHead(200, {
        "content-type": "application/json",
        "content-encoding": "gzip",
        "content-length": String(compressed.byteLength),
      });
      res.end(compressed);
    });
    const upstreamPort = await listen(upstream);
    const upstreamBaseUrl = `http://127.0.0.1:${upstreamPort}/v1`;
    const registry = {
      getAvailable: vi.fn(() => [{ ...model, baseUrl: upstreamBaseUrl }]),
      getAll: vi.fn(() => [{ ...model, baseUrl: upstreamBaseUrl }]),
      getApiKeyAndHeaders: vi.fn(async () => ({
        ok: true,
        apiKey: "real-local-key",
      })),
    };
    const proxy = createModelProxyServer({ token: "session-token", registry });
    const proxyPort = await listen(proxy);
    const encodedBaseUrl = Buffer.from(upstreamBaseUrl, "utf8").toString("base64url");

    const response = await fetch(`http://127.0.0.1:${proxyPort}/proxy/${encodedBaseUrl}/responses`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-pi-model-proxy-token": "session-token",
        "x-pi-model-proxy-provider": "provider-a",
        "x-pi-model-proxy-model": "model-a",
        "x-pi-model-proxy-api": "openai-responses",
      },
      body: JSON.stringify({ model: "model-a" }),
    });

    expect(response.headers.get("content-encoding")).toBeNull();
    expect(response.headers.get("content-length")).toBeNull();
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("builds remote env without auth material", () => {
    const env = buildRemoteModelProxyEnv({
      remoteUrl: "http://127.0.0.1:42000",
      token: "session-token",
      models: [{ ...model, baseUrl: "https://api.example.test/v1" }],
    });

    expect(env.PI_MODEL_PROXY_URL).toBe("http://127.0.0.1:42000");
    expect(env.PI_MODEL_PROXY_TOKEN).toBe("session-token");
    expect(env.PI_MODEL_PROXY_MODELS_JSON).toContain("https://api.example.test/v1");
    expect(env.PI_MODEL_PROXY_MODELS_JSON).not.toContain("real-local-key");
  });

  it("marks opencode-go models as not supporting developer role for remote runtimes", () => {
    const env = buildRemoteModelProxyEnv({
      remoteUrl: "http://127.0.0.1:42000",
      token: "session-token",
      models: [
        {
          ...model,
          id: "deepseek-v4-flash",
          provider: "opencode-go",
          api: "openai-completions",
          baseUrl: "https://opencode.ai/zen/go/v1",
          reasoning: true,
          compat: {
            requiresReasoningContentOnAssistantMessages: true,
            thinkingFormat: "deepseek",
          },
        },
      ],
    });

    const parsed = JSON.parse(env.PI_MODEL_PROXY_MODELS_JSON) as Array<{
      compat?: { supportsDeveloperRole?: boolean };
    }>;
    expect(parsed[0]?.compat?.supportsDeveloperRole).toBe(false);
  });
});
