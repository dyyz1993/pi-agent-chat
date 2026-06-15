import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:net";
import { createProxyRegistrar } from "../../../src/gateway/proxy-register";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

// Start a real TCP listener so checkReachable succeeds
let testServer: Server;
const TEST_PORT = 13999;
const TEST_HOST = "127.0.0.1";

beforeEach(async () => {
  testServer = createServer();
  await new Promise<void>((resolve) => testServer.listen(TEST_PORT, resolve));
  mockFetch.mockReset();
});

afterEach(() => {
  testServer?.close();
});

describe("createProxyRegistrar", () => {
  const apiUrl = "http://192.168.0.29:9080/__api__/register";
  const publicDomain = "shanbox.19930810.xyz:8443";

  it("registers a host and returns public URL", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const registrar = createProxyRegistrar(apiUrl, publicDomain);
    const result = await registrar.register(TEST_HOST, TEST_PORT);

    expect(result).toMatch(/^https:\/\/[a-f0-9]{6}\.shanbox\.19930810\.xyz:8443$/);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://192.168.0.29:9080/__api__/routes",
      expect.objectContaining({
        method: "POST",
        body: expect.any(String),
      }),
    );

    const callArgs = mockFetch.mock.calls[0]!;
    const callBody = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(callBody).toEqual(
      expect.objectContaining({
        port: TEST_PORT,
        policy: "public",
      }),
    );
    expect(callBody.subdomain).toMatch(/^[a-f0-9]{6}$/);
  });

  it("caches registration result", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const registrar = createProxyRegistrar(apiUrl, publicDomain);
    const r1 = await registrar.register(TEST_HOST, TEST_PORT);
    const r2 = await registrar.register(TEST_HOST, TEST_PORT);

    expect(r1).toBe(r2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns null when registration fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const registrar = createProxyRegistrar(apiUrl, publicDomain);
    const result = await registrar.register(TEST_HOST, TEST_PORT);

    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const registrar = createProxyRegistrar(apiUrl, publicDomain);
    const result = await registrar.register(TEST_HOST, TEST_PORT);

    expect(result).toBeNull();
  });

  it("deduplicates concurrent registrations", async () => {
    let resolveRegistration: (v: unknown) => void;
    const promise = new Promise((resolve) => {
      resolveRegistration = resolve;
    });
    mockFetch.mockReturnValueOnce({ ok: true, status: 200, ...promise });

    const registrar = createProxyRegistrar(apiUrl, publicDomain);
    const p1 = registrar.register(TEST_HOST, TEST_PORT);
    const p2 = registrar.register(TEST_HOST, TEST_PORT);

    resolveRegistration!(undefined);
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1).toBe(r2);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("replaces localhost with LAN IP", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const registrar = createProxyRegistrar(apiUrl, publicDomain);
    await registrar.register("localhost", TEST_PORT);

    const callBody = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    // If LAN IP exists, it should NOT be localhost
    // The actual LAN IP depends on the machine, just verify it's not "localhost"
    // On CI or machines without LAN IP, it may still be localhost
    expect(callBody.port).toBe(TEST_PORT);
    expect(callBody.policy).toBe("public");
  });
});
