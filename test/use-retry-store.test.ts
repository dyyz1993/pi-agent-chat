import { describe, it, expect, beforeEach } from "vitest";

import { useRetryStore } from "../src/mainview/stores/use-retry-store";

beforeEach(() => {
  useRetryStore.setState({ retryBySession: {} });
});

describe("useRetryStore", () => {
  it("initial state: retryBySession={}", () => {
    expect(useRetryStore.getState().retryBySession).toEqual({});
  });

  it("startRetry → retryBySession[sessionId] contains required fields", () => {
    useRetryStore.getState().startRetry("sess-1", {
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1000,
      errorMessage: "timeout",
    });
    const info = useRetryStore.getState().retryBySession["sess-1"];
    expect(info).toBeDefined();
    expect(info.attempt).toBe(1);
    expect(info.maxAttempts).toBe(3);
    expect(info.delayMs).toBe(1000);
    expect(info.errorMessage).toBe("timeout");
    expect(typeof info.startedAt).toBe("number");
  });

  it("endRetry → deletes corresponding session", () => {
    useRetryStore.getState().startRetry("sess-1", {
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1000,
      errorMessage: "err",
    });
    useRetryStore.getState().endRetry("sess-1");
    expect(useRetryStore.getState().retryBySession["sess-1"]).toBeUndefined();
  });

  it("startRetry multiple times → keeps only the last", () => {
    useRetryStore.getState().startRetry("sess-1", {
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1000,
      errorMessage: "err1",
    });
    useRetryStore.getState().startRetry("sess-1", {
      attempt: 2,
      maxAttempts: 3,
      delayMs: 2000,
      errorMessage: "err2",
    });
    const info = useRetryStore.getState().retryBySession["sess-1"];
    expect(info.attempt).toBe(2);
    expect(info.delayMs).toBe(2000);
    expect(info.errorMessage).toBe("err2");
  });

  it("startRetry then endRetry → fully cleared", () => {
    useRetryStore.getState().startRetry("sess-1", {
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1000,
      errorMessage: "err",
    });
    useRetryStore.getState().endRetry("sess-1");
    expect(useRetryStore.getState().retryBySession).toEqual({});
  });

  it("endRetry on non-existent sessionId → no error", () => {
    expect(() => {
      useRetryStore.getState().endRetry("nonexistent");
    }).not.toThrow();
    expect(useRetryStore.getState().retryBySession).toEqual({});
  });
});
