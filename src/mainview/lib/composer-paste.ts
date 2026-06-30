export const MIN_LONG_PASTE_CHARS = 2_000;
const MIN_PLACEHOLDER_LINES = 20;

export function shouldPasteTextAsPlaceholder(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (/^```[\s\S]*```$/u.test(trimmed)) return true;

  const lineCount = trimmed.split(/\r\n|\r|\n/u).length;
  if (lineCount >= MIN_PLACEHOLDER_LINES) return true;
  return trimmed.length >= MIN_LONG_PASTE_CHARS;
}
