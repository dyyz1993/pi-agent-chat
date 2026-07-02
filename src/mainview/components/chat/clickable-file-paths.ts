import type { Element, Root, Text } from "hast";
import { CONTINUE, visit } from "unist-util-visit";

const FILE_PATH_REGEX =
  /(?:^|(?<=[\s,.;:!?()[\]{}'"`]))(\/[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)+\.[a-zA-Z0-9]{1,8}|(?:\.\/|\.\.\/)?[a-zA-Z0-9._-]+\/[a-zA-Z0-9._/-]+\.[a-zA-Z0-9]{1,8})(?=[\s,.;:!?()[\]{}'"`]|$)/g;

const SKIP_TAGS = new Set(["a", "script", "style"]);

export interface FilePathMatch {
  path: string;
  index: number;
  end: number;
}

function isPrecededByUrlProtocol(text: string, matchIndex: number): boolean {
  const before = text.slice(0, matchIndex);
  const protocolIndex = before.lastIndexOf("://");
  if (protocolIndex < 0 || matchIndex - protocolIndex > 200) return false;
  const between = before.slice(protocolIndex + 3);
  return !/\s/u.test(between);
}

function shouldTransformTextParent(parent: Element): boolean {
  if (SKIP_TAGS.has(parent.tagName)) return false;
  if (parent.tagName !== "code") return true;

  const className = parent.properties?.className;
  const classes = Array.isArray(className)
    ? className
    : typeof className === "string"
      ? [className]
      : [];
  return !classes.some((value) => typeof value === "string" && value.startsWith("language-"));
}

export function findFilePaths(text: string): FilePathMatch[] {
  const regex = new RegExp(FILE_PATH_REGEX.source, "g");
  const matches: FilePathMatch[] = [];
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const raw = match[0];
    const path = match[1];
    const index = match.index + raw.indexOf(path);
    if (isPrecededByUrlProtocol(text, index)) continue;
    matches.push({ path, index, end: index + path.length });
  }

  return matches;
}

export function resolveFilePath(projectRoot: string, relativePath: string): string {
  if (relativePath.startsWith("/")) return relativePath;

  const rootParts = projectRoot.replace(/\/+$/u, "").split("/").filter(Boolean);
  const pathParts = relativePath.split("/").filter(Boolean);
  const result = [...rootParts];

  for (const part of pathParts) {
    if (part === ".") continue;
    if (part === "..") {
      result.pop();
      continue;
    }
    result.push(part);
  }

  return `/${result.join("/")}`;
}

export function transformClickableFilePaths(hast: Root): Root {
  const transforms: Array<{
    parent: Element;
    index: number;
    replacements: Array<Text | Element>;
  }> = [];

  visit(hast, (node: unknown, index: number | undefined, parent: unknown) => {
    if (index === undefined || !parent) return CONTINUE;
    if (typeof node !== "object" || node === null) return CONTINUE;
    if (typeof parent !== "object" || parent === null) return CONTINUE;

    const textNode = node as Partial<Text>;
    const parentNode = parent as Partial<Element>;
    if (textNode.type !== "text" || typeof textNode.value !== "string") return CONTINUE;
    if (parentNode.type !== "element" || !parentNode.tagName) return CONTINUE;
    if (!shouldTransformTextParent(parentNode as Element)) return CONTINUE;

    const matches = findFilePaths(textNode.value);
    if (matches.length === 0) return CONTINUE;

    const replacements: Array<Text | Element> = [];
    let lastEnd = 0;
    for (const match of matches) {
      if (match.index > lastEnd) {
        replacements.push({ type: "text", value: textNode.value.slice(lastEnd, match.index) });
      }
      replacements.push({
        type: "element",
        tagName: "a",
        properties: {
          dataFilePath: match.path,
          href: `#file:${encodeURIComponent(match.path)}`,
        },
        children: [{ type: "text", value: match.path }],
      });
      lastEnd = match.end;
    }

    if (lastEnd < textNode.value.length) {
      replacements.push({ type: "text", value: textNode.value.slice(lastEnd) });
    }

    transforms.push({ parent: parentNode as Element, index, replacements });
    return CONTINUE;
  });

  for (const transform of transforms.reverse()) {
    transform.parent.children.splice(transform.index, 1, ...transform.replacements);
  }

  return hast;
}
