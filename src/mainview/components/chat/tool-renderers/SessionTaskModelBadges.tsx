import type { ReactNode } from "react";

export interface SessionTaskModelInfo {
  tier?: string | null;
  model?: string | null;
  provider?: string | null;
  thinkingLevel?: string | null;
}

type SessionTaskModelBadgesProps = SessionTaskModelInfo;

const TIER_LABELS: Record<string, string> = {
  fast: "Fast",
  pro: "Pro",
  max: "Max",
};

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function normalizeSessionTaskModelInfo(info: SessionTaskModelInfo): SessionTaskModelInfo {
  return {
    tier: clean(info.tier),
    model: clean(info.model),
    provider: clean(info.provider),
    thinkingLevel: clean(info.thinkingLevel),
  };
}

export function mergeSessionTaskModelInfo(
  primary: SessionTaskModelInfo,
  fallback: SessionTaskModelInfo,
): SessionTaskModelInfo {
  const normalizedPrimary = normalizeSessionTaskModelInfo(primary);
  const normalizedFallback = normalizeSessionTaskModelInfo(fallback);
  const tier = normalizedPrimary.tier ?? (normalizedPrimary.model ? undefined : normalizedFallback.tier);
  return {
    tier,
    model: normalizedPrimary.model ?? normalizedFallback.model,
    provider: normalizedPrimary.provider ?? normalizedFallback.provider,
    thinkingLevel: normalizedPrimary.thinkingLevel ?? normalizedFallback.thinkingLevel,
  };
}

function formatTier(value: string | null | undefined): string | undefined {
  const normalized = clean(value)?.toLowerCase();
  if (!normalized) return undefined;
  return TIER_LABELS[normalized] ?? normalized.slice(0, 1).toUpperCase() + normalized.slice(1);
}

function formatModel(model: string | null | undefined, provider?: string | null): string | undefined {
  const raw = clean(model);
  if (!raw) return undefined;
  const providerPrefix = clean(provider);
  const withoutProvider =
    providerPrefix && raw.startsWith(`${providerPrefix}/`)
      ? raw.slice(providerPrefix.length + 1)
      : raw;
  return withoutProvider.split("/").filter(Boolean).pop() ?? withoutProvider;
}

function formatThinking(value: string | null | undefined): string | undefined {
  const normalized = clean(value);
  if (!normalized || normalized.toLowerCase() === "off") return undefined;
  return `Think ${normalized}`;
}

function badgeClass(kind: "tier" | "model" | "thinking"): string {
  const base = "shrink-0 text-[10px] px-1 py-0.5 rounded font-mono";
  if (kind === "tier") return `${base} bg-status-info/10 text-status-info`;
  if (kind === "thinking") return `${base} bg-status-warning/10 text-status-warning`;
  return `${base} bg-surface-hover/60 text-text-tertiary`;
}

export function SessionTaskModelBadges({
  tier,
  model,
  provider,
  thinkingLevel,
}: SessionTaskModelBadgesProps): ReactNode {
  const tierLabel = formatTier(tier);
  const modelLabel = tierLabel ? undefined : formatModel(model, provider);
  const thinkingLabel = formatThinking(thinkingLevel);

  return (
    <>
      {tierLabel && <span className={badgeClass("tier")}>{tierLabel}</span>}
      {modelLabel && <span className={badgeClass("model")}>{modelLabel}</span>}
      {thinkingLabel && <span className={badgeClass("thinking")}>{thinkingLabel}</span>}
    </>
  );
}
