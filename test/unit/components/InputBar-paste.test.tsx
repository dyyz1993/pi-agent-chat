import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InputBar } from "../../../src/mainview/components/chat/InputBar";
import { useChatStore } from "../../../src/mainview/stores/use-chat-store";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        inputPlaceholder: "输入消息",
        inputPlaceholderWithAttachment: "输入消息",
        clearInput: "清除输入",
        expand: "展开",
        collapse: "收起",
        expandInput: "展开输入框",
        collapseInput: "收起输入框",
        prevHistory: "上一条历史消息",
        nextHistory: "下一条历史消息",
      })[key] ?? key,
  }),
}));

function pasteText(text: string) {
  fireEvent.paste(screen.getByTestId("chat-input"), {
    clipboardData: {
      getData: (type: string) => (type === "text/plain" ? text : ""),
      items: [],
    },
  });
}

describe("InputBar paste placeholders", () => {
  beforeEach(() => {
    useChatStore.getState().setInputText("");
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps short pasted text on the normal textarea path", () => {
    const onPasteTextAsPlaceholder = vi.fn(() => true);
    render(<InputBar sessionId="s1" onPasteTextAsPlaceholder={onPasteTextAsPlaceholder} />);

    pasteText("hello world");

    expect(onPasteTextAsPlaceholder).not.toHaveBeenCalled();
  });

  it("turns long pasted text into a placeholder without mutating input text", () => {
    const onPasteTextAsPlaceholder = vi.fn(() => true);
    render(<InputBar sessionId="s1" onPasteTextAsPlaceholder={onPasteTextAsPlaceholder} />);

    const text = "x".repeat(2_000);
    pasteText(text);

    expect(onPasteTextAsPlaceholder).toHaveBeenCalledWith(text);
    expect(useChatStore.getState().inputText).toBe("");
  });
});
