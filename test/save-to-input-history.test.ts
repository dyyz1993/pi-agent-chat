import { describe, it, expect, beforeEach, vi } from "vitest";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    _store: () => store,
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

import { saveToInputHistory } from "../src/mainview/hooks/use-input-history";

const SID = "sess-1";
const STORAGE_KEY = `pi-input-history:${SID}`;

describe("saveToInputHistory", () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  it("saves text to localStorage under correct key", () => {
    saveToInputHistory(SID, "hello");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(STORAGE_KEY, JSON.stringify(["hello"]));
  });

  it("trims whitespace before saving", () => {
    saveToInputHistory(SID, "  hello world  ");
    expect(localStorageMock.setItem).toHaveBeenCalledWith(
      STORAGE_KEY,
      JSON.stringify(["hello world"]),
    );
  });

  it("skips empty/whitespace-only text", () => {
    saveToInputHistory(SID, "");
    saveToInputHistory(SID, "   ");
    saveToInputHistory(SID, "\t\n");
    expect(localStorageMock.setItem).not.toHaveBeenCalled();
  });

  it("moves duplicate to front (dedup)", () => {
    saveToInputHistory(SID, "a");
    saveToInputHistory(SID, "b");
    saveToInputHistory(SID, "a");

    expect(localStorageMock.setItem).toHaveBeenLastCalledWith(
      STORAGE_KEY,
      JSON.stringify(["a", "b"]),
    );
  });

  it("respects MAX_ITEMS=10 limit", () => {
    for (let i = 0; i < 12; i++) {
      saveToInputHistory(SID, `item-${i}`);
    }

    const lastCall = localStorageMock.setItem.mock.calls.at(-1);
    const saved: string[] = JSON.parse(lastCall![1]);
    expect(saved).toHaveLength(10);
    expect(saved[0]).toBe("item-11");
    expect(saved[9]).toBe("item-2");
  });
});
