import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useInputHistory } from "../src/mainview/hooks/use-input-history";

const STORAGE_PREFIX = "pi-input-history";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
  };
}

if (typeof globalThis.localStorage === "undefined") {
  Object.defineProperty(globalThis, "localStorage", {
    value: createMemoryStorage(),
    configurable: true,
  });
}

function clearLocalStorage() {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX)) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

describe("useInputHistory", () => {
  beforeEach(() => {
    clearLocalStorage();
  });

  afterEach(() => {
    clearLocalStorage();
  });

  it("initial state: hasPrev=false, hasNext=false", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));
    expect(result.current.hasPrev).toBe(false);
    expect(result.current.hasNext).toBe(false);
  });

  it("saveToHistory + navigatePrev returns saved text", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    act(() => {
      result.current.saveToHistory("hello world");
    });

    let text: string | null = null;
    act(() => {
      text = result.current.navigatePrev();
    });

    expect(text).toBe("hello world");
  });

  it("navigatePrev traverses history in correct order", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    act(() => {
      result.current.saveToHistory("first");
      result.current.saveToHistory("second");
      result.current.saveToHistory("third");
    });

    const results: (string | null)[] = [];
    act(() => {
      results.push(result.current.navigatePrev());
      results.push(result.current.navigatePrev());
      results.push(result.current.navigatePrev());
    });

    expect(results[0]).toBe("third");
    expect(results[1]).toBe("second");
    expect(results[2]).toBe("first");
  });

  it("navigatePrev stops at oldest entry", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    act(() => {
      result.current.saveToHistory("a");
      result.current.saveToHistory("b");
    });

    const results: (string | null)[] = [];
    act(() => {
      results.push(result.current.navigatePrev());
      results.push(result.current.navigatePrev());
      results.push(result.current.navigatePrev());
    });

    expect(results[0]).toBe("b");
    expect(results[1]).toBe("a");
    expect(results[2]).toBe("a");
  });

  it("navigateNext returns newer history entries", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    act(() => {
      result.current.saveToHistory("a");
      result.current.saveToHistory("b");
      result.current.saveToHistory("c");
    });

    const results: (string | null)[] = [];
    act(() => {
      results.push(result.current.navigatePrev());
      results.push(result.current.navigatePrev());
      results.push(result.current.navigateNext());
    });

    expect(results[0]).toBe("c");
    expect(results[1]).toBe("b");
    expect(results[2]).toBe("c");
  });

  it("navigateNext returns empty string at the end", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    act(() => {
      result.current.saveToHistory("a");
    });

    const results: (string | null)[] = [];
    act(() => {
      results.push(result.current.navigatePrev());
      results.push(result.current.navigateNext());
    });

    expect(results[0]).toBe("a");
    expect(results[1]).toBe("");
  });

  it("navigateNext returns null when history is empty", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    let text: string | null = null;
    act(() => {
      text = result.current.navigateNext();
    });

    expect(text).toBeNull();
  });

  it("saveToHistory deduplicates and moves to front", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    act(() => {
      result.current.saveToHistory("alpha");
      result.current.saveToHistory("beta");
      result.current.saveToHistory("alpha");
    });

    const results: (string | null)[] = [];
    act(() => {
      results.push(result.current.navigatePrev());
      results.push(result.current.navigatePrev());
    });

    expect(results[0]).toBe("alpha");
    expect(results[1]).toBe("beta");
  });

  it("saveToHistory ignores empty/whitespace text", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    act(() => {
      result.current.saveToHistory("");
      result.current.saveToHistory("   ");
    });

    expect(result.current.hasPrev).toBe(false);
  });

  it("clearHistory empties history and navigatePrev returns null", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    act(() => {
      result.current.saveToHistory("data");
    });

    act(() => {
      result.current.clearHistory();
    });

    expect(result.current.hasPrev).toBe(false);
    expect(result.current.hasNext).toBe(false);

    let text: string | null = null;
    act(() => {
      text = result.current.navigatePrev();
    });

    expect(text).toBeNull();
  });

  it("resetIndex allows navigatePrev to start from beginning again", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    act(() => {
      result.current.saveToHistory("x");
      result.current.saveToHistory("y");
    });

    act(() => {
      result.current.navigatePrev();
      result.current.navigatePrev();
    });

    act(() => {
      result.current.resetIndex();
    });

    let text: string | null = null;
    act(() => {
      text = result.current.navigatePrev();
    });

    expect(text).toBe("y");
  });

  it("different sessions have independent history", () => {
    const { result: resultA } = renderHook(() => useInputHistory("session-A"));
    const { result: resultB } = renderHook(() => useInputHistory("session-B"));

    act(() => {
      resultA.current.saveToHistory("from-A");
      resultB.current.saveToHistory("from-B");
    });

    let textA: string | null = null;
    let textB: string | null = null;
    act(() => {
      textA = resultA.current.navigatePrev();
      textB = resultB.current.navigatePrev();
    });

    expect(textA).toBe("from-A");
    expect(textB).toBe("from-B");
  });

  it("max 10 items are stored", () => {
    const { result } = renderHook(() => useInputHistory("test-session"));

    act(() => {
      for (let i = 1; i <= 15; i++) {
        result.current.saveToHistory(`item-${i}`);
      }
    });

    const items: string[] = [];
    act(() => {
      for (let i = 0; i < 10; i++) {
        const val = result.current.navigatePrev();
        if (val !== null && !items.includes(val)) {
          items.push(val);
        }
      }
    });

    expect(items).toHaveLength(10);
    expect(items[0]).toBe("item-15");
    expect(items[9]).toBe("item-6");
  });
});
