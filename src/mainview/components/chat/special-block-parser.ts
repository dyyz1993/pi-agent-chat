export type SpecialBlock = {
  type: "special-block";
  tag: string;
  attrs: Record<string, string>;
  body: string;
  raw: string;
};

export type TextSegment = {
  type: "text";
  text: string;
};

export type ParsedSegment = SpecialBlock | TextSegment;

const ATTR_REGEX = /([\w-]+)="([^"]*)"/g;

export function parseAttrs(attrStr: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  let m: RegExpExecArray | null;
  ATTR_REGEX.lastIndex = 0;
  while ((m = ATTR_REGEX.exec(attrStr)) !== null) {
    attrs[m[1]] = m[2];
  }
  return attrs;
}

const TAG_REGEX = /<([a-zA-Z][\w-]*)((?:\s+[\w-]+="[^"]*")*)\s*>([\s\S]*?)<\/\1>/g;

export function parseSpecialBlocks(
  text: string,
  registeredTags: ReadonlySet<string>,
): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  TAG_REGEX.lastIndex = 0;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TAG_REGEX.exec(text)) !== null) {
    const tag = match[1];
    if (!registeredTags.has(tag)) continue;

    if (match.index > lastIndex) {
      segments.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }

    segments.push({
      type: "special-block",
      tag,
      attrs: parseAttrs(match[2]),
      body: match[3].trim(),
      raw: match[0],
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return segments;
}

export function hasSpecialBlocks(text: string, registeredTags: ReadonlySet<string>): boolean {
  TAG_REGEX.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TAG_REGEX.exec(text)) !== null) {
    if (registeredTags.has(match[1])) return true;
  }
  return false;
}
