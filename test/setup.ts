import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

// 全局 mock apiClient，避免所有测试单独处理 onReconnect/call。
// 真实导出打底：api-client 还导出 isDesktopRemoteMode 等纯函数，
// 组件（如 SettingsPanel）会在渲染时调用，mock 必须保留它们。
vi.mock("../src/mainview/lib/api-client", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../src/mainview/lib/api-client")
  >();
  const mockCall = vi.fn();
  const mockOnReconnect = vi.fn();
  const mockOn = vi.fn();
  const mockOff = vi.fn();
  return {
    ...actual,
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
