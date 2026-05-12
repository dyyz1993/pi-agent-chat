import { describe, it, expect, beforeEach } from "vitest";

import { useRpcDebugStore } from "../src/mainview/stores/use-rpc-debug-store";

beforeEach(() => {
  useRpcDebugStore.setState({ entries: [] });
});

describe("useRpcDebugStore", () => {
  it("initial state: entries=[], maxEntries=500", () => {
    const s = useRpcDebugStore.getState();
    expect(s.entries).toEqual([]);
    expect(s.maxEntries).toBe(500);
  });

  it("addEntry → entries[0] contains id and timestamp", () => {
    useRpcDebugStore.getState().addEntry({
      direction: "call",
      method: "test.method",
      payload: {},
    });
    const entries = useRpcDebugStore.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0].direction).toBe("call");
    expect(entries[0].method).toBe("test.method");
    expect(typeof entries[0].id).toBe("string");
    expect(typeof entries[0].timestamp).toBe("number");
  });

  it("addEntry multiple times → LIFO order (newest first)", () => {
    useRpcDebugStore.getState().addEntry({
      direction: "call",
      method: "first",
      payload: {},
    });
    useRpcDebugStore.getState().addEntry({
      direction: "event",
      method: "second",
      payload: {},
    });
    const entries = useRpcDebugStore.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0].method).toBe("second");
    expect(entries[1].method).toBe("first");
  });

  it("truncates entries beyond maxEntries", () => {
    useRpcDebugStore.setState({ maxEntries: 3 });

    for (let i = 0; i < 5; i++) {
      useRpcDebugStore.getState().addEntry({
        direction: "call",
        method: `method-${i}`,
        payload: {},
      });
    }

    const entries = useRpcDebugStore.getState().entries;
    expect(entries).toHaveLength(3);
    expect(entries[0].method).toBe("method-4");
    expect(entries[2].method).toBe("method-2");
  });

  it("clear → entries=[]", () => {
    useRpcDebugStore.getState().addEntry({
      direction: "call",
      method: "m",
      payload: {},
    });
    useRpcDebugStore.getState().clear();
    expect(useRpcDebugStore.getState().entries).toEqual([]);
  });
});
