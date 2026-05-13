import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { ThemeToggle } from "../src/mainview/components/theme/ThemeToggle";
import type { Theme } from "../src/mainview/stores/use-theme-store";

const mockSetTheme = vi.fn();
let currentTheme: Theme = "system";

vi.mock("../src/mainview/stores/use-theme-store", () => ({
  useThemeStore: Object.assign(
    (sel: (s: Record<string, unknown>) => unknown) =>
      sel({ theme: currentTheme, setTheme: mockSetTheme }),
    {
      getState: () => ({ theme: currentTheme, setTheme: mockSetTheme }),
    },
  ),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) => {
      if (opts) return `${key} ${Object.values(opts).join(" ")}`;
      return key;
    },
  }),
}));

describe("ThemeToggle", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    currentTheme = "system";
  });

  it("renders theme toggle button", () => {
    render(<ThemeToggle />);
    expect(screen.getByTestId("theme-toggle")).toBeInTheDocument();
  });

  it("click cycles theme light -> dark -> system -> light", () => {
    currentTheme = "light";
    const { rerender } = render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(mockSetTheme).toHaveBeenLastCalledWith("dark");

    currentTheme = "dark";
    rerender(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(mockSetTheme).toHaveBeenLastCalledWith("system");

    currentTheme = "system";
    rerender(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(mockSetTheme).toHaveBeenLastCalledWith("light");
  });

  it("displays correct icon for current theme (system = Monitor)", () => {
    currentTheme = "system";
    render(<ThemeToggle />);
    const button = screen.getByTestId("theme-toggle");
    expect(button.querySelector("svg")).toBeInTheDocument();
    expect(button.getAttribute("title")).toContain("system");
  });
});
