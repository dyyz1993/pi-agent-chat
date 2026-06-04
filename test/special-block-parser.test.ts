import { describe, it, expect } from "vitest";
import {
  parseAttrs,
  parseSpecialBlocks,
  hasSpecialBlocks,
} from "../src/mainview/components/chat/special-block-parser";
import {
  registerSpecialBlock,
  getRegisteredTags,
  getRenderer,
} from "../src/mainview/components/chat/special-block-registry";

describe("parseAttrs", () => {
  it("parses single attribute", () => {
    expect(parseAttrs('name="foo"')).toEqual({ name: "foo" });
  });

  it("parses multiple attributes", () => {
    expect(parseAttrs('from="abc" title="hello" sequence="1"')).toEqual({
      from: "abc",
      title: "hello",
      sequence: "1",
    });
  });

  it("parses empty attribute value", () => {
    expect(parseAttrs('title=""')).toEqual({ title: "" });
  });

  it("parses kebab-case attributes", () => {
    expect(parseAttrs('data-id="123" created-at="now"')).toEqual({
      "data-id": "123",
      "created-at": "now",
    });
  });

  it("returns empty object for empty string", () => {
    expect(parseAttrs("")).toEqual({});
  });

  it("handles attribute values with spaces inside quotes", () => {
    expect(parseAttrs('msg="hello world foo"')).toEqual({ msg: "hello world foo" });
  });

  it("handles attribute values with special chars", () => {
    expect(parseAttrs('path="/foo/bar/baz.ts" elapsed="1.5s"')).toEqual({
      path: "/foo/bar/baz.ts",
      elapsed: "1.5s",
    });
  });

  it("ignores malformed attributes without quotes", () => {
    expect(parseAttrs("name=foo")).toEqual({});
  });
});

const SKILL_TAG = new Set(["skill"]);
const MULTI_TAGS = new Set(["skill", "delegate-reply", "task-result"]);

describe("parseSpecialBlocks", () => {
  it("returns single text segment for plain text", () => {
    const result = parseSpecialBlocks("hello world", SKILL_TAG);
    expect(result).toEqual([{ type: "text", text: "hello world" }]);
  });

  it("returns empty array for empty string", () => {
    const result = parseSpecialBlocks("", SKILL_TAG);
    expect(result).toEqual([]);
  });

  it("parses a single skill block", () => {
    const input = '<skill name="test-skill" location="/path/to/skill">\nbody content\n</skill>';
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("special-block");
    if (result[0].type !== "special-block") return;
    expect(result[0].tag).toBe("skill");
    expect(result[0].attrs).toEqual({ name: "test-skill", location: "/path/to/skill" });
    expect(result[0].body).toBe("body content");
    expect(result[0].raw).toBe(input);
  });

  it("parses text before and after a block", () => {
    const input = 'prefix text\n<skill name="x" location="/y">\nbody\n</skill>\nsuffix text';
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "text", text: "prefix text\n" });
    expect(result[1].type).toBe("special-block");
    expect(result[2]).toEqual({ type: "text", text: "\nsuffix text" });
  });

  it("parses multiple blocks of the same tag", () => {
    const input = [
      '<skill name="a" location="/a">\nA body\n</skill>',
      '<skill name="b" location="/b">\nB body\n</skill>',
    ].join("\n---\n");
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("special-block");
    expect(result[1]).toEqual({ type: "text", text: "\n---\n" });
    expect(result[2].type).toBe("special-block");
  });

  it("parses delegate-reply with all attributes", () => {
    const input =
      '<delegate-reply from="5cfc-abc" title="test title" sequence="2" createdAt="12345" elapsed="3s" historyCount="5">\nreply content here\n</delegate-reply>';
    const tags = new Set(["delegate-reply"]);
    const result = parseSpecialBlocks(input, tags);
    expect(result).toHaveLength(1);
    if (result[0].type !== "special-block") return;
    expect(result[0].tag).toBe("delegate-reply");
    expect(result[0].attrs).toEqual({
      from: "5cfc-abc",
      title: "test title",
      sequence: "2",
      createdAt: "12345",
      elapsed: "3s",
      historyCount: "5",
    });
    expect(result[0].body).toBe("reply content here");
  });

  it("handles multiple different tag types", () => {
    const input = [
      '<skill name="s1" location="/s">\nskill body\n</skill>',
      '<delegate-reply from="abc" title="" sequence="1" createdAt="0" elapsed="0s" historyCount="1">\nreply\n</delegate-reply>',
    ].join("\n");
    const result = parseSpecialBlocks(input, MULTI_TAGS);
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("special-block");
    if (result[0].type === "special-block") expect(result[0].tag).toBe("skill");
    expect(result[1]).toEqual({ type: "text", text: "\n" });
    expect(result[2].type).toBe("special-block");
    if (result[2].type === "special-block") expect(result[2].tag).toBe("delegate-reply");
  });

  it("ignores unregistered tags", () => {
    const input = '<unknown-tag foo="bar">\nbody\n</unknown-tag>';
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toEqual([{ type: "text", text: input }]);
  });

  it("only parses registered tags when mixed with unregistered", () => {
    const input =
      '<unknown foo="bar">\nignore me\n</unknown>\n<skill name="s" location="/p">\nreal\n</skill>';
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("text");
    if (result[0].type === "text") {
      expect(result[0].text).toContain("<unknown");
    }
    expect(result[1].type).toBe("special-block");
  });

  it("handles empty body", () => {
    const input = '<skill name="x" location="/y">\n\n</skill>';
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toHaveLength(1);
    if (result[0].type === "special-block") {
      expect(result[0].body).toBe("");
    }
  });

  it("handles multiline body with special characters", () => {
    const body = 'line 1\nline 2 with "quotes"\nline 3 with <tags>\nline 4 with & ampersand';
    const input = `<skill name="x" location="/y">\n${body}\n</skill>`;
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toHaveLength(1);
    if (result[0].type === "special-block") {
      expect(result[0].body).toBe(body);
    }
  });

  it("preserves raw text exactly", () => {
    const input = '<skill name="x" location="/y">\n  indented\n</skill>';
    const result = parseSpecialBlocks(input, SKILL_TAG);
    if (result[0].type === "special-block") {
      expect(result[0].raw).toBe(input);
    }
  });

  it("handles self-closing-ish tag pattern (no match)", () => {
    const input = '<skill name="x" location="/y" />';
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toEqual([{ type: "text", text: input }]);
  });

  it("handles nested-looking but not actually nested tags", () => {
    const input = '<skill name="x" location="/y">\ntext with <b>html</b> inside\n</skill>';
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toHaveLength(1);
    if (result[0].type === "special-block") {
      expect(result[0].body).toBe("text with <b>html</b> inside");
    }
  });

  it("handles empty registered tags set", () => {
    const input = '<skill name="x" location="/y">\nbody\n</skill>';
    const result = parseSpecialBlocks(input, new Set());
    expect(result).toEqual([{ type: "text", text: input }]);
  });

  it("handles adjacent blocks with no text between", () => {
    const input =
      '<skill name="a" location="/a">\nA\n</skill><skill name="b" location="/b">\nB\n</skill>';
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toHaveLength(2);
    expect(result[0].type).toBe("special-block");
    expect(result[1].type).toBe("special-block");
  });

  it("handles tag with no attributes", () => {
    const input = "<skill>\nbody\n</skill>";
    const result = parseSpecialBlocks(input, SKILL_TAG);
    expect(result).toHaveLength(1);
    if (result[0].type === "special-block") {
      expect(result[0].attrs).toEqual({});
      expect(result[0].body).toBe("body");
    }
  });
});

describe("hasSpecialBlocks", () => {
  it("returns true when text contains a registered tag", () => {
    expect(hasSpecialBlocks('<skill name="x" location="/y">\nbody\n</skill>', SKILL_TAG)).toBe(
      true,
    );
  });

  it("returns false for plain text", () => {
    expect(hasSpecialBlocks("hello world", SKILL_TAG)).toBe(false);
  });

  it("returns false for unregistered tags", () => {
    expect(hasSpecialBlocks('<unknown foo="bar">\nbody\n</unknown>', SKILL_TAG)).toBe(false);
  });

  it("returns true when any registered tag exists among many", () => {
    const input =
      '<skill name="x" location="/y">\nbody\n</skill> and <delegate-reply from="a" title="" sequence="1" createdAt="0" elapsed="0s" historyCount="0">\nbody\n</delegate-reply>';
    expect(hasSpecialBlocks(input, MULTI_TAGS)).toBe(true);
  });

  it("returns false for empty string", () => {
    expect(hasSpecialBlocks("", SKILL_TAG)).toBe(false);
  });

  it("returns false for tag without closing", () => {
    expect(hasSpecialBlocks('<skill name="x" location="/y">', SKILL_TAG)).toBe(false);
  });
});

describe("special-block-registry", () => {
  it("registers and retrieves a renderer", () => {
    const FakeRenderer = () => null;
    registerSpecialBlock("test-tag-1", FakeRenderer);
    expect(getRenderer("test-tag-1")).toBe(FakeRenderer);
  });

  it("returns null for unregistered tag", () => {
    expect(getRenderer("nonexistent")).toBeNull();
  });

  it("getRegisteredTags returns registered tags", () => {
    const tags = getRegisteredTags();
    expect(tags.has("test-tag-1")).toBe(true);
  });

  it("overwrites existing renderer on re-register", () => {
    const Renderer1 = () => null;
    const Renderer2 = () => null;
    registerSpecialBlock("test-tag-overwrite", Renderer1);
    expect(getRenderer("test-tag-overwrite")).toBe(Renderer1);
    registerSpecialBlock("test-tag-overwrite", Renderer2);
    expect(getRenderer("test-tag-overwrite")).toBe(Renderer2);
  });
});
