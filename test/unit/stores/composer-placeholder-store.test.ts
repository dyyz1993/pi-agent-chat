import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  composeInputWithPlaceholders,
  persistComposerPlaceholders,
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

function longTextPlaceholder(text: string): ComposerPlaceholder {
  return {
    id: "long-1",
    type: "longContent",
    text,
    title: "pasted-content-long-1.txt",
    createdAt: 1,
    expanded: false,
    originalLength: text.length,
    lineCount: text.split(/\r\n|\r|\n/u).length,
    path: "/tmp/pi-agent-chat-pastes/pasted-content-long-1.txt",
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

  it("stores long pasted content with a temp path and full original text", () => {
    const text = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n");

    const id = useComposerPlaceholderStore.getState().addLongContentPaste(text);

    const placeholder = useComposerPlaceholderStore.getState().placeholders[0];
    expect(id).toBe(placeholder.id);
    expect(placeholder).toMatchObject({
      type: "longContent",
      text,
      originalLength: text.length,
      lineCount: 80,
    });
    expect(placeholder.path).toMatch(
      /^\/tmp\/pi-agent-chat-pastes\/pasted-content-[a-z0-9]+\.txt$/,
    );
  });

  it("serializes long pasted content as a compact long-content XML block", () => {
    const text = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join("\n");

    const serialized = serializeComposerPlaceholders([longTextPlaceholder(text)]);

    expect(serialized).toContain(
      '<long-content path="/tmp/pi-agent-chat-pastes/pasted-content-long-1.txt"',
    );
    expect(serialized).toContain(`originalLength="${text.length}"`);
    expect(serialized).toContain('summary="pasted-content-long-1.txt"');
    expect(serialized).toContain("第 1-");
    expect(serialized).toContain("省略中间");
    expect(serialized).toContain("line 80");
    expect(serialized).toContain("</long-content>");
    expect(serialized).not.toContain("line 40");
  });

  it("persists long pasted content before sending", async () => {
    const text = "x".repeat(2_100);
    const placeholder = longTextPlaceholder(text);
    const write = vi.fn(async () => undefined);

    await persistComposerPlaceholders([placeholder], write);

    expect(write).toHaveBeenCalledWith(placeholder.path, text);
  });
});
