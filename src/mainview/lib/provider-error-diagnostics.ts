import type { ProviderRequestContextUsage } from "../types";

const SUSPECTED_CONTEXT_ERROR_RE =
  /\b400\b|upstream request failed|context|payload|token|too large|request.*large/i;

const LARGE_REQUEST_TOKEN_THRESHOLD = 50_000;
const LARGE_REQUEST_CHAR_THRESHOLD = 200_000;
const LARGE_REQUEST_MESSAGE_THRESHOLD = 120;
const LARGE_REQUEST_TOOL_THRESHOLD = 30;

function readRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function isProviderRequestContextUsage(value: unknown): value is ProviderRequestContextUsage {
  const record = readRecord(value);
  if (!record) return false;
  return (
    record.version === 1 &&
    typeof record.provider === "string" &&
    typeof record.modelId === "string" &&
    typeof record.timestamp === "string" &&
    typeof record.payloadChars === "number" &&
    typeof record.payloadTokens === "number" &&
    Array.isArray(record.sections)
  );
}

export function providerRequestFromCustomEntry(entry: unknown): ProviderRequestContextUsage | undefined {
  const record = readRecord(entry);
  if (!record || record.customType !== "provider_request_context_usage") return undefined;
  return isProviderRequestContextUsage(record.data) ? record.data : undefined;
}

export function providerRequestFromMessage(message: unknown): ProviderRequestContextUsage | undefined {
  const record = readRecord(message);
  if (!record) return undefined;
  return isProviderRequestContextUsage(record.providerRequest) ? record.providerRequest : undefined;
}

export function getProviderRequestSection(
  providerRequest: ProviderRequestContextUsage | undefined,
  sectionId: "system" | "messages" | "tools" | "options",
) {
  return providerRequest?.sections.find((section) => section.id === sectionId);
}

export function isLargeProviderRequest(providerRequest: ProviderRequestContextUsage | undefined): boolean {
  if (!providerRequest) return false;
  const messageCount = getProviderRequestSection(providerRequest, "messages")?.count ?? 0;
  const toolCount = getProviderRequestSection(providerRequest, "tools")?.count ?? 0;
  return (
    providerRequest.payloadTokens >= LARGE_REQUEST_TOKEN_THRESHOLD ||
    providerRequest.payloadChars >= LARGE_REQUEST_CHAR_THRESHOLD ||
    messageCount >= LARGE_REQUEST_MESSAGE_THRESHOLD ||
    toolCount >= LARGE_REQUEST_TOOL_THRESHOLD
  );
}

export function isSuspectedContextProviderError(
  errorDetail: string,
  providerRequest: ProviderRequestContextUsage | undefined,
): boolean {
  return Boolean(providerRequest && isLargeProviderRequest(providerRequest) && SUSPECTED_CONTEXT_ERROR_RE.test(errorDetail));
}

export function formatCompactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return String(value);
}

export function summarizeProviderRequest(providerRequest: ProviderRequestContextUsage): string {
  const messages = getProviderRequestSection(providerRequest, "messages")?.count;
  const tools = getProviderRequestSection(providerRequest, "tools")?.count;
  return [
    `${providerRequest.provider}/${providerRequest.modelId}`,
    `${formatCompactNumber(providerRequest.payloadTokens)} tokens`,
    messages !== undefined ? `${messages} messages` : undefined,
    tools !== undefined ? `${tools} tools` : undefined,
    readString(providerRequest.api),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function findNearestProviderRequest(
  customEntries: unknown[],
  beforeTimestamp: number,
): ProviderRequestContextUsage | undefined {
  let best: { timestamp: number; providerRequest: ProviderRequestContextUsage } | undefined;
  for (const entry of customEntries) {
    const record = readRecord(entry);
    const providerRequest = providerRequestFromCustomEntry(record);
    if (!providerRequest) continue;
    const timestamp = readNumber(record?.timestamp) ?? Date.parse(providerRequest.timestamp);
    if (!Number.isFinite(timestamp) || timestamp > beforeTimestamp) continue;
    if (!best || timestamp > best.timestamp) {
      best = { timestamp, providerRequest };
    }
  }
  return best?.providerRequest;
}
