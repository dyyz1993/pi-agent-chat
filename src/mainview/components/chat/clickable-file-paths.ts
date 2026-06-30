/**
 * Utilities for detecting file-like paths in Markdown text and transforming
 * HAST trees to make them clickable.
 *
 * File-like paths are plain text segments that look like file paths:
 * - Relative paths: `./foo.ts`, `../foo.tsx`
 * - Project paths: `src/mainview/Xxx.tsx`, `images/screenshot.png`
 *
 * URLs (http://, https://, etc.) are NOT matched.
 * Paths inside <code>, <pre>, <a>, <script>, <style> are NOT transformed.
 */

import { visit, CONTINUE } from "unist-util-visit";
import type { Element, Root, Text } from "hast";

/**
 * Regex to detect file-like paths in plain text.
 *
 * Requirements to match:
 * 1. Preceded by whitespace/punctuation or start-of-text
 * 2. NOT preceded by `://` (to exclude URL path segments)
 * 3. Contains a directory separator (`/`) followed by a filename with extension
 * 4. Has a file extension (2-6 letters)
 * 5. Followed by whitespace/punctuation or end-of-text
 *
 * This matches:
 * - `src/mainview/Xxx.tsx`
 * - `./foo/bar.ts`
 * - `../parent/file.jsx`
 * - `images/screenshot.png`
 *
 * Does NOT match:
 * - URLs (http://example.com/file.ts)
 * - Bare filenames without directory (file.ts)
 */
const FILE_PATH_REGEX =
  /(?:^|(?<=[\s,.;:!?()\[\]{}'"`]))((?:\.\/|\.\.\/)?[a-zA-Z0-9._-]+\/[a-zA-Z0-9._\/-]+\.[a-zA-Z]{2,6})(?=[\s,.;:!?()\[\]{}'"`]|$)/g;

/**
 * Check if a match at a given position in text is preceded by a URL protocol
 * (e.g., `://`). If so, it's likely a URL path segment, not a file path.
 */
function isPrecededByUrlProtocol(text: string, matchIndex: number): boolean {
  // Look back for `://` before the matched path
  const before = text.slice(0, matchIndex);
  const lastProtocol = before.lastIndexOf("://");
  if (lastProtocol === -1) return false;
  // If `://` is within the last 200 chars and there's no space/slash
  // between `://` and the match, it's a URL path.
  if (matchIndex - lastProtocol > 200) return false;
  const between = before.slice(lastProtocol + 3);
  // If there's whitespace between the protocol and the match, it's not part of a URL
  return !/\s/.test(between);
}

/** HAST tag names whose text children should NOT be processed for file paths. */
const SKIP_TAGS = new Set(["code", "pre", "a", "script", "style"]);

interface FilePathMatch {
  /** The matched file path text (e.g. "src/mainview/Xxx.tsx"). */
  path: string;
  /** Start index in the original text (points to the first char of `path`). */
  index: number;
  /** End index (exclusive) in the original text. */
  end: number;
}

/**
 * Find all file-like paths in a text string.
 * Returns an array of matches with their positions.
 * Exposed for testing.
 */
export function findFilePaths(text: string): FilePathMatch[] {
  const regex = new RegExp(FILE_PATH_REGEX.source, "g");
  const matches: FilePathMatch[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const rawMatch = match[0];
    const pathValue = match[1];
    const pathIndex = match.index + rawMatch.indexOf(pathValue);

    // Exclude paths that are part of URLs (e.g., https://example.com/file.ts)
    if (isPrecededByUrlProtocol(text, pathIndex)) continue;

    matches.push({
      path: pathValue,
      index: pathIndex,
      end: pathIndex + pathValue.length,
    });
  }
  return matches;
}

/**
 * Simple POSIX-style path resolution without requiring the Node.js `path` module.
 * Works for Vite/browser environments where only forward slashes are used.
 */
export function resolveFilePath(projectRoot: string, relativePath: string): string {
  if (relativePath.startsWith("/")) return relativePath;

  const rootParts = projectRoot.replace(/\/+$/g, "").split("/").filter(Boolean);
  const pathParts = relativePath.split("/").filter(Boolean);

  const resultParts = [...rootParts];
  for (const part of pathParts) {
    if (part === ".") continue;
    if (part === "..") {
      resultParts.pop();
    } else {
      resultParts.push(part);
    }
  }

  return "/" + resultParts.join("/");
}

/**
 * Transform a HAST tree by replacing file-like paths in text nodes
 * with clickable <a data-file-path="..."> elements.
 *
 * Only processes text nodes NOT inside <code>, <pre>, <a>,
 * <script>, or <style> elements.
 *
 * Mutates the tree in-place for performance. Returns the same root.
 */
export function transformClickableFilePaths(hast: Root): Root {
  interface TextTransform {
    parent: Element;
    index: number;
    replacements: Array<Text | Element>;
  }

  const transforms: TextTransform[] = [];

  // Use single-callback visit overload to avoid MDX-aware HAST type conflicts.
  visit(hast, (node: unknown, idx: number | undefined, parent: unknown) => {
    if (idx === undefined || !parent) return CONTINUE;
    if (typeof node !== "object" || !node) return CONTINUE;
    const n = node as { type?: unknown; value?: unknown };
    if (n.type !== "text") return CONTINUE;
    const p = parent as { type?: unknown; tagName?: unknown; children?: unknown };
    if (p.type !== "element" || !p.tagName) return CONTINUE;
    if (SKIP_TAGS.has(p.tagName as string)) return CONTINUE;

    const text = n.value as string;
    const matches = findFilePaths(text);
    if (matches.length === 0) return CONTINUE;

    const replacements: Array<Text | Element> = [];
    let lastEnd = 0;

    for (const m of matches) {
      if (m.index > lastEnd) {
        replacements.push({ type: "text" as const, value: text.slice(lastEnd, m.index) });
      }
      replacements.push({
        type: "element",
        tagName: "a",
        properties: { dataFilePath: m.path },
        children: [{ type: "text" as const, value: m.path }],
      });
      lastEnd = m.end;
    }

    if (lastEnd < text.length) {
      replacements.push({ type: "text" as const, value: text.slice(lastEnd) });
    }

    transforms.push({ parent: p as Element, index: idx, replacements });
    return CONTINUE;
  });

  // Apply transforms in reverse order to preserve sibling indices
  for (const t of transforms.reverse()) {
    t.parent.children.splice(t.index, 1, ...t.replacements);
  }

  return hast;
}
