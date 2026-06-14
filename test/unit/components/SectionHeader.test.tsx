/** @vitest-environment happy-dom */
//
// 测试 SectionHeader 组件：
// - 根据 collapsed 切换 ChevronRight / ChevronDown 图标
// - 点击按钮触发 onToggle
// - 显示 label / badge
// - iconCls 传递到 icon 元素的 className
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ChevronUp } from "lucide-react";
import { SectionHeader } from "../../../src/mainview/components/primitives/SectionHeader";

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

describe("SectionHeader — chevron icon", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders ChevronRight when collapsed=true", () => {
    const { container } = render(
      <SectionHeader
        collapsed={true}
        onToggle={vi.fn()}
        icon={ChevronUp}
        label="Tools"
      />,
    );
    // lucide 渲染为 <svg>，类名中包含 "lucide-chevron-right"
    const chevronRight = container.querySelector(".lucide-chevron-right");
    expect(chevronRight).not.toBeNull();
    const chevronDown = container.querySelector(".lucide-chevron-down");
    expect(chevronDown).toBeNull();
  });

  it("renders ChevronDown when collapsed=false", () => {
    const { container } = render(
      <SectionHeader
        collapsed={false}
        onToggle={vi.fn()}
        icon={ChevronUp}
        label="Tools"
      />,
    );
    const chevronDown = container.querySelector(".lucide-chevron-down");
    expect(chevronDown).not.toBeNull();
    const chevronRight = container.querySelector(".lucide-chevron-right");
    expect(chevronRight).toBeNull();
  });
});

describe("SectionHeader — interactions", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("click on button triggers onToggle", () => {
    const onToggle = vi.fn();
    render(
      <SectionHeader
        collapsed={true}
        onToggle={onToggle}
        icon={ChevronUp}
        label="Tools"
      />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("click on label span still triggers onToggle (event bubbles to button)", () => {
    const onToggle = vi.fn();
    render(
      <SectionHeader
        collapsed={false}
        onToggle={onToggle}
        icon={ChevronUp}
        label="My Tools"
      />,
    );
    fireEvent.click(screen.getByText("My Tools"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("SectionHeader — label & badge", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the label text", () => {
    render(
      <SectionHeader
        collapsed={false}
        onToggle={vi.fn()}
        icon={ChevronUp}
        label="My Section"
      />,
    );
    expect(screen.getByText("My Section")).toBeInTheDocument();
  });

  it("renders badge when badge > 0", () => {
    render(
      <SectionHeader
        collapsed={false}
        onToggle={vi.fn()}
        icon={ChevronUp}
        label="Tools"
        badge={5}
      />,
    );
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("does NOT render badge when badge = 0", () => {
    const { container } = render(
      <SectionHeader
        collapsed={false}
        onToggle={vi.fn()}
        icon={ChevronUp}
        label="Tools"
        badge={0}
      />,
    );
    // 没有任何文本 "0" 出现
    expect(screen.queryByText("0")).toBeNull();
    // badge span 应该不存在（通过 ml-auto 类定位）
    expect(container.querySelectorAll(".ml-auto").length).toBe(0);
  });

  it("does NOT render badge when badge = undefined", () => {
    const { container } = render(
      <SectionHeader
        collapsed={false}
        onToggle={vi.fn()}
        icon={ChevronUp}
        label="Tools"
      />,
    );
    expect(container.querySelectorAll(".ml-auto").length).toBe(0);
  });

  it("renders large badge number correctly", () => {
    render(
      <SectionHeader
        collapsed={false}
        onToggle={vi.fn()}
        icon={ChevronUp}
        label="Tools"
        badge={999}
      />,
    );
    expect(screen.getByText("999")).toBeInTheDocument();
  });
});

describe("SectionHeader — icon & iconCls", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("renders the provided icon", () => {
    const { container } = render(
      <SectionHeader
        collapsed={false}
        onToggle={vi.fn()}
        icon={ChevronUp}
        label="Tools"
      />,
    );
    expect(container.querySelector(".lucide-chevron-up")).not.toBeNull();
  });

  it("passes iconCls to the icon element className", () => {
    const { container } = render(
      <SectionHeader
        collapsed={false}
        onToggle={vi.fn()}
        icon={ChevronUp}
        iconCls="text-red-500 custom-icon-cls"
        label="Tools"
      />,
    );
    const icon = container.querySelector(".lucide-chevron-up") as HTMLElement | null;
    expect(icon).not.toBeNull();
    expect(icon!.className).toContain("text-red-500");
    expect(icon!.className).toContain("custom-icon-cls");
  });

  it("renders icon without iconCls (empty string appended)", () => {
    const { container } = render(
      <SectionHeader
        collapsed={false}
        onToggle={vi.fn()}
        icon={ChevronUp}
        label="Tools"
      />,
    );
    const icon = container.querySelector(".lucide-chevron-up") as HTMLElement | null;
    expect(icon).not.toBeNull();
    // 模板字符串 `${iconCls ?? ""}` 为空时 className 末尾会多一个空格，但 iconCls 相关类不应存在
    expect(icon!.className).toContain("w-3");
    expect(icon!.className).toContain("h-3");
  });
});

describe("SectionHeader — accessibility", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("is a button element", () => {
    render(
      <SectionHeader
        collapsed={false}
        onToggle={vi.fn()}
        icon={ChevronUp}
        label="Tools"
      />,
    );
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("button contains chevron, icon, and label as one cohesive control", () => {
    const { container } = render(
      <SectionHeader
        collapsed={true}
        onToggle={vi.fn()}
        icon={ChevronDown}
        label="Expandable"
        badge={3}
      />,
    );
    const button = screen.getByRole("button");
    expect(button).toContainElement(container.querySelector(".lucide-chevron-right"));
    expect(button).toContainElement(container.querySelector(".lucide-chevron-down"));
    expect(button).toContainElement(screen.getByText("Expandable"));
    expect(button).toContainElement(screen.getByText("3"));
  });
});
