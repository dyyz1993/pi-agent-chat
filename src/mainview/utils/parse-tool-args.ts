/**
 * Parse a JSON-encoded tool args string into a plain object.
 *
 * @returns the parsed object, or `null` if `args` is empty/undefined or not a
 *   JSON object (e.g. plain command strings, malformed JSON).
 */
export function parseToolArgs(args: string | undefined): Record<string, unknown> | null {
  if (!args) return null;
  try {
    const parsed = JSON.parse(args) as unknown;
    return parsed && typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
