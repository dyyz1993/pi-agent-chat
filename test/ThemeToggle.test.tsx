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
  THEME_META: {
    light: { label: "Light", group: "light" },
    dark: { label: "Dark", group: "dark" },
    nord: { label: "Nord", group: "dark" },
    solarized: { label: "Solarized", group: "light" },
    "warm-dark": { label: "Warm Dark", group: "dark" },
    rose: { label: "Rosé Pine", group: "dark" },
    latte: { label: "Latte", group: "light" },
    sunset: { label: "Sunset", group: "dark" },
  },
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

  it("click cycles through theme options", () => {
    currentTheme = "light";
    const { rerender } = render(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(mockSetTheme).toHaveBeenLastCalledWith("dark");

    currentTheme = "dark";
    rerender(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(mockSetTheme).toHaveBeenLastCalledWith("nord");

    currentTheme = "nord";
    rerender(<ThemeToggle />);
    fireEvent.click(screen.getByTestId("theme-toggle"));
    expect(mockSetTheme).toHaveBeenLastCalledWith("solarized");
  });

  it("displays correct icon for current theme (system = Monitor)", () => {
    currentTheme = "system";
    render(<ThemeToggle />);
    const button = screen.getByTestId("theme-toggle");
    expect(button.querySelector("svg")).toBeInTheDocument();
    expect(button.getAttribute("title")).toContain("system");
  });
});
