/** @vitest-environment happy-dom */
//
// 测试 FullscreenOverlay 组件：
// - 渲染 title / children / actions / footer
// - 关闭按钮触发 onClose
// - role="dialog" 与 aria-modal="true"
// - 按 Escape 触发 onClose（通过 useFocusTrap 的 keydown 监听）
//
// Mock 策略：
// - react-i18next / logger 标准占位
// - 不 mock useFocusTrap：它本身在 happy-dom 中可工作（绑定 keydown 到 document）
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { FullscreenOverlay } from "../../../src/mainview/components/primitives/FullscreenOverlay";

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

function fireEscape() {
  // useFocusTrap 监听 document 的 keydown；stopImmediatePropagation 会阻止冒泡，
  // 必须用 capture 或直接 dispatch 到 document 的方式触发。
  // 在 happy-dom 中 fireEvent.keyDown(document.body, { key: "Escape" }) 也能命中
  // document 监听器，因为事件冒泡到 document。
  const evt = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
  });
  document.body.dispatchEvent(evt);
}

describe("FullscreenOverlay — content rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders title text", () => {
    render(
      <FullscreenOverlay title="My Overlay" closeLabel="Close" onClose={vi.fn()}>
        <span>Body</span>
      </FullscreenOverlay>,
    );
    expect(screen.getByText("My Overlay")).toBeInTheDocument();
  });

  it("renders title as ReactNode", () => {
    render(
      <FullscreenOverlay
        title={<span data-testid="title-node">Title Node</span>}
        closeLabel="Close"
        onClose={vi.fn()}
      >
        <span>Body</span>
      </FullscreenOverlay>,
    );
    expect(screen.getByTestId("title-node")).toBeInTheDocument();
  });

  it("renders children content", () => {
    render(
      <FullscreenOverlay title="T" closeLabel="Close" onClose={vi.fn()}>
        <div data-testid="child">Child Content</div>
      </FullscreenOverlay>,
    );
    expect(screen.getByTestId("child")).toBeInTheDocument();
    expect(screen.getByText("Child Content")).toBeInTheDocument();
  });

  it("renders optional icon node when provided", () => {
    render(
      <FullscreenOverlay
        title="T"
        closeLabel="Close"
        onClose={vi.fn()}
        icon={<span data-testid="icon">⚠</span>}
      >
        <span>Body</span>
      </FullscreenOverlay>,
    );
    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });
});

describe("FullscreenOverlay — close button", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a close button with closeLabel as aria-label", () => {
    render(
      <FullscreenOverlay title="T" closeLabel="Dismiss" onClose={vi.fn()}>
        <span>Body</span>
      </FullscreenOverlay>,
    );
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("clicking close button triggers onClose", () => {
    const onClose = vi.fn();
    render(
      <FullscreenOverlay title="T" closeLabel="Close" onClose={onClose}>
        <span>Body</span>
      </FullscreenOverlay>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("FullscreenOverlay — actions & footer", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders actions node in header", () => {
    render(
      <FullscreenOverlay
        title="T"
        closeLabel="Close"
        onClose={vi.fn()}
        actions={<button data-testid="action-btn">Action</button>}
      >
        <span>Body</span>
      </FullscreenOverlay>,
    );
    expect(screen.getByTestId("action-btn")).toBeInTheDocument();
  });

  it("renders footer node when provided", () => {
    render(
      <FullscreenOverlay
        title="T"
        closeLabel="Close"
        onClose={vi.fn()}
        footer={<button data-testid="footer-btn">Save</button>}
      >
        <span>Body</span>
      </FullscreenOverlay>,
    );
    expect(screen.getByTestId("footer-btn")).toBeInTheDocument();
  });

  it("does NOT render footer region when footer is not provided", () => {
    const { container } = render(
      <FullscreenOverlay title="T" closeLabel="Close" onClose={vi.fn()}>
        <span>Body</span>
      </FullscreenOverlay>,
    );
    // footer 容器有 border-t 类，应该不存在
    expect(container.querySelectorAll(".border-t").length).toBe(0);
  });

  it("does NOT render footer region when footer is null", () => {
    const { container } = render(
      <FullscreenOverlay title="T" closeLabel="Close" onClose={vi.fn()} footer={null}>
        <span>Body</span>
      </FullscreenOverlay>,
    );
    expect(container.querySelectorAll(".border-t").length).toBe(0);
  });
});

describe("FullscreenOverlay — dialog accessibility attributes", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("has role='dialog' on root element", () => {
    render(
      <FullscreenOverlay title="T" closeLabel="Close" onClose={vi.fn()}>
        <span>Body</span>
      </FullscreenOverlay>,
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has aria-modal='true' on root element", () => {
    const { container } = render(
      <FullscreenOverlay title="T" closeLabel="Close" onClose={vi.fn()}>
        <span>Body</span>
      </FullscreenOverlay>,
    );
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    expect(dialog!.getAttribute("aria-modal")).toBe("true");
  });

  it("has aria-labelledby pointing to the title element", () => {
    const { container } = render(
      <FullscreenOverlay title="My Title" closeLabel="Close" onClose={vi.fn()}>
        <span>Body</span>
      </FullscreenOverlay>,
    );
    const dialog = container.querySelector('[role="dialog"]') as HTMLElement | null;
    expect(dialog).not.toBeNull();
    const labelledBy = dialog!.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    // React useId() 返回的 ID 含冒号（如 ":rc:"），不能直接用于 CSS 选择器。
    // 改用 document.getElementById（不依赖选择器解析）。
    const labelledEl = document.getElementById(labelledBy!) as HTMLElement | null;
    expect(labelledEl).not.toBeNull();
    expect(labelledEl!.tagName).toBe("H2");
    expect(labelledEl!.textContent).toBe("My Title");
  });
});

describe("FullscreenOverlay — Escape key", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("pressing Escape triggers onClose via useFocusTrap", () => {
    const onClose = vi.fn();
    render(
      <FullscreenOverlay title="T" closeLabel="Close" onClose={onClose}>
        <span>Body</span>
      </FullscreenOverlay>,
    );

    act(() => {
      fireEscape();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Escape only triggers onClose once per press", () => {
    const onClose = vi.fn();
    render(
      <FullscreenOverlay title="T" closeLabel="Close" onClose={onClose}>
        <span>Body</span>
      </FullscreenOverlay>,
    );

    act(() => {
      fireEscape();
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    // 不再触发
    act(() => {
      fireEscape();
    });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});

describe("FullscreenOverlay — layout & position", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("defaults to position=fixed layer=fullscreen", () => {
    const { container } = render(
      <FullscreenOverlay title="T" closeLabel="Close" onClose={vi.fn()}>
        <span>Body</span>
      </FullscreenOverlay>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("fixed");
    expect(root.className).toContain("z-fullscreen");
  });

  it("supports position=absolute", () => {
    const { container } = render(
      <FullscreenOverlay
        title="T"
        closeLabel="Close"
        onClose={vi.fn()}
        position="absolute"
      >
        <span>Body</span>
      </FullscreenOverlay>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("absolute");
    expect(root.className).not.toContain("fixed");
  });

  it("supports layer=modal", () => {
    const { container } = render(
      <FullscreenOverlay title="T" closeLabel="Close" onClose={vi.fn()} layer="modal">
        <span>Body</span>
      </FullscreenOverlay>,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("z-modal");
  });
});
