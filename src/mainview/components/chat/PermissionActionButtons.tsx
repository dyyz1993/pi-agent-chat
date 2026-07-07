import { useMemo } from "react";

interface PermissionActionOption {
  value: string;
  label: string;
  pattern?: string;
  scope?: "project" | "session";
}

interface PermissionRememberOption {
  id: string;
  label: string;
  subject: string;
  pattern: string;
  scope: "project" | "session";
  action: "allow" | "deny";
  metadata?: Record<string, unknown>;
}

interface PermissionActionButtonsProps {
  options: string[];
  rememberOptions?: PermissionRememberOption[];
  onSelect: (value: string) => void;
}

export type PermissionOneTimeActionIntent = "allow" | "deny";

export function findOneTimePermissionActionValue(
  options: string[] | undefined,
  intent: PermissionOneTimeActionIntent,
): string | undefined {
  const parsed = (options ?? []).map((value) => ({ value, label: cleanPermissionLabel(value) }));
  const matcher = intent === "allow" ? isAllowOnceLabel : isDenyOnceLabel;
  return parsed.find((option) => matcher(option.label))?.value;
}

export function PermissionActionButtons({
  options,
  rememberOptions,
  onSelect,
}: PermissionActionButtonsProps) {
  const actions = useMemo(
    () => buildPermissionActions(options, rememberOptions),
    [options, rememberOptions],
  );
  const rememberAction = actions.find((option) => isRememberAllowLabel(option.label));
  const rememberPattern = rememberAction?.pattern;

  return (
    <div className="space-y-1.5">
      <div
        className={`grid gap-1.5 ${
          actions.length >= 3
            ? "grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1.12fr)]"
            : "grid-cols-2"
        }`}
      >
        {actions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onSelect(option.value)}
            title={option.pattern ? `${option.label}: ${option.pattern}` : option.label}
            className={`flex h-9 min-w-0 items-center justify-center rounded-md border px-2.5 text-center text-[11px] font-medium leading-none transition-colors ${
              isDenyLabel(option.label)
                ? "border-status-error/30 bg-status-error/10 text-status-error hover:bg-status-error/20"
                : isRememberAllowLabel(option.label)
                  ? "border-status-info/30 bg-status-info/10 text-status-info hover:bg-status-info/20"
                  : "border-status-success/30 bg-status-success/15 text-status-success hover:bg-status-success/25"
            }`}
          >
            <span className="truncate">{option.label}</span>
          </button>
        ))}
      </div>
      {rememberPattern && (
        <div className="grid grid-cols-[3.75rem_minmax(0,1fr)] gap-x-2 gap-y-1 rounded-md border border-border-secondary/35 bg-surface-dim/30 px-2 py-1.5">
          <span className="text-[10px] font-medium text-text-tertiary">Match</span>
          <code className="break-all font-mono text-[10px] leading-snug text-text-secondary">
            {rememberPattern}
          </code>
          {rememberAction.scope && (
            <>
              <span className="text-[10px] font-medium text-text-tertiary">Applies</span>
              <span className="text-[10px] leading-snug text-text-secondary">
                {rememberAction.scope === "project" ? "Project settings" : "Current session only"}
              </span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function buildPermissionActions(
  options: string[],
  rememberOptions?: PermissionRememberOption[],
): PermissionActionOption[] {
  const parsed = options.map((value) => ({ value, label: cleanPermissionLabel(value) }));
  const allowOnceValue = findOneTimePermissionActionValue(options, "allow");
  const denyOnceValue = findOneTimePermissionActionValue(options, "deny");
  const allowOnce = parsed.find((option) => option.value === allowOnceValue);
  const denyOnce = parsed.find((option) => option.value === denyOnceValue);
  const rememberAllow = findRememberAllowOption(parsed, rememberOptions);

  if (!allowOnce && !denyOnce) {
    return parsed.slice(0, 3);
  }

  return [allowOnce, rememberAllow, denyOnce].filter(Boolean) as PermissionActionOption[];
}

function cleanPermissionLabel(value: string): string {
  const withoutPrefix = value.replace(/^\d+\.\s*/, "").replace(/^[^\p{L}\p{N}]+/u, "");
  const actionLabels: Record<string, string> = {
    allow_once: "Allow once",
    always_allow_project: "Always allow",
    deny_once: "Deny once",
    always_deny_project: "Always deny",
  };
  return actionLabels[withoutPrefix] ?? withoutPrefix;
}

function isAllowOnceLabel(label: string): boolean {
  return label.toLowerCase() === "allow once";
}

function isDenyOnceLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return normalized === "deny once" || normalized === "deny";
}

function isDenyLabel(label: string): boolean {
  return label.toLowerCase().includes("deny");
}

function isRememberAllowLabel(label: string): boolean {
  const normalized = label.toLowerCase();
  return normalized.startsWith("always allow") || normalized === "allow matching rule";
}

function findRememberAllowOption(
  options: PermissionActionOption[],
  rememberOptions?: PermissionRememberOption[],
): PermissionActionOption | undefined {
  const rememberedAllow = findRememberedAllowRule(rememberOptions);
  const candidates = options.filter((option) => isRememberAllowLabel(option.label));
  const matchedRule = rememberedAllow
    ? candidates.find((option) => option.label.includes(rememberedAllow.label))
    : undefined;
  const broadRule =
    matchedRule ??
    candidates.find((option) => !/\b(exact|this exact|only this)\b/i.test(option.label));
  const selected = broadRule ?? candidates[0];
  if (!selected) return undefined;
  return {
    ...selected,
    label: "Always allow",
    pattern: rememberedAllow?.pattern,
    scope: rememberedAllow?.scope,
  };
}

function findRememberedAllowRule(
  rememberOptions?: PermissionRememberOption[],
): PermissionRememberOption | undefined {
  const allowRules = rememberOptions?.filter((option) => option.action === "allow") ?? [];
  return (
    allowRules.find((option) => !/\b(exact|this exact|only this)\b/i.test(option.label)) ??
    allowRules[0]
  );
}
