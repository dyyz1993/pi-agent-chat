/**
 * Mock RPC for L1 (smoke) and L3 (extensions) tests. Avoids spinning up
 * the dev server + pi CLI by intercepting the page's WebSocket and replying
 * to RPC requests from a configurable response map.
 *
 * Usage:
 *   const mock = await installMockRpc(page, {
 *     "goal.getStatus": { result: RUNNING_STATUS },
 *     "session.create": { result: { sessionId: "fake", sessionPath: "/tmp/x" } },
 *   });
 *   await page.goto(E2E_PAGE_URL);
 *   // ...interact with UI...
 *   await mock.close();
 *
 * The mock intercepts page-level WebSocket via `page.addInitScript`, so it
 * must be installed BEFORE the page connects to the backend.
 */

import type { Page } from "@playwright/test";

type MockResponse =
  | { result: unknown }
  | { error: { message: string; code?: number } }
  | ((params: Record<string, unknown>) => { result: unknown } | { error: { message: string; code?: number } });

export interface MockRpcInstaller {
  /** Update responses after install (e.g. switch goal.getStatus from setup → running). */
  update(newResponses: Record<string, MockResponse>): void;
  /** Count of received RPC calls by method (for assertions). */
  calls(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

export async function installMockRpc(
  page: Page,
  initialResponses: Record<string, MockResponse> = {},
): Promise<MockRpcInstaller> {
  // Inject a WebSocket shim BEFORE the page loads its real socket. The shim
  // intercepts outgoing {type:"request"} frames, looks up the response in
  // our map, and posts a {type:"response"} frame back.
  await page.addInitScript((responsesJson) => {
    const responses: Record<string, unknown> = JSON.parse(responsesJson);
    const calls: Record<string, number> = {};
    const original = window.WebSocket;
    const pending = new Map<string, (msg: unknown) => void>();

    function respond(id: string, raw: unknown): void {
      // Defer to simulate async RPC + let UI react
      setTimeout(() => {
        const shim = pending.get(id);
        if (!shim) return;
        pending.delete(id);
        shim({ id, ...((raw as { result?: unknown }) ?? {}) });
      }, 0);
    }

    class MockWebSocket extends original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        // Capture outgoing messages
        const realSend = this.send.bind(this);
        this.send = (data: string) => {
          let msg: { id?: string; method?: string; type?: string; params?: Record<string, unknown> };
          try {
            msg = JSON.parse(data);
          } catch {
            return realSend(data);
          }
          if (msg.type === "request" && msg.id && msg.method) {
            calls[msg.method] = (calls[msg.method] ?? 0) + 1;
            pending.set(msg.id, (response) => {
              realSend(JSON.stringify(response));
            });
            const handler = responses[msg.method];
            if (handler === undefined) {
              respond(msg.id, { error: { message: `mock: no handler for ${msg.method}` } });
              return;
            }
            if (typeof handler === "function") {
              respond(msg.id, handler(msg.params ?? {}));
            } else {
              respond(msg.id, handler);
            }
            return;
          }
          realSend(data);
        };
      }
    }
    Object.defineProperty(window, "WebSocket", { value: MockWebSocket, configurable: true });

    // Expose for test updates
    (window as unknown as { __mockRpcCalls: () => Record<string, number>; __mockRpcUpdate: (r: unknown) => void }).__mockRpcCalls = () => calls;
    (window as unknown as { __mockRpcCalls: () => Record<string, number>; __mockRpcUpdate: (r: unknown) => void }).__mockRpcUpdate = (r) => {
      Object.assign(responses, r as Record<string, unknown>);
    };
  }, JSON.stringify(initialResponses));

  return {
    update(newResponses) {
      return page.evaluate((r) => {
        (window as unknown as { __mockRpcUpdate: (r: unknown) => void }).__mockRpcUpdate(r);
      }, newResponses);
    },
    async calls() {
      return page.evaluate(() =>
        (window as unknown as { __mockRpcCalls: () => Record<string, number> }).__mockRpcCalls(),
      );
    },
    async close() {
      // Nothing to clean up; the WebSocket shim dies with the page
    },
  };
}

/** Convenience: install with default responses that make the app think
 *  it has an active session and no goal. Most L1 smoke tests use this. */
export async function installMockRpcWithDefaults(page: Page, overrides: Record<string, MockResponse> = {}): Promise<MockRpcInstaller> {
  return installMockRpc(page, {
    "project.open": { result: { path: "/tmp/e2e-fake" } },
    "project.scanSessions": { result: { sessions: [] } },
    "session.create": { result: { sessionId: "fake-session-id", sessionPath: "/tmp/e2e-fake.jsonl" } },
    "agent.getState": { result: { status: "idle" } },
    "agent.getStatus": { result: { status: "idle" } },
    "goal.getStatus": { result: { enabled: false, state: "disabled", rawStatus: "none", rawPhase: "none", continuationSequence: 0, turnCount: 0 } },
    "agent.getMessages": { result: { messages: [] } },
    ...overrides,
  });
}
