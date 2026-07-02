/** @vitest-environment happy-dom */
//
// 测试 ImageViewerOverlay 组件：
// - 渲染 img 元素，src 与 alt 正确
// - 通过 portal 挂到 document.body，避免被消息列表/虚拟滚动容器裁切
// - 点击背景触发 onClose（事件冒泡到 overlay）
// - 点击 img 本身不触发 onClose（stopPropagation）
// - 点击关闭按钮触发 onClose
// - alt 默认值 "preview"
import { render, screen, fireEvent, cleanup, createEvent } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ImageViewerOverlay } from "../../../src/mainview/components/primitives/ImageViewerOverlay";

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

describe("ImageViewerOverlay — image rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders an img element with the provided src", () => {
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={vi.fn()} />);
    const img = screen.getByRole("img");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "https://example.com/a.png");
  });

  it("uses the provided alt", () => {
    render(<ImageViewerOverlay src="https://example.com/a.png" alt="My Image" onClose={vi.fn()} />);
    expect(screen.getByRole("img")).toHaveAttribute("alt", "My Image");
  });

  it("defaults alt to 'preview' when not provided", () => {
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={vi.fn()} />);
    expect(screen.getByRole("img")).toHaveAttribute("alt", "preview");
  });

  it("defaults alt to 'preview' when alt is undefined", () => {
    render(
      <ImageViewerOverlay src="https://example.com/a.png" alt={undefined} onClose={vi.fn()} />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("alt", "preview");
  });
});

describe("ImageViewerOverlay — background click triggers onClose", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("clicking the background overlay triggers onClose", () => {
    const onClose = vi.fn();
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={onClose} />);
    const overlay = screen.getByTestId("image-viewer-overlay");
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("clicking the overlay padding area triggers onClose", () => {
    const onClose = vi.fn();
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={onClose} />);
    // 模拟点击 overlay 容器自身（非 img、非 button）
    const overlay = screen.getByTestId("image-viewer-overlay");
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ImageViewerOverlay — img click does NOT close (stopPropagation)", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("clicking the image does NOT trigger onClose", () => {
    const onClose = vi.fn();
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={onClose} />);
    fireEvent.click(screen.getByRole("img"));
    expect(onClose).not.toHaveBeenCalled();
  });

  it("img onClick stops propagation — React synthetic event does NOT reach parent onClose", () => {
    // img 的 onClick 调用 e.stopPropagation()。验证方式：用一个 React 父元素包裹 overlay，
    // 其 onClick 会增加计数器。点击 img 后，父元素的 React 合成事件处理器不应被触发，
    // 因为 React 合成事件的 stopPropagation 会阻断 React 事件系统的冒泡。
    const onClose = vi.fn();
    const parentClickSpy = vi.fn();
    const { container } = render(
      <div onClick={parentClickSpy}>
        <ImageViewerOverlay src="https://example.com/a.png" onClose={onClose} />
      </div>,
    );
    const img = screen.getByRole("img");
    fireEvent.click(img);

    // onClose 不应触发（stopPropagation 在 img 上）
    expect(onClose).not.toHaveBeenCalled();
    // 外层 React onClick 也不应触发（img 的 stopPropagation 阻断 React 合成事件冒泡）
    expect(parentClickSpy).not.toHaveBeenCalled();
    // 验证 overlay 根元素存在
    expect(container.firstChild).not.toBeNull();
    expect(screen.getByTestId("image-viewer-overlay")).toBeInTheDocument();
  });

  it("createEvent click on img still does not trigger onClose", () => {
    const onClose = vi.fn();
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={onClose} />);
    const img = screen.getByRole("img");
    const evt = createEvent.click(img);
    fireEvent(img, evt);
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("ImageViewerOverlay — close button", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders a close button", () => {
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Close image preview" });
    expect(button).not.toBeNull();
  });

  it("close button has an X icon (lucide)", () => {
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={vi.fn()} />);
    expect(
      screen.getByRole("button", { name: "Close image preview" }).querySelector(".lucide-x"),
    ).not.toBeNull();
  });

  it("clicking the close button triggers onClose", () => {
    const onClose = vi.fn();
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={onClose} />);
    const button = screen.getByRole("button", { name: "Close image preview" });
    fireEvent.click(button);
    // 至少触发一次（关闭语义满足）
    expect(onClose).toHaveBeenCalled();
  });

  it("close button click only calls onClose once", () => {
    const onClose = vi.fn();
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={onClose} />);
    const button = screen.getByRole("button", { name: "Close image preview" });
    fireEvent.click(button);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("ImageViewerOverlay — layout & accessibility", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("root is fixed inset-0 fullscreen", () => {
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={vi.fn()} />);
    const root = screen.getByTestId("image-viewer-overlay");
    expect(root.className).toContain("fixed");
    expect(root.className).toContain("inset-0");
    expect(root.className).toContain("z-fullscreen");
  });

  it("root has dark backdrop background", () => {
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={vi.fn()} />);
    const root = screen.getByTestId("image-viewer-overlay");
    expect(root.className).toContain("bg-bg-elevated");
  });

  it("renders a visible shared surface title", () => {
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Image preview" })).toBeInTheDocument();
  });

  it("img is constrained to viewport", () => {
    render(<ImageViewerOverlay src="https://example.com/a.png" onClose={vi.fn()} />);
    const img = screen.getByRole("img");
    expect(img.className).toContain("max-w-[94vw]");
    expect(img.className).toContain("max-h-[calc(100vh-6rem)]");
    expect(img.className).toContain("object-contain");
  });

  it("portals outside the message node that triggered it", () => {
    const { container } = render(
      <div data-testid="message-node">
        <ImageViewerOverlay src="https://example.com/a.png" onClose={vi.fn()} />
      </div>,
    );

    const messageNode = screen.getByTestId("message-node");
    const overlay = screen.getByTestId("image-viewer-overlay");

    expect(container).toContainElement(messageNode);
    expect(messageNode).not.toContainElement(overlay);
    expect(document.body).toContainElement(overlay);
  });
});
