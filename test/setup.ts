import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// 全局 mock apiClient，避免所有测试单独处理 onReconnect/call
vi.mock("../src/mainview/lib/api-client", () => {
  const mockCall = vi.fn();
  const mockOnReconnect = vi.fn();
  const mockOn = vi.fn();
  const mockOff = vi.fn();
  return {
    apiClient: {
      call: mockCall,
      onReconnect: mockOnReconnect,
      on: mockOn,
      off: mockOff,
    },
    resolveAuthToken: () => "",
  };
});

if (typeof globalThis.localStorage?.setItem !== "function") {
  const store: Record<string, string> = {};
  globalThis.localStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = String(value);
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const k of Object.keys(store)) delete store[k];
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}
