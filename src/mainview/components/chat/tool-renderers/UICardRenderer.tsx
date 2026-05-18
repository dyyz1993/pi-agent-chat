import { memo, useState, useCallback } from "react";
import {
  CheckCircle,
  XCircle,
  CircleDot,
  CheckSquare,
  Square,
  Send,
  X,
  Loader2,
  Zap,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { UIInteractionBlock } from "../../../types";
import { getUIMethodIcon } from "../tool-icon-map";
import { useUIDialogStore } from "../../../stores/use-ui-dialog-store";

type UIBlock = UIInteractionBlock;

const BG_MAP: Record<string, string> = {
  pending:
    "border border-status-warning/30 dark:border-status-warning/40 bg-status-warning/50 dark:bg-status-warning/25",
  responded:
    "border-l-2 border-status-success/30 dark:border-status-success/40 bg-status-success/50 dark:bg-status-success/20",
  dismissed: "border-l-2 border-border-secondary/60 bg-surface-dim",
  notified:
    "border-l-2 border-status-info/30 dark:border-status-info/40 bg-status-info/50 dark:bg-status-info/20",
};

export function CardShell({ block, children }: { block: UIBlock; children: React.ReactNode }) {
  const { t } = useTranslation("chat");
  const { icon: Icon, color, label } = getUIMethodIcon(block.method);
  const isPending = block.status === "pending";
  const isResponded = block.status === "responded";
  const isDismissed = block.status === "dismissed";

  return (
    <div
      className={`overflow-hidden rounded ${BG_MAP[block.status] ?? ""}`}
      data-ui-request-id={block.id}
    >
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
        <span className={`font-medium ${color}`}>{block.title ?? label}</span>
        {isPending && (
          <span className="text-status-warning animate-pulse text-[10px] flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            {t("uiCard.waitingResponse")}
          </span>
        )}
        {isResponded && <CheckCircle className="w-3 h-3 text-status-success shrink-0 ml-auto" />}
        {isDismissed && <XCircle className="w-3 h-3 text-text-tertiary" />}
      </div>
      {block.message && (
        <div className="px-3 pb-2 text-[11px] text-text-secondary leading-relaxed">
          {block.message}
        </div>
      )}
      {children}
    </div>
  );
}

export const ConfirmCard = memo(function ConfirmCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);
  const isPending = block.status === "pending";

  const responseText =
    block.status === "responded" && block.response
      ? block.response.confirmed
        ? t("uiCard.confirmed")
        : t("uiCard.rejected")
      : null;

  return (
    <CardShell block={block}>
      {isPending ? (
        <div className="px-3 py-1.5 flex gap-2">
          <button
            onClick={() => respondById(block.id, { confirmed: true })}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] rounded bg-status-success/100 dark:bg-status-success/20 text-status-success hover:bg-status-success/200 dark:hover:bg-status-success/30 transition-colors"
          >
            <CheckCircle className="w-3 h-3" />
            {t("common:confirm")}
          </button>
          <button
            onClick={() => dismissById(block.id)}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] rounded bg-status-error/100 dark:bg-status-error/15 text-status-error hover:bg-status-error/200 dark:hover:bg-status-error/25 transition-colors"
          >
            <XCircle className="w-3 h-3" />
            {t("common:cancel")}
          </button>
        </div>
      ) : responseText ? (
        <div className="px-3 pb-1.5">
          <span
            className={`text-[11px] ${block.response?.confirmed ? "text-status-success" : "text-status-error"}`}
          >
            {responseText}
          </span>
        </div>
      ) : null}
    </CardShell>
  );
});

export const SelectCard = memo(function SelectCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);
  const isPending = block.status === "pending";
  const options = block.options ?? [];
  const isMulti = !!block.multiple || (block.toolName?.toLowerCase().includes("multi") ?? false);
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [checkedSet, setCheckedSet] = useState<Set<number>>(new Set());
  const [customValue, setCustomValue] = useState("");
  const [customSelected, setCustomSelected] = useState(false);

  const toggleCheck = useCallback((i: number) => {
    setCheckedSet((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }, []);

  function parseOption(opt: string) {
    const idx = opt.indexOf(" ");
    if (idx <= 0) return { label: opt, desc: "" };
    return { label: opt.slice(0, idx), desc: opt.slice(idx + 1) };
  }

  const responseValue =
    block.status === "responded" && block.response
      ? (block.response.value as string | string[])
      : null;

  if (isPending) {
    if (isMulti) {
      return (
        <CardShell block={block}>
          <div className="px-3 py-2 space-y-0.5">
            {options.map((opt, i) => {
              const { label, desc } = parseOption(opt);
              const checked = checkedSet.has(i);
              return (
                <button
                  key={i}
                  onClick={() => toggleCheck(i)}
                  className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                    checked
                      ? "bg-status-info/100 dark:bg-status-info/15 text-status-info"
                      : "text-text-secondary hover:bg-surface-dim hover:text-text-primary"
                  }`}
                >
                  {checked ? (
                    <CheckSquare className="w-3.5 h-3.5 shrink-0 text-status-info" />
                  ) : (
                    <Square className="w-3.5 h-3.5 shrink-0 text-text-tertiary" />
                  )}
                  <div className="min-w-0">
                    <div>{label}</div>
                    {desc && <div className="text-[10px] text-text-tertiary">{desc}</div>}
                  </div>
                </button>
              );
            })}
            <div className="flex items-center gap-2 px-2 py-1.5">
              <button
                onClick={() => {
                  setCustomSelected(true);
                  setCheckedSet(new Set());
                }}
                className={`shrink-0 ${customSelected ? "text-status-info" : "text-text-tertiary"}`}
              >
                {customSelected ? (
                  <CheckSquare className="w-3.5 h-3.5" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
              </button>
              <span
                className={`text-[11px] ${customSelected ? "text-status-info" : "text-text-secondary"}`}
              >
                {t("uiCard.customAnswer")}
              </span>
            </div>
            {customSelected && (
              <input
                type="text"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder={block.placeholder ?? t("uiCard.inputYourAnswer")}
                className="w-full ml-6 bg-surface-dim border border-border-secondary rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-status-warning/50"
                onKeyDown={(e) =>
                  e.key === "Enter" &&
                  customValue.trim() &&
                  respondById(block.id, { value: customValue.trim() })
                }
              />
            )}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => {
                  if (checkedSet.size > 0)
                    respondById(block.id, { value: Array.from(checkedSet).map((i) => options[i]) });
                  else if (customValue.trim()) respondById(block.id, { value: customValue.trim() });
                }}
                disabled={checkedSet.size === 0 && !customValue.trim()}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-status-warning/100 dark:bg-status-warning/20 text-status-warning hover:bg-status-warning/200 dark:hover:bg-status-warning/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] transition-colors"
              >
                {t("common:submit")}
              </button>
              <button
                onClick={() => dismissById(block.id)}
                className="flex items-center justify-center px-3 py-1.5 rounded-md bg-surface-hover/60 text-text-secondary hover:bg-surface-hover text-[11px] transition-colors"
              >
                {t("common:dismiss")}
              </button>
            </div>
          </div>
        </CardShell>
      );
    }

    return (
      <CardShell block={block}>
        <div className="px-3 py-2 space-y-0.5">
          {options.map((opt, i) => {
            const { label, desc } = parseOption(opt);
            return (
              <button
                key={i}
                onClick={() => {
                  setSelectedIdx(i);
                  setCustomSelected(false);
                }}
                className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-md text-[11px] transition-colors ${
                  selectedIdx === i
                    ? "bg-status-info/100 dark:bg-status-info/15 text-status-info"
                    : "text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover/50 hover:text-text-primary dark:hover:text-text-secondary"
                }`}
              >
                <CircleDot
                  className={`w-3.5 h-3.5 shrink-0 ${selectedIdx === i ? "text-status-info" : "text-text-tertiary"}`}
                />
                <div className="min-w-0">
                  <div>{label}</div>
                  {desc && <div className="text-[10px] text-text-tertiary">{desc}</div>}
                </div>
              </button>
            );
          })}
          <div className="flex items-center gap-2 px-2 py-1.5">
            <button
              onClick={() => {
                setCustomSelected(true);
                setSelectedIdx(null);
              }}
              className={`shrink-0 ${customSelected || selectedIdx === -1 ? "text-status-info" : "text-text-tertiary"}`}
            >
              {customSelected || selectedIdx === -1 ? (
                <CircleDot className="w-3.5 h-3.5 text-status-info" />
              ) : (
                <CircleDot className="w-3.5 h-3.5 text-text-tertiary" />
              )}
            </button>
            <span
              className={`text-[11px] ${customSelected || selectedIdx === -1 ? "text-status-info" : "text-text-secondary"}`}
            >
              {t("uiCard.customAnswer")}
            </span>
          </div>
          {customSelected && (
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder={block.placeholder ?? t("uiCard.inputYourAnswer")}
              className="w-full ml-7 bg-surface-dim border border-border-secondary rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-status-warning/50"
              onKeyDown={(e) =>
                e.key === "Enter" &&
                customValue.trim() &&
                respondById(block.id, { value: customValue.trim() })
              }
            />
          )}
          <div className="flex gap-2 pt-1">
            <button
              onClick={() => {
                if (selectedIdx != null && selectedIdx >= 0)
                  respondById(block.id, { value: options[selectedIdx] });
                else if (customValue.trim()) respondById(block.id, { value: customValue.trim() });
              }}
              disabled={selectedIdx == null && !customValue.trim()}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-status-warning/100 dark:bg-status-warning/20 text-status-warning hover:bg-status-warning/200 dark:hover:bg-status-warning/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] transition-colors"
            >
              {t("common:submit")}
            </button>
            <button
              onClick={() => dismissById(block.id)}
              className="flex items-center justify-center px-3 py-1.5 rounded-md bg-surface-hover/60 dark:bg-surface-hover/30 text-text-secondary dark:text-text-tertiary hover:bg-surface-hover/80 dark:hover:bg-surface-hover/50 text-[11px] transition-colors"
            >
              {t("common:dismiss")}
            </button>
          </div>
        </div>
      </CardShell>
    );
  }

  if (responseValue) {
    const display = Array.isArray(responseValue) ? responseValue.join(", ") : responseValue;
    return (
      <CardShell block={block}>
        <div className="px-3 pb-1.5">
          <span className="text-[11px] text-status-info">
            {isMulti
              ? t("uiCard.selected", { count: (responseValue as string[]).length })
              : t("uiCard.selectedSingle")}
            {display}
          </span>
        </div>
      </CardShell>
    );
  }

  return <CardShell block={block}>{null}</CardShell>;
});

export const InputCard = memo(function InputCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const isPending = block.status === "pending";
  const [value, setValue] = useState("");

  const responseValue =
    block.status === "responded" && block.response ? (block.response.value as string) : null;

  return (
    <CardShell block={block}>
      {isPending ? (
        <div className="px-3 py-1.5 flex gap-1.5">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={block.placeholder ?? t("uiCard.pleaseInput")}
            className="flex-1 bg-surface-dim/60 border border-border-secondary/50 rounded px-2 py-1 text-[11px] text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-status-warning/50"
            onKeyDown={(e) => {
              if (e.key === "Enter") respondById(block.id, { value });
            }}
          />
          <button
            onClick={() => respondById(block.id, { value })}
            className="flex items-center justify-center px-2 py-1 rounded bg-status-warning/100 dark:bg-status-warning/20 text-status-warning hover:bg-status-warning/200 dark:hover:bg-status-warning/30 transition-colors"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      ) : responseValue != null ? (
        <div className="px-3 pb-1.5">
          <span className="text-[11px] text-status-warning">
            {t("uiCard.inputColon")}
            {responseValue || t("uiCard.empty")}
          </span>
        </div>
      ) : null}
    </CardShell>
  );
});

export const EditorCard = memo(function EditorCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);
  const isPending = block.status === "pending";
  const [value, setValue] = useState(block.prefill ?? "");

  const responseValue =
    block.status === "responded" && block.response ? (block.response.value as string) : null;
  const wasDismissed =
    block.status === "dismissed" ||
    (block.response && "cancelled" in block.response && block.response.cancelled === true);

  return (
    <CardShell block={block}>
      {isPending ? (
        <div className="px-3 py-1.5 space-y-1.5">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={block.placeholder ?? t("uiCard.pleaseEdit")}
            rows={4}
            className="w-full bg-surface-dim border border-border-secondary/30 rounded px-2 py-1 text-[11px] text-text-primary font-mono placeholder:text-text-tertiary focus:outline-none focus:border-status-info/50 resize-y"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => respondById(block.id, { value })}
              className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] rounded bg-semantic-agent/100 dark:bg-semantic-agent/20 text-semantic-agent hover:bg-semantic-agent/200 dark:hover:bg-semantic-agent/30 transition-colors"
            >
              <Send className="w-3 h-3" />
              {t("common:submit")}
            </button>
            <button
              onClick={() => dismissById(block.id)}
              className="flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded bg-surface-hover/60 text-text-secondary hover:bg-surface-hover dark:hover:bg-surface-hover transition-colors"
            >
              <X className="w-3 h-3" />
              {t("common:cancel")}
            </button>
          </div>
        </div>
      ) : responseValue != null ? (
        <div className="px-3 pb-1.5">
          <details>
            <summary className="text-[11px] text-semantic-agent cursor-pointer hover:text-semantic-agent dark:hover:text-semantic-agent">
              {t("uiCard.editContent", { count: responseValue.length })}
            </summary>
            <pre className="mt-1 text-[11px] text-text-primary bg-surface-code rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono">
              {responseValue}
            </pre>
          </details>
        </div>
      ) : wasDismissed ? (
        <div className="px-3 pb-1.5">
          <span className="text-[11px] text-text-tertiary">{t("uiCard.editCancelled")}</span>
        </div>
      ) : null}
    </CardShell>
  );
});

export const NotifyCard = memo(function NotifyCard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const notifyColors: Record<string, string> = {
    info: "text-semantic-tool",
    warning: "text-status-warning",
    error: "text-status-error",
  };
  const colorClass = notifyColors[block.notifyType ?? "info"] ?? "text-semantic-tool";

  return (
    <CardShell block={block}>
      <div className="px-3 pb-1.5">
        <span className={`text-[11px] ${colorClass}`}>
          {block.notifyType === "warning" ? "⚠️ " : block.notifyType === "error" ? "❌ " : "ℹ️ "}
          {block.message ?? t("uiCard.notificationSent")}
        </span>
      </div>
    </CardShell>
  );
});

export const RespondUICard = memo(function RespondUICard({ block }: { block: UIBlock }) {
  const { t } = useTranslation("chat");
  const { icon: Icon, color } = getUIMethodIcon("respondUI");

  return (
    <div
      className="overflow-hidden rounded bg-semantic-notify/50 dark:bg-semantic-notify/20 border-l-2 border-semantic-notify/30 dark:border-semantic-notify/40"
      data-ui-request-id={block.id}
    >
      <div className="px-3 py-1.5 flex items-center gap-2 text-xs">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
        <span className={`font-medium ${color}`}>
          {block.title ?? t("uiCard.asyncResponseInjection")}
        </span>
        <Zap className="w-3 h-3 text-semantic-notify shrink-0 ml-auto" />
      </div>
      {block.message && (
        <div className="px-3 pb-1.5 text-[11px] text-semantic-notify/70">{block.message}</div>
      )}
    </div>
  );
});

export const UIInteractionCard = memo(function UIInteractionCard({ block }: { block: UIBlock }) {
  switch (block.method) {
    case "confirm":
      return <ConfirmCard block={block} />;
    case "select":
      return <SelectCard block={block} />;
    case "input":
      return <InputCard block={block} />;
    case "editor":
      return <EditorCard block={block} />;
    case "notify":
      return <NotifyCard block={block} />;
    default:
      return <CardShell block={block}>{null}</CardShell>;
  }
});
