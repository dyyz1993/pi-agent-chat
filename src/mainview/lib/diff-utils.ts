/**
 * Parse a unified diff string and reconstruct { oldValue, newValue }.
 *
 * Used when the backend returns `oldContent: null` or `newContent: null`
 * but provides a valid `unifiedDiff` — we can extract the old/new content
 * from the diff itself.
 */
export function parseUnifiedDiff(
  diff: string,
): { oldValue: string; newValue: string } | null {
  if (!diff) return null;
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("@@")) continue;
    if (line.startsWith("-")) {
      oldLines.push(line.slice(1));
    } else if (line.startsWith("+")) {
      newLines.push(line.slice(1));
    } else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    }
  }
  return { oldValue: oldLines.join("\n"), newValue: newLines.join("\n") };
}

/**
 * Reconstruct missing oldContent / newContent from a unified diff.
 *
 * Returns `{ oldContent, newContent }` with nulls replaced by parsed values
 * when possible. Non-null values are kept as-is.
 */
export function reconstructDiffContent(options: {
  oldContent: string | null;
  newContent: string | null;
  unifiedDiff: string | null;
}): { oldContent: string | null; newContent: string | null } {
  const { oldContent, newContent, unifiedDiff } = options;

  // Both present — nothing to reconstruct
  if (oldContent !== null && newContent !== null) {
    return { oldContent, newContent };
  }

  // No diff to parse — fall back to empty string so the viewer can still render
  if (!unifiedDiff) {
    return {
      oldContent: oldContent ?? "",
      newContent: newContent ?? "",
    };
  }

  const parsed = parseUnifiedDiff(unifiedDiff);
  if (!parsed) {
    return {
      oldContent: oldContent ?? "",
      newContent: newContent ?? "",
    };
  }

  return {
    oldContent: oldContent ?? parsed.oldValue,
    newContent: newContent ?? parsed.newValue,
  };
}
