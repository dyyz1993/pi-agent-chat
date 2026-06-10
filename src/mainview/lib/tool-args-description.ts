import { formatFilePath } from "./format-path";

const MAX_DESC_LEN = 120;

function truncate(s: string, max = MAX_DESC_LEN): string {
  const trimmed = s.trim();
  return trimmed.length > max ? trimmed.slice(0, max) + "…" : trimmed;
}

function parseArgs(args: string | undefined): Record<string, unknown> | null {
  if (!args) return null;
  try {
    const raw = JSON.parse(args) as unknown;
    if (raw && typeof raw === "object" && raw !== null) {
      return raw as Record<string, unknown>;
    }
  } catch {
    // not JSON — plain string args
  }
  return null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

export function getToolArgsDescription(
  toolName: string,
  args: string | undefined,
): string | undefined {
  const name = toolName.toLowerCase().trim();
  const parsed = parseArgs(args);

  // Non-JSON args (plain command string): use first line
  // Skip if it looks like broken JSON (starts with { or [) to avoid showing raw braces.
  if (!parsed) {
    if (args && args.trim()) {
      const first = args.trim()[0];
      if (first === "{" || first === "[") return toolName;
      return truncate(args.split("\n")[0]);
    }
    return toolName;
  }

  // 1. Explicit description field always wins
  const explicitDesc = str(parsed.description);
  if (explicitDesc) return truncate(explicitDesc);

  // Common field extractors (ordered by priority)
  const pattern = str(parsed.pattern) ?? str(parsed.query) ?? str(parsed.glob) ?? str(parsed.regex);
  const path =
    str(parsed.path) ?? str(parsed.filePath) ?? str(parsed.file_path) ?? str(parsed.file);
  const url = str(parsed.url) ?? str(parsed.uri);
  const command = str(parsed.command);
  const include = str(parsed.include) ?? str(parsed.includePattern) ?? str(parsed.type);

  // 2. Tool-specific extraction
  if (name === "grep" || name === "rg" || name === "search" || name.includes("grep")) {
    if (pattern) {
      const scope = include ?? (path ? formatFilePath(path) : undefined);
      return truncate(scope ? `${pattern}  (${scope})` : pattern);
    }
  }

  if (name === "glob" || name.includes("glob")) {
    if (pattern) {
      const scope = path ? formatFilePath(path) : undefined;
      return truncate(scope ? `${pattern}  (${scope})` : pattern);
    }
  }

  if (
    name === "web_search" ||
    name === "websearch" ||
    name === "search_web" ||
    name.includes("websearch")
  ) {
    if (pattern) return truncate(pattern);
  }

  if (name === "fetch" || name === "webfetch" || name === "web_fetch" || name.includes("fetch")) {
    if (url) return truncate(url);
  }

  // 3. Generic fallbacks by field priority
  if (command) return truncate(command);
  if (path) return truncate(formatFilePath(path));
  if (pattern) return truncate(pattern);
  if (url) return truncate(url);

  // 4. Last resort: surface the tool name itself so the header is never empty.
  return toolName;
}
