const MIN_LONG_PASTE_CHARS = 240;
const MIN_MULTILINE_PASTE_CHARS = 120;
const MIN_PLACEHOLDER_LINES = 3;

export function shouldPasteTextAsPlaceholder(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  if (/^```[\s\S]*```$/u.test(trimmed)) return true;

  const lineCount = trimmed.split(/\r\n|\r|\n/u).length;
  if (lineCount >= MIN_PLACEHOLDER_LINES) return true;
  if (trimmed.length >= MIN_LONG_PASTE_CHARS) return true;
  return lineCount >= 2 && trimmed.length >= MIN_MULTILINE_PASTE_CHARS;
}
