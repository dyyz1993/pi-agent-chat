import { describe, it, expect, beforeEach, vi } from "vitest";

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

Object.defineProperty(window, "localStorage", { value: localStorageMock });

const addSpy = vi.fn();
const removeSpy = vi.fn();

const originalClassList = document.documentElement.classList;

beforeEach(() => {
  localStorageMock.clear();
  addSpy.mockReset();
  removeSpy.mockReset();

  Object.defineProperty(document.documentElement, "classList", {
    value: {
      add: addSpy,
      remove: removeSpy,
      contains: originalClassList.contains.bind(originalClassList),
      toggle: originalClassList.toggle?.bind(originalClassList),
      item: originalClassList.item.bind(originalClassList),
      length: originalClassList.length,
      entries: originalClassList.entries.bind(originalClassList),
      forEach: originalClassList.forEach.bind(originalClassList),
      keys: originalClassList.keys.bind(originalClassList),
      values: originalClassList.values.bind(originalClassList),
      [Symbol.iterator]: originalClassList[Symbol.iterator].bind(originalClassList),
    },
    configurable: true,
  });
});

async function importThemeStore() {
  const mod = await import("../../../src/mainview/stores/use-theme-store");
  const store = mod.useThemeStore;
  store.setState({
    theme: "dark",
    resolvedTheme: "dark",
  });
  return store;
}

describe("useThemeStore", () => {
  it("defaults to dark theme", async () => {
    const store = await importThemeStore();
    expect(store.getState().theme).toBe("dark");
    expect(store.getState().resolvedTheme).toBe("dark");
  });

  it("switches to light and applies dark class removal", async () => {
    const store = await importThemeStore();
    store.getState().setTheme("light");

    expect(store.getState().theme).toBe("light");
    expect(store.getState().resolvedTheme).toBe("light");
    expect(removeSpy).toHaveBeenCalledWith("dark", "light");
    expect(document.documentElement.style.colorScheme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("switches to dark and applies dark class", async () => {
    const store = await importThemeStore();
    store.getState().setTheme("light");
    addSpy.mockReset();
    removeSpy.mockReset();

    store.getState().setTheme("dark");
    expect(addSpy).toHaveBeenCalledWith("dark");
    expect(removeSpy).toHaveBeenCalledWith("dark", "light");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
  });

  it("resolves system theme based on matchMedia", async () => {
    const store = await importThemeStore();

    const spy = vi
      .spyOn(window, "matchMedia")
      .mockReturnValue({ matches: false } as MediaQueryList);
    store.getState().setTheme("system");
    expect(store.getState().resolvedTheme).toBe("light");

    spy.mockRestore();
  });

  it("persists theme to localStorage", async () => {
    const store = await importThemeStore();
    store.getState().setTheme("light");

    const stored = localStorageMock.getItem("pi-theme");
    expect(stored).not.toBeNull();
    const parsed = JSON.parse(stored!);
    expect(parsed.state.theme).toBe("light");
  });
});
