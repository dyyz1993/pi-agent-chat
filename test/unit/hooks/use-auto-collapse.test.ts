/** @vitest-environment happy-dom */
//
// 测试 useAutoCollapse hook 的核心行为：
// 1. 初始 collapsed 值 = !isRunning && collapseToolCards
// 2. isRunning 从 true→false 且 collapseToolCards 为 true 时自动折叠
// 3. setCollapsed 可以手动覆盖
//
// Mock 策略：
// - useSettingsStore 用 zustand store 模拟（支持 setState 动态修改）
// - react-i18next / logger 标准占位 mock
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";

// --- Mock: useSettingsStore ---
// 使用一个内部状态对象，可通过 mockSetSettings 修改，从而覆盖 hook 对 store 的订阅
let mockCollapseToolCards = false;

vi.mock("../../../src/mainview/stores/use-settings-store", () => ({
  useSettingsStore: (sel: (s: { collapseToolCards: boolean }) => unknown) =>
    sel({ collapseToolCards: mockCollapseToolCards }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("../../../src/shared/lib/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { useAutoCollapse } from "../../../src/mainview/hooks/use-auto-collapse";

function renderAutoCollapse(running: boolean) {
  return renderHook(({ r }: { r: boolean }) => useAutoCollapse(r), {
    initialProps: { r: running },
  });
}

describe("useAutoCollapse — initial collapsed value", () => {
  beforeEach(() => {
    mockCollapseToolCards = false;
  });
  afterEach(() => {
    cleanup();
  });

  it("isRunning=true + collapseToolCards=false → collapsed=false", () => {
    mockCollapseToolCards = false;
    const { result } = renderAutoCollapse(true);
    expect(result.current[0]).toBe(false);
  });

  it("isRunning=true + collapseToolCards=true → collapsed=false (running keeps expanded)", () => {
    mockCollapseToolCards = true;
    const { result } = renderAutoCollapse(true);
    expect(result.current[0]).toBe(false);
  });

  it("isRunning=false + collapseToolCards=true → collapsed=true", () => {
    mockCollapseToolCards = true;
    const { result } = renderAutoCollapse(false);
    expect(result.current[0]).toBe(true);
  });

  it("isRunning=false + collapseToolCards=false → collapsed=false", () => {
    mockCollapseToolCards = false;
    const { result } = renderAutoCollapse(false);
    expect(result.current[0]).toBe(false);
  });
});

describe("useAutoCollapse — auto collapse on true→false transition", () => {
  beforeEach(() => {
    mockCollapseToolCards = false;
  });
  afterEach(() => {
    cleanup();
  });

  it("auto collapses when isRunning goes true→false and collapseToolCards=true", () => {
    mockCollapseToolCards = true;
    const { result, rerender } = renderAutoCollapse(true);
    expect(result.current[0]).toBe(false);

    act(() => {
      rerender({ r: false });
    });
    expect(result.current[0]).toBe(true);
  });

  it("does NOT auto collapse when collapseToolCards=false (isRunning true→false)", () => {
    mockCollapseToolCards = false;
    const { result, rerender } = renderAutoCollapse(true);
    expect(result.current[0]).toBe(false);

    act(() => {
      rerender({ r: false });
    });
    expect(result.current[0]).toBe(false);
  });

  it("does NOT collapse on false→true transition (only true→false triggers)", () => {
    mockCollapseToolCards = true;
    const { result, rerender } = renderAutoCollapse(false);
    // 初始就是 collapsed
    expect(result.current[0]).toBe(true);

    // false → true 不应该改变为未折叠之外的值（useEffect 不触发折叠）
    act(() => {
      rerender({ r: true });
    });
    expect(result.current[0]).toBe(true);
  });

  it("full lifecycle: false → true → false collapses only at the end", () => {
    mockCollapseToolCards = true;

    // 1. 初始：未运行 → collapsed=true
    const { result, rerender } = renderAutoCollapse(false);
    expect(result.current[0]).toBe(true);

    // 2. 用户手动展开后开始运行
    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);

    act(() => {
      rerender({ r: true });
    });
    // 运行中保持展开
    expect(result.current[0]).toBe(false);

    // 3. 运行完成 → 自动折叠
    act(() => {
      rerender({ r: false });
    });
    expect(result.current[0]).toBe(true);
  });
});

describe("useAutoCollapse — manual override", () => {
  beforeEach(() => {
    mockCollapseToolCards = false;
  });
  afterEach(() => {
    cleanup();
  });

  it("setCollapsed(true) overrides auto-behavior", () => {
    mockCollapseToolCards = false;
    const { result } = renderAutoCollapse(true);
    expect(result.current[0]).toBe(false);

    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);
  });

  it("setCollapsed(false) overrides an auto-collapse", () => {
    mockCollapseToolCards = true;
    const { result, rerender } = renderAutoCollapse(true);
    expect(result.current[0]).toBe(false);

    // 完成后自动折叠
    act(() => {
      rerender({ r: false });
    });
    expect(result.current[0]).toBe(true);

    // 用户手动重新展开
    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);
  });

  it("setCollapsed accepts a function-style boolean (false value)", () => {
    // setCollapsed 的签名是 (v: boolean) => void，不是 updater function。
    // 但传入 false 应正确工作。
    mockCollapseToolCards = false;
    const { result } = renderAutoCollapse(false);
    expect(result.current[0]).toBe(false);

    act(() => {
      result.current[1](true);
    });
    expect(result.current[0]).toBe(true);

    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);
  });
});

describe("useAutoCollapse — collapseToolCards changes mid-life", () => {
  beforeEach(() => {
    mockCollapseToolCards = false;
  });
  afterEach(() => {
    cleanup();
  });

  it("changing collapseToolCards after mount does not retroactively collapse", () => {
    // 启动时 false，渲染时不折叠
    mockCollapseToolCards = false;
    const { result } = renderAutoCollapse(false);
    expect(result.current[0]).toBe(false);

    // 之后 store 改成 true，但由于 isRunning 未变化（false → false），
    // effect 中 wasRunningRef.current=false !isRunning=false → 不触发
    mockCollapseToolCards = true;
    act(() => {
      // 触发 re-render（renderHook 不会自动 re-render）
      result.current[1](result.current[0]);
    });
    expect(result.current[0]).toBe(false);
  });

  it("collapseToolCards=false: running then idle keeps expanded", () => {
    mockCollapseToolCards = false;
    const { result, rerender } = renderAutoCollapse(true);
    expect(result.current[0]).toBe(false);

    act(() => {
      rerender({ r: false });
    });
    expect(result.current[0]).toBe(false);
  });
});

describe("useAutoCollapse — repeated transitions", () => {
  beforeEach(() => {
    mockCollapseToolCards = false;
  });
  afterEach(() => {
    cleanup();
  });

  it("multiple true→false transitions each trigger collapse", () => {
    mockCollapseToolCards = true;
    const { result, rerender } = renderAutoCollapse(true);

    // 第一次 true → false
    act(() => {
      rerender({ r: false });
    });
    expect(result.current[0]).toBe(true);

    // 手动展开
    act(() => {
      result.current[1](false);
    });
    expect(result.current[0]).toBe(false);

    // 重新运行
    act(() => {
      rerender({ r: true });
    });
    expect(result.current[0]).toBe(false);

    // 第二次 true → false 再次折叠
    act(() => {
      rerender({ r: false });
    });
    expect(result.current[0]).toBe(true);
  });

  it("isRunning stays true across renders: never collapses", () => {
    mockCollapseToolCards = true;
    const { result, rerender } = renderAutoCollapse(true);
    expect(result.current[0]).toBe(false);

    act(() => {
      rerender({ r: true });
    });
    expect(result.current[0]).toBe(false);

    act(() => {
      rerender({ r: true });
    });
    expect(result.current[0]).toBe(false);
  });
});
