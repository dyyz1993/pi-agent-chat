import { beforeEach, describe, expect, it } from "vitest";
import {
  composeInputWithPlaceholders,
  serializeComposerPlaceholders,
  useComposerPlaceholderStore,
  type ComposerPlaceholder,
} from "../../../src/mainview/stores/use-composer-placeholder-store";

function quotePlaceholder(text: string, title = "snippet"): ComposerPlaceholder {
  return {
    id: "quote-1",
    type: "textQuote",
    text,
    title,
    createdAt: 1,
    expanded: false,
  };
}

describe("composer placeholder store", () => {
  beforeEach(() => {
    useComposerPlaceholderStore.getState().clearPlaceholders();
  });

  it("stores selected text as a collapsed placeholder instead of mutating the input", () => {
    const id = useComposerPlaceholderStore.getState().addTextQuote("hello\nworld");

    const placeholder = useComposerPlaceholderStore.getState().placeholders[0];
    expect(id).toBe(placeholder.id);
    expect(placeholder).toMatchObject({
      type: "textQuote",
      text: "hello\nworld",
      title: "hello world",
      expanded: false,
    });
  });

  it("serializes placeholders as fenced text only at send time", () => {
    expect(serializeComposerPlaceholders([quotePlaceholder("hello\nworld", "hello")])).toBe(
      "引用 1: hello\n```text\nhello\nworld\n```",
    );
  });

  it("serializes session references as @session context blocks at send time", () => {
    const id = useComposerPlaceholderStore.getState().addSessionReference({
      sessionId: "sess-cn",
      title: "中文验证会话",
      description: "项目 A · Session · sess-cn",
    });

    const placeholder = useComposerPlaceholderStore.getState().placeholders[0];
    expect(id).toBe(placeholder.id);
    expect(placeholder).toMatchObject({
      type: "sessionRef",
      text: "@session:sess-cn",
      title: "中文验证会话",
      sessionId: "sess-cn",
      expanded: false,
    });
    expect(serializeComposerPlaceholders([placeholder])).toBe(
      "引用会话 1: 中文验证会话\n@session:sess-cn",
    );
  });

  it("uses a longer fence when quoted text contains backticks", () => {
    expect(serializeComposerPlaceholders([quotePlaceholder("before\n```js\nx\n```\nafter")])).toBe(
      "引用 1: snippet\n````text\nbefore\n```js\nx\n```\nafter\n````",
    );
  });

  it("combines draft input and placeholder context deterministically", () => {
    expect(
      composeInputWithPlaceholders("please explain  \n", [quotePlaceholder("line one\nline two")]),
    ).toBe("please explain\n\n引用 1: snippet\n```text\nline one\nline two\n```");
  });
});
