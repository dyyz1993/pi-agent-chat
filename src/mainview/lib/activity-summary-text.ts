const SENTENCE_SPLIT_RE =
  /\n+|(?<=[。！？!?；;])\s*|(?<=\.{3})\s*|(?<=…)\s*|(?<=[:：])\s+/u;

function compactWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function splitIntoSegments(text: string): string[] {
  return text
    .split(SENTENCE_SPLIT_RE)
    .map((segment) => compactWhitespace(segment))
    .filter(Boolean);
}

function dedupeSegments(segments: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const segment of segments) {
    if (seen.has(segment)) continue;
    seen.add(segment);
    deduped.push(segment);
  }
  return deduped;
}

export function summarizeActivityText(input: string | string[], max: number): string {
  const sources = Array.isArray(input) ? input : [input];
  const compactSource = compactWhitespace(sources.join(" "));
  if (!compactSource) return "";

  const segments = dedupeSegments(sources.flatMap(splitIntoSegments));
  if (segments.length === 0) {
    return truncate(compactSource, max);
  }

  let best = segments[segments.length - 1] ?? compactSource;
  for (const segment of segments) {
    if (segment.length >= best.length) {
      best = segment;
    }
  }

  return truncate(best || compactSource, max);
}
