import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerPlaceholderBar } from "../../../src/mainview/components/chat/ComposerPlaceholderBar";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";
import { useComposerPlaceholderStore } from "../../../src/mainview/stores/use-composer-placeholder-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        composerQuote: "引用",
        composerQuoteExpand: "展开引用",
        composerQuoteCollapse: "收起引用",
        composerQuoteRemove: "删除引用",
        composerQuoteChars: "字",
        composerQuoteLines: "行",
      })[key] ?? key,
  }),
}));

describe("ComposerPlaceholderBar", () => {
  beforeEach(() => {
    useChatStore.getState().setInputText("");
    useComposerPlaceholderStore.getState().clearPlaceholders();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders selected text as a docked placeholder without mutating the textarea draft", () => {
    useComposerPlaceholderStore
      .getState()
      .addTextQuote("可以继续做\n引用应该像输入框的一部分，但不要污染 textarea");

    render(<ComposerPlaceholderBar />);

    expect(screen.getByTestId("composer-placeholder-bar")).toBeTruthy();
    expect(screen.getByText("引用")).toBeTruthy();
    expect(screen.getByText(/可以继续做/)).toBeTruthy();
    expect(useChatStore.getState().inputText).toBe("");
  });

  it("expands a placeholder to preview the full quote", () => {
    useComposerPlaceholderStore.getState().addTextQuote("第一行\n第二行");

    render(<ComposerPlaceholderBar />);

    fireEvent.click(screen.getByRole("button", { name: "展开引用" }));

    expect(
      screen.getByText((_, element) => element?.tagName === "PRE" && element.textContent === "第一行\n第二行"),
    ).toBeTruthy();
  });
});
