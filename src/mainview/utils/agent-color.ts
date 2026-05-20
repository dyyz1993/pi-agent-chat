const AGENT_COLOR_MAP: Record<string, string> = {
  red: "#EF4444",
  blue: "#3B82F6",
  green: "#22C55E",
  yellow: "#EAB308",
  purple: "#7C3AED",
  orange: "#F97316",
};

export function resolveAgentColor(raw: string | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("#")) return trimmed;
  return AGENT_COLOR_MAP[trimmed.toLowerCase()] ?? null;
}

export function agentColorStyle(
  raw: string | undefined,
): { color: string; bg: string; border: string } | null {
  const hex = resolveAgentColor(raw);
  if (!hex) return null;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return {
    color: hex,
    bg: `rgba(${r}, ${g}, ${b}, 0.12)`,
    border: `rgba(${r}, ${g}, ${b}, 0.30)`,
  };
}
