function pad(n: number): string {
  return "  ".repeat(n);
}

function quoteIfNeeds(s: string): string {
  if (
    s === "" ||
    s === "true" ||
    s === "false" ||
    s === "null" ||
    s === "~" ||
    /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(s) ||
    /[:{}[\],&*?|>!%#@`'"\\]/.test(s) ||
    s !== s.trim() ||
    s.startsWith(" ") ||
    s.endsWith(" ") ||
    s.includes("\n")
  ) {
    return JSON.stringify(s);
  }
  return s;
}

function toYamlValue(value: unknown, indent: number): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return quoteIfNeeds(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    const lines: string[] = [];
    for (const item of value) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length > 0) {
          const [fk, fv] = entries[0];
          lines.push(`${pad(indent)}- ${quoteIfNeeds(String(fk))}: ${inlineOrBlock(fv, indent + 2)}`);
          for (let i = 1; i < entries.length; i++) {
            const [k, v] = entries[i];
            lines.push(`${pad(indent + 2)}${quoteIfNeeds(String(k))}: ${inlineOrBlock(v, indent + 2)}`);
          }
        } else {
          lines.push(`${pad(indent)}- {}`);
      }
      } else {
        lines.push(`${pad(indent)}- ${toYamlValue(item, indent + 2)}`);
      }
    }
    return "\n" + lines.join("\n");
  }

  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return "{}";
    const lines: string[] = [];
    for (const [k, v] of entries) {
      lines.push(`${pad(indent)}${quoteIfNeeds(k)}: ${inlineOrBlock(v, indent)}`);
    }
    return "\n" + lines.join("\n");
  }

  return String(value);
}

function inlineOrBlock(value: unknown, parentIndent: number): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return quoteIfNeeds(value);
  return toYamlValue(value, parentIndent + 1);
}

export function jsonToYaml(input: string): string {
  if (!input || !input.trim()) return "";

  try {
    const parsed = JSON.parse(input);
    return toYamlValue(parsed, 0).trimStart();
  } catch {
    return input;
  }
}

export function tryFormatAsYaml(input: string): string {
  if (!input || !input.trim()) return "";

  const trimmed = input.trim();

  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return toYamlValue(parsed, 0).trimStart();
    } catch {
      return input;
    }
  }

  return input;
}
