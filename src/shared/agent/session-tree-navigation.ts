import type { TreeEntry } from "../modules/agent";

export interface JsonlTreeEntry {
  id: string;
  parentId: string | null;
  type: string;
  customType?: string;
  label?: string;
}

const ROLLBACK_SKIP_TYPES = new Set([
  "custom",
  "agent_change",
  "model_change",
  "thinking_level_change",
  "tier_models_change",
  "custom_message",
  "session_info",
  "segment_summary",
  "deletion",
  "label",
  "leaf_pointer",
  "fold",
]);

export function parseJsonlTreeEntry(parsed: Record<string, unknown>): JsonlTreeEntry | null {
  if (!parsed.id || !parsed.type) return null;

  let label: string | undefined;
  if (
    parsed.type === "message" &&
    parsed.message &&
    typeof parsed.message === "object" &&
    parsed.message !== null
  ) {
    label = (parsed.message as Record<string, unknown>).role as string | undefined;
  } else if (parsed.customType) {
    label = parsed.customType as string;
  }

  return {
    id: parsed.id as string,
    parentId: (parsed.parentId as string | null | undefined) ?? null,
    type: parsed.type as string,
    customType: parsed.customType as string | undefined,
    label,
  };
}

export function resolveFallbackBranchPoint(
  entries: JsonlTreeEntry[],
  targetId: string,
): { exists: boolean; branchPointId: string | null } {
  const entryById = new Map(entries.map((entry) => [entry.id, entry]));
  const targetEntry = entryById.get(targetId);
  if (!targetEntry) return { exists: false, branchPointId: null };

  let branchPointId: string | null = targetId;
  if (targetEntry.type === "message" && targetEntry.label === "user") {
    branchPointId = targetEntry.parentId;
    while (branchPointId) {
      const ancestor = entryById.get(branchPointId);
      if (!ancestor) break;
      if (!ROLLBACK_SKIP_TYPES.has(ancestor.type)) break;
      branchPointId = ancestor.parentId;
    }
  }

  return { exists: true, branchPointId };
}

export function createLeafPointerEntry(leafId: string | null): string {
  return JSON.stringify({
    type: "leaf_pointer",
    id: `fallback-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
    parentId: null,
    timestamp: new Date().toISOString(),
    leafId,
  });
}

export function mapJsonlEntriesToTreeEntries(entries: JsonlTreeEntry[]): TreeEntry[] {
  return entries.map((entry) => ({
    id: entry.id,
    parentId: entry.parentId,
    type: entry.type,
    label: entry.label,
  }));
}
