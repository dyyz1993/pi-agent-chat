import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest";

vi.mock("../src/mainview/lib/i18n", () => ({
  default: { language: "zh-CN", changeLanguage: vi.fn().mockResolvedValue(undefined) },
}));

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

let originalClassList: DOMTokenList;

beforeAll(() => {
  originalClassList = document.documentElement.classList;
});

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
  const mod = await import("../src/mainview/stores/use-theme-store");
  const store = mod.useThemeStore;
  store.setState({ theme: "dark", resolvedTheme: "dark", language: "zh-CN" });
  return store;
}

describe("useThemeStore", () => {
  it("initial state: theme='dark', resolvedTheme='dark'", async () => {
    const store = await importThemeStore();
    expect(store.getState().theme).toBe("dark");
    expect(store.getState().resolvedTheme).toBe("dark");
  });

  it("setTheme('light') → theme='light', resolvedTheme='light'", async () => {
    const store = await importThemeStore();
    store.getState().setTheme("light");
    expect(store.getState().theme).toBe("light");
    expect(store.getState().resolvedTheme).toBe("light");
  });

  it("setTheme('dark') → theme='dark', resolvedTheme='dark'", async () => {
    const store = await importThemeStore();
    store.getState().setTheme("light");
    store.getState().setTheme("dark");
    expect(store.getState().theme).toBe("dark");
    expect(store.getState().resolvedTheme).toBe("dark");
  });

  it("setLanguage('en') → language='en'", async () => {
    const store = await importThemeStore();
    store.getState().setLanguage("en");
    expect(store.getState().language).toBe("en");
  });

  it("setTheme toggles document.documentElement class correctly", async () => {
    const store = await importThemeStore();
    store.getState().setTheme("light");
    expect(addSpy).toHaveBeenCalledWith("light");
    expect(removeSpy).toHaveBeenCalledWith("dark");

    addSpy.mockReset();
    removeSpy.mockReset();

    store.getState().setTheme("dark");
    expect(addSpy).toHaveBeenCalledWith("dark");
    expect(removeSpy).toHaveBeenCalledWith("light");
  });

  it("setLanguage calls i18n.changeLanguage", async () => {
    const store = await importThemeStore();
    store.getState().setLanguage("en");
    const { default: i18n } = await import("../src/mainview/lib/i18n");
    expect(i18n.changeLanguage).toHaveBeenCalledWith("en");
  });
});
