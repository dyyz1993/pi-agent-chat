import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ModelPickerButton } from "../../../src/mainview/components/model-picker/ModelPickerButton";

const storeMocks = vi.hoisted(() => ({
  favorites: new Set<string>(),
  toggleFavorite: vi.fn(),
}));

vi.mock("../../../src/mainview/stores/use-session-store", () => ({
  useSessionStore: (selector: (state: {
    modelFavorites: Set<string>;
    toggleModelFavorite: (modelKey: string) => void;
  }) => unknown) =>
    selector({
      modelFavorites: storeMocks.favorites,
      toggleModelFavorite: storeMocks.toggleFavorite,
    }),
}));

const models = [
  { provider: "openai", id: "gpt-4", name: "GPT-4" },
  { provider: "anthropic", id: "claude-3", name: "Claude 3" },
  { provider: "google", id: "gemini", name: "Gemini" },
  { provider: "zhipu", id: "glm-4", name: "GLM-4" },
];

function openPicker() {
  fireEvent.click(screen.getByRole("button", { name: "--" }));
  return screen.getByPlaceholderText("搜索模型...").closest("[data-model-picker-dropdown]");
}

afterEach(() => {
  cleanup();
  storeMocks.favorites.clear();
  storeMocks.toggleFavorite.mockReset();
});

describe("ModelPickerButton", () => {
  it("should keep all models visible and place favorite models first by default", () => {
    storeMocks.favorites.add("google/gemini");

    render(<ModelPickerButton models={models} value="" onChange={vi.fn()} />);

    const dropdown = openPicker();
    expect(dropdown).not.toBeNull();

    const names = within(dropdown as HTMLElement)
      .getAllByText(/GPT-4|Claude 3|Gemini|GLM-4/)
      .map((node) => node.textContent);

    expect(names).toEqual(["Gemini", "GPT-4", "Claude 3", "GLM-4"]);
  });

  it("should filter to favorite models after toggling favorites-only mode", () => {
    storeMocks.favorites.add("anthropic/claude-3");

    render(<ModelPickerButton models={models} value="" onChange={vi.fn()} />);

    const dropdown = openPicker();
    expect(dropdown).not.toBeNull();

    fireEvent.click(within(dropdown as HTMLElement).getByTitle("仅显示收藏"));

    expect(screen.getByText("Claude 3")).toBeInTheDocument();
    expect(screen.queryByText("GPT-4")).not.toBeInTheDocument();
    expect(screen.queryByText("Gemini")).not.toBeInTheDocument();
    expect(screen.queryByText("GLM-4")).not.toBeInTheDocument();
  });

  it("should pass custom dropdown z-index to the anchored popover", () => {
    render(
      <ModelPickerButton
        models={models}
        value=""
        onChange={vi.fn()}
        dropdownZIndex="z-[100]"
      />,
    );

    const dropdown = openPicker();

    expect(dropdown).toHaveClass("z-[100]");
    expect(dropdown).not.toHaveClass("z-[90]");
  });
});
