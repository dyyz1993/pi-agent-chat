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
    // shanbox manage-route style: registers in place at /__api__/register with
    // an {address, policy} payload, and pins the Host header to the public
    // domain (with the API port) because the LAN endpoint drops unknown vhosts.
    expect(mockFetch).toHaveBeenCalledWith(
      "http://192.168.0.29:9080/__api__/register",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Host: "shanbox.19930810.xyz:8443" }),
        body: expect.any(String),
      }),
    );

    const callArgs = mockFetch.mock.calls[0]!;
    const callBody = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(callBody).toEqual({
      address: `${TEST_HOST}:${TEST_PORT}`,
      policy: "public",
    });
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

  it("rewrites localhost to LAN IP for reachability, keeps target host in payload", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const registrar = createProxyRegistrar(apiUrl, publicDomain);
    const result = await registrar.register("localhost", TEST_PORT);

    // The test server binds all interfaces, so the LAN IP path is reachable and
    // registration proceeds. The shanbox payload passes the target host through
    // unchanged; the LAN IP only substitutes into the reachability probe.
    expect(result).toMatch(/^https:\/\/[a-f0-9]{6}\.shanbox\.19930810\.xyz:8443$/);
    const callBody = JSON.parse((mockFetch.mock.calls[0]![1] as RequestInit).body as string);
    expect(callBody).toEqual({
      address: `localhost:${TEST_PORT}`,
      policy: "public",
    });
  });

  it("replaces localhost with LAN IP for non-shanbox registrars", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const registrar = createProxyRegistrar(
      "http://proxy.internal:9080/register",
      "tunnel.example.com",
    );
    const result = await registrar.register(TEST_HOST, TEST_PORT);

    expect(result).toMatch(/^https:\/\/[a-f0-9]{6}\.tunnel\.example\.com$/);
    const callArgs = mockFetch.mock.calls[0]!;
    expect(callArgs[0]).toBe("http://proxy.internal:9080/register");
    expect((callArgs[1] as RequestInit).headers).toEqual({ "Content-Type": "application/json" });
    const callBody = JSON.parse((callArgs[1] as RequestInit).body as string);
    expect(callBody).toEqual({
      subdomain: expect.stringMatching(/^[a-f0-9]{6}$/),
      port: TEST_PORT,
      // localhost targets are rewritten to this machine's LAN IP so the
      // (remote) proxy can reach back; CI runners have a private eth0 IP too.
      host: expect.stringMatching(/^\d+\.\d+\.\d+\.\d+$/),
      policy: "public",
    });
    expect(String(callBody.host)).not.toMatch(/^(localhost|127\.0\.0\.1)$/);
  });
});
