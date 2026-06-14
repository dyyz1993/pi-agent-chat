/** @vitest-environment happy-dom */
//
// 测试 PanelHeader 组件：
// - 渲染 title / icon
// - trailing 区域有/无内容时的渲染差异
// - iconCls 默认值 "text-semantic-accent" 与自定义值
// - className 被合并到根 div 的 className 中
import { render, screen, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { Sparkles } from "lucide-react";
import { PanelHeader } from "../../../src/mainview/components/primitives/PanelHeader";

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

describe("PanelHeader — title & icon rendering", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the title text", () => {
    render(<PanelHeader icon={Sparkles} title="My Panel" />);
    expect(screen.getByText("My Panel")).toBeInTheDocument();
  });

  it("renders the provided icon", () => {
    const { container } = render(<PanelHeader icon={Sparkles} title="Panel" />);
    expect(container.querySelector(".lucide-sparkles")).not.toBeNull();
  });

  it("renders title as ReactNode (not just string)", () => {
    render(
      <PanelHeader
        icon={Sparkles}
        title={<span data-testid="custom-title">Custom Title</span>}
      />,
    );
    expect(screen.getByTestId("custom-title")).toBeInTheDocument();
    expect(screen.getByText("Custom Title")).toBeInTheDocument();
  });
});

describe("PanelHeader — iconCls behavior", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("uses default 'text-semantic-accent' when iconCls is undefined", () => {
    const { container } = render(<PanelHeader icon={Sparkles} title="Panel" />);
    const icon = container.querySelector(".lucide-sparkles") as HTMLElement | null;
    expect(icon).not.toBeNull();
    expect(icon!.className).toContain("text-semantic-accent");
  });

  it("uses custom iconCls when provided", () => {
    const { container } = render(
      <PanelHeader icon={Sparkles} title="Panel" iconCls="text-blue-500" />,
    );
    const icon = container.querySelector(".lucide-sparkles") as HTMLElement | null;
    expect(icon).not.toBeNull();
    expect(icon!.className).toContain("text-blue-500");
    // 自定义值应取代默认值（源码用 `??`，传入值时不会出现默认值）
    expect(icon!.className).not.toContain("text-semantic-accent");
  });

  it("preserves base icon classes alongside iconCls", () => {
    const { container } = render(
      <PanelHeader icon={Sparkles} title="Panel" iconCls="text-blue-500" />,
    );
    const icon = container.querySelector(".lucide-sparkles") as HTMLElement | null;
    expect(icon).not.toBeNull();
    expect(icon!.className).toContain("w-3.5");
    expect(icon!.className).toContain("h-3.5");
    expect(icon!.className).toContain("shrink-0");
    expect(icon!.className).toContain("text-blue-500");
  });
});

describe("PanelHeader — trailing region", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders trailing content when provided", () => {
    render(
      <PanelHeader
        icon={Sparkles}
        title="Panel"
        trailing={<button data-testid="trailing-btn">Action</button>}
      />,
    );
    expect(screen.getByTestId("trailing-btn")).toBeInTheDocument();
  });

  it("does NOT render trailing region when not provided", () => {
    const { container } = render(<PanelHeader icon={Sparkles} title="Panel" />);
    // 源码：{trailing && <div className="ml-auto flex ...">}，没有 trailing 时不渲染 ml-auto div
    expect(container.querySelectorAll(".ml-auto").length).toBe(0);
  });

  it("does NOT render trailing region when trailing is null", () => {
    const { container } = render(
      <PanelHeader icon={Sparkles} title="Panel" trailing={null} />,
    );
    expect(container.querySelectorAll(".ml-auto").length).toBe(0);
  });

  it("does NOT render trailing region when trailing is undefined", () => {
    const { container } = render(
      <PanelHeader icon={Sparkles} title="Panel" trailing={undefined} />,
    );
    expect(container.querySelectorAll(".ml-auto").length).toBe(0);
  });

  it("renders multiple trailing elements in the same wrapper", () => {
    render(
      <PanelHeader
        icon={Sparkles}
        title="Panel"
        trailing={
          <>
            <button data-testid="btn-1">A</button>
            <button data-testid="btn-2">B</button>
          </>
        }
      />,
    );
    expect(screen.getByTestId("btn-1")).toBeInTheDocument();
    expect(screen.getByTestId("btn-2")).toBeInTheDocument();
    // 同一个 ml-auto 容器内
    expect(screen.getByTestId("btn-1").closest(".ml-auto")).toBe(
      screen.getByTestId("btn-2").closest(".ml-auto"),
    );
  });

  it("renders trailing with ml-auto (pushed to right)", () => {
    const { container } = render(
      <PanelHeader
        icon={Sparkles}
        title="Panel"
        trailing={<span data-testid="trailing">Right</span>}
      />,
    );
    const wrapper = container.querySelector(".ml-auto") as HTMLElement | null;
    expect(wrapper).not.toBeNull();
    expect(wrapper!.className).toContain("flex");
    expect(wrapper!.className).toContain("items-center");
    expect(wrapper!.className).toContain("gap-1");
  });
});

describe("PanelHeader — className merging", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("merges custom className into root div", () => {
    const { container } = render(
      <PanelHeader icon={Sparkles} title="Panel" className="my-custom-class" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root).not.toBeNull();
    expect(root.className).toContain("my-custom-class");
    // 默认样式仍保留
    expect(root.className).toContain("flex");
    expect(root.className).toContain("items-center");
  });

  it("root has no extra trailing className when undefined", () => {
    const { container } = render(<PanelHeader icon={Sparkles} title="Panel" />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("flex");
    expect(root.className).toContain("border-b");
  });

  it("preserves border-b class even with custom className", () => {
    const { container } = render(
      <PanelHeader icon={Sparkles} title="Panel" className="bg-red-100" />,
    );
    const root = container.firstChild as HTMLElement;
    expect(root.className).toContain("border-b");
    expect(root.className).toContain("bg-red-100");
  });
});

describe("PanelHeader — layout structure", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("icon appears before title in DOM order", () => {
    const { container } = render(
      <PanelHeader icon={Sparkles} title="MyTitle" />,
    );
    const icon = container.querySelector(".lucide-sparkles");
    const title = screen.getByText("MyTitle");
    expect(icon).not.toBeNull();
    // 比较 DOM 顺序：icon 在 title 之前
    expect(icon!.compareDocumentPosition(title)).toEqual(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("trailing appears after title in DOM order", () => {
    render(
      <PanelHeader
        icon={Sparkles}
        title="MyTitle"
        trailing={<span data-testid="trailing">Trailing</span>}
      />,
    );
    const title = screen.getByText("MyTitle");
    const trailing = screen.getByTestId("trailing");
    expect(title.compareDocumentPosition(trailing)).toEqual(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });
});
