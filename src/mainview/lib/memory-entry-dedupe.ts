function getMemoryInjectDataKey(data: unknown): string | undefined {
  const record = data as Record<string, unknown> | undefined;
  const fingerprint = typeof record?.fingerprint === "string" ? record.fingerprint : undefined;
  return fingerprint && fingerprint.length > 0 ? fingerprint : undefined;
}

export function getMemoryOperationIdFromData(data: unknown): string | undefined {
  const record = data as Record<string, unknown> | undefined;
  return typeof record?.operationId === "string" ? record.operationId : undefined;
}

export function getMemoryQueryFromData(data: unknown): string | undefined {
  const record = data as Record<string, unknown> | undefined;
  const query =
    typeof record?._prefetchQuery === "string"
      ? record._prefetchQuery
      : typeof record?.query === "string"
        ? record.query
        : undefined;
  const normalized = query?.trim().replace(/\s+/g, " ");
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function getMemorySelectedFileCount(data: unknown): number {
  const record = data as Record<string, unknown> | undefined;
  return Array.isArray(record?.selectedFiles) ? record.selectedFiles.length : 0;
}

export function getMemoryEntryScore(customType: string, data: unknown): number {
  const record = data as Record<string, unknown> | undefined;
  const injectedBytes = typeof record?.injectedBytes === "number" ? record.injectedBytes : 0;
  const originalBytes = typeof record?.originalBytes === "number" ? record.originalBytes : 0;
  const selectedFileScore = getMemorySelectedFileCount(data) * 500;
  const sourceScore = record?.source === "learning" ? -1_000_000 : 0;

  if (customType === "memory_inject") {
    const isSkipped = record?.alreadyInjected === true || record?.skipped === true;
    return (
      sourceScore +
      (isSkipped ? -10_000 : 10_000) +
      injectedBytes +
      originalBytes +
      selectedFileScore
    );
  }

  if (customType === "memory_prefetch_result") {
    const layer = typeof record?.layer === "string" ? record.layer : "";
    const layerScore = layer === "llm" ? 300 : layer === "auto" ? 200 : layer === "skip" ? 100 : 0;
    return sourceScore + injectedBytes + selectedFileScore + layerScore;
  }

  return 0;
}

export function getMemoryCustomDedupeKey(
  customType: string,
  data: unknown,
): string | undefined {
  if (customType === "memory_prefetch_result") {
    const query = getMemoryQueryFromData(data);
    if (query) return `prefetch-query:${query}`;
    const operationId = getMemoryOperationIdFromData(data);
    return operationId ? `prefetch:${operationId}` : undefined;
  }

  if (customType === "memory_inject") {
    const query = getMemoryQueryFromData(data);
    if (query) return `inject-query:${query}`;
    const injectKey = getMemoryInjectDataKey(data);
    if (injectKey) return `inject-key:${injectKey}`;
    const operationId = getMemoryOperationIdFromData(data);
    if (operationId) return `inject-op:${operationId}`;
  }

  return undefined;
}
