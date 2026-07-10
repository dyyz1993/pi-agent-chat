import type { Element, Root } from "hast";
import { describe, expect, it } from "vitest";
import {
  findFilePaths,
  resolveFilePath,
  transformClickableFilePaths,
} from "../../../src/mainview/components/chat/clickable-file-paths";

function text(value: string) {
  return { type: "text" as const, value };
}

function root(children: Root["children"]): Root {
  return { type: "root", children };
}

function paragraph(value: string): Element {
  return { type: "element", tagName: "p", properties: {}, children: [text(value)] };
}

function firstChildElement(node: Root | Element): Element {
  const child = node.children[0];
  expect(child?.type).toBe("element");
  return child as Element;
}

describe("findFilePaths", () => {
  it("detects common relative and project file paths", () => {
    expect(findFilePaths("Check src/mainview/Xxx.tsx")[0]?.path).toBe("src/mainview/Xxx.tsx");
    expect(findFilePaths("See ./foo/bar.ts")[0]?.path).toBe("./foo/bar.ts");
    expect(findFilePaths("Import ../parent/file.jsx")[0]?.path).toBe("../parent/file.jsx");
    expect(findFilePaths("Optional .ion/workflow.md")[0]?.path).toBe(".ion/workflow.md");
    expect(findFilePaths("Open /tmp/pi-e2e-click-path.md")[0]?.path).toBe(
      "/tmp/pi-e2e-click-path.md",
    );
    expect(findFilePaths("Screenshot images/screenshot.png")[0]?.path).toBe(
      "images/screenshot.png",
    );
  });

  it("detects multiple paths and preserves indexes", () => {
    const matches = findFilePaths("prefix src/a.ts and src/b.tsx");
    expect(matches.map((match) => match.path)).toEqual(["src/a.ts", "src/b.tsx"]);
    expect(matches[0]).toMatchObject({ index: 7, end: 15 });
  });

  it("does not match urls or bare filenames", () => {
    expect(findFilePaths("See https://example.com/file.ts")).toHaveLength(0);
    expect(findFilePaths("See ftp://example.com/path/file.ts")).toHaveLength(0);
    expect(findFilePaths("Open File.tsx")).toHaveLength(0);
  });

  it("matches paths in raw markdown link text before HAST filtering", () => {
    const matches = findFilePaths("[source](src/mainview/Xxx.tsx)");
    expect(matches.map((match) => match.path)).toEqual(["src/mainview/Xxx.tsx"]);
  });
});

describe("resolveFilePath", () => {
  it("resolves relative paths against the project root", () => {
    expect(resolveFilePath("/Users/me/project", "src/mainview/Xxx.tsx")).toBe(
      "/Users/me/project/src/mainview/Xxx.tsx",
    );
    expect(resolveFilePath("/project", "./src/file.ts")).toBe("/project/src/file.ts");
    expect(resolveFilePath("/project/subdir", "../file.ts")).toBe("/project/file.ts");
    expect(resolveFilePath("/project/a/b/c", "../../d/file.ts")).toBe("/project/a/d/file.ts");
  });

  it("keeps absolute paths unchanged", () => {
    expect(resolveFilePath("/project", "/absolute/path/file.ts")).toBe("/absolute/path/file.ts");
  });
});

describe("transformClickableFilePaths", () => {
  it("wraps text file paths as file links", () => {
    const tree = root([paragraph("Open src/mainview/Xxx.tsx please")]);
    transformClickableFilePaths(tree);

    const p = firstChildElement(tree);
    expect(p.children).toHaveLength(3);
    expect(p.children[1]).toMatchObject({
      type: "element",
      tagName: "a",
      properties: {
        dataFilePath: "src/mainview/Xxx.tsx",
        href: "#file:src%2Fmainview%2FXxx.tsx",
      },
    });
  });

  it("does not transform normal markdown links that are already anchors", () => {
    const tree = root([
      {
        type: "element",
        tagName: "a",
        properties: { href: "src/mainview/Xxx.tsx" },
        children: [text("source")],
      },
    ]);
    transformClickableFilePaths(tree);

    const link = firstChildElement(tree);
    expect(link.properties).toEqual({ href: "src/mainview/Xxx.tsx" });
    expect(link.children).toEqual([text("source")]);
  });

  it("transforms inline code paths but leaves language code blocks alone", () => {
    const tree = root([
      {
        type: "element",
        tagName: "code",
        properties: {},
        children: [text("src/mainview/Xxx.tsx")],
      },
      {
        type: "element",
        tagName: "code",
        properties: { className: ["language-ts"] },
        children: [text("import './src/mainview/Xxx.tsx';")],
      },
    ]);
    transformClickableFilePaths(tree);

    const inlineCode = firstChildElement(tree);
    expect(inlineCode.children[0]).toMatchObject({
      type: "element",
      tagName: "a",
      properties: { dataFilePath: "src/mainview/Xxx.tsx" },
    });

    const blockCode = tree.children[1] as Element;
    expect(blockCode.children).toEqual([text("import './src/mainview/Xxx.tsx';")]);
  });

  it("does not transform urls in text nodes", () => {
    const tree = root([paragraph("See https://example.com/src/file.ts")]);
    transformClickableFilePaths(tree);

    const p = firstChildElement(tree);
    expect(p.children).toEqual([text("See https://example.com/src/file.ts")]);
  });
});
