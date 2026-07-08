import { type ElementType, useEffect, useMemo } from "react";
import {
  CheckCircle2,
  Filter,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Trash2,
  XCircle,
} from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { PanelHeader } from "../primitives/PanelHeader";
import { useEffectiveSessionId } from "../../hooks/use-effective-session-id";
import { ProjectRuntimePendingRequests } from "../chat/UIPendingCenter";
import {
  type PermissionRule,
  usePermissionRulesStore,
} from "../../stores/use-permission-rules-store";

const ACTION_STYLE: Record<
  PermissionRule["action"],
  { icon: ElementType; cls: string; label: string }
> = {
  allow: {
    icon: CheckCircle2,
    cls: "text-status-success bg-status-success/10",
    label: "allow",
  },
  deny: {
    icon: XCircle,
    cls: "text-status-error bg-status-error/10",
    label: "deny",
  },
};

function PermissionRuleRow({
  rule,
  pendingDelete,
  onRequestDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  rule: PermissionRule;
  pendingDelete: boolean;
  onRequestDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const action = ACTION_STYLE[rule.action];
  const ActionIcon = action.icon;
  const metadata = rule.metadata ?? {};
  const command =
    typeof metadata.command === "string"
      ? metadata.command
      : typeof metadata.hookCommand === "string"
        ? metadata.hookCommand
        : undefined;

  return (
    <div className="border-b border-border-secondary px-2.5 py-2.5 last:border-b-0 dark:border-surface-code/50">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          className={`mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${action.cls}`}
        >
          <ActionIcon className="h-3 w-3" />
          {action.label}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-semibold text-text-primary">
              {rule.provider}
            </span>
            <span className="text-text-tertiary">/</span>
            <code className="truncate text-xs text-text-secondary">{rule.subject}</code>
          </div>
          <code
            className="mt-1.5 block truncate rounded-md bg-surface-code px-2 py-1 text-xs leading-5 text-accent/80 dark:bg-surface-dim/50"
            title={rule.pattern}
          >
            {rule.pattern}
          </code>
          {command && (
            <code
              className="mt-1 block truncate text-xs leading-5 text-text-tertiary"
              title={command}
            >
              {command}
            </code>
          )}
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-tertiary">
            <span>{rule.scope}</span>
            <span>|</span>
            <span>{formatDate(rule.createdAt)}</span>
            {typeof metadata.matchKind === "string" && (
              <>
                <span>|</span>
                <span>{metadata.matchKind}</span>
              </>
            )}
          </div>
        </div>
        {pendingDelete ? (
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className="rounded-md border border-status-error/30 bg-status-error/10 px-2 py-1.5 text-xs font-medium text-status-error hover:bg-status-error/20"
              onClick={onConfirmDelete}
            >
              Delete
            </button>
            <button
              type="button"
              className="rounded-md border border-border-secondary px-2 py-1.5 text-xs text-text-secondary hover:bg-surface-hover"
              onClick={onCancelDelete}
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="shrink-0 rounded-md p-1.5 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-status-error"
            title="Delete rule"
            onClick={onRequestDelete}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export function PermissionsPanel() {
  const activeSessionId = useEffectiveSessionId();
  const session = usePermissionRulesStore(
    useShallow((s) => s.bySession[activeSessionId ?? ""] ?? null),
  );
  const activeProvider = usePermissionRulesStore((s) => s.activeProvider);
  const pendingDeleteId = usePermissionRulesStore((s) => s.pendingDeleteId);
  const fetchRules = usePermissionRulesStore((s) => s.fetchRules);
  const deleteRule = usePermissionRulesStore((s) => s.deleteRule);
  const setActiveProvider = usePermissionRulesStore((s) => s.setActiveProvider);
  const setPendingDeleteId = usePermissionRulesStore((s) => s.setPendingDeleteId);

  useEffect(() => {
    if (activeSessionId) {
      void fetchRules(activeSessionId);
    }
  }, [activeSessionId, fetchRules]);

  const rules = session?.rules ?? [];
  const providers = useMemo(() => {
    return ["all", ...Array.from(new Set(rules.map((rule) => rule.provider))).sort()];
  }, [rules]);
  const visibleRules =
    activeProvider === "all" ? rules : rules.filter((rule) => rule.provider === activeProvider);

  return (
    <div className="flex h-full flex-col">
      <PanelHeader
        icon={KeyRound}
        iconCls="text-status-warning"
        title="Permissions"
        trailing={
          activeSessionId && (
            <button
              className="rounded p-1 text-text-tertiary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
              title="Refresh"
              disabled={!!session?.loading}
              onClick={() => void fetchRules(activeSessionId, true)}
            >
              <RefreshCw className={`h-3.5 w-3.5 ${session?.loading ? "animate-spin" : ""}`} />
            </button>
          )
        }
      />

      <ProjectRuntimePendingRequests activeSessionId={activeSessionId} />

      {!activeSessionId ? (
        <EmptyState icon={KeyRound} title="No active session" />
      ) : session?.loading && !session.loadedAt ? (
        <EmptyState icon={Loader2} title="Loading permissions" spin />
      ) : session?.error ? (
        <EmptyState icon={ShieldAlert} title={session.error} tone="error" />
      ) : rules.length === 0 ? (
        <EmptyState icon={KeyRound} title="No permission rules" />
      ) : (
        <>
          <div className="border-b border-border-secondary px-2.5 py-2.5 dark:border-surface-code/50">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-text-secondary">
              <Filter className="h-3 w-3" />
              <span>Provider</span>
              <span className="ml-auto text-text-tertiary">{rules.length} rules</span>
            </div>
            <div className="flex flex-wrap gap-1">
              {providers.map((provider) => (
                <button
                  key={provider}
                  className={`rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
                    activeProvider === provider
                      ? "border-accent/30 bg-accent/10 text-accent"
                      : "border-border-secondary text-text-secondary hover:bg-surface-hover"
                  }`}
                  onClick={() => setActiveProvider(provider)}
                >
                  {provider}
                </button>
              ))}
            </div>
          </div>
          <div className="flex-1 overflow-y-auto">
            {visibleRules.length === 0 ? (
              <EmptyState icon={KeyRound} title="No rules for this provider" compact />
            ) : (
              visibleRules.map((rule) => (
                <PermissionRuleRow
                  key={rule.id}
                  rule={rule}
                  pendingDelete={pendingDeleteId === rule.id}
                  onRequestDelete={() => setPendingDeleteId(rule.id)}
                  onCancelDelete={() => setPendingDeleteId(null)}
                  onConfirmDelete={() => void deleteRule(activeSessionId, rule.id)}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

function EmptyState({
  icon: Icon,
  title,
  compact,
  spin,
  tone,
}: {
  icon: ElementType;
  title: string;
  compact?: boolean;
  spin?: boolean;
  tone?: "error";
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center px-4 text-center ${compact ? "py-8" : "flex-1"}`}
    >
      <Icon
        className={`mb-3 h-8 w-8 ${spin ? "animate-spin" : ""} ${
          tone === "error" ? "text-status-error" : "text-text-secondary dark:text-text-tertiary"
        }`}
      />
      <p
        className={`text-xs font-medium ${tone === "error" ? "text-status-error" : "text-text-tertiary"}`}
      >
        {title}
      </p>
    </div>
  );
}

function formatDate(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return value;
  return new Date(time).toLocaleString();
}
