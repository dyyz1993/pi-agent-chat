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
import type { UIInteractionBlock } from "../../../types";
import { getUIMethodIcon } from "../tool-icon-map";
import { useUIDialogStore } from "../../../stores/use-ui-dialog-store";

type UIBlock = UIInteractionBlock;

const BG_MAP: Record<string, string> = {
  pending: "bg-amber-50 dark:bg-amber-950/8 border border-amber-400/30 dark:border-amber-500/30",
  responded:
    "bg-emerald-50 dark:bg-emerald-950/6 border-l-2 border-emerald-400/30 dark:border-emerald-500/30",
  dismissed: "bg-gray-50 dark:bg-gray-950/5 border-l-2 border-gray-300 dark:border-gray-600/30",
  notified: "bg-cyan-50 dark:bg-cyan-950/6 border-l-2 border-cyan-400/30 dark:border-cyan-500/30",
};

function CardShell({ block, children }: { block: UIBlock; children: React.ReactNode }) {
  const { icon: Icon, color, label } = getUIMethodIcon(block.method);
  const isPending = block.status === "pending";
  const isResponded = block.status === "responded";
  const isDismissed = block.status === "dismissed";

  return (
    <div
      className={`overflow-hidden rounded ${BG_MAP[block.status] ?? ""}`}
      data-ui-request-id={block.id}
    >
      <div className="px-3 py-1.5 pl-2 flex items-center gap-2 text-xs">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
        <span className={`font-medium ${color}`}>{block.title ?? label}</span>
        {isPending && (
          <span className="text-amber-600 dark:text-amber-400 animate-pulse text-[10px] flex items-center gap-1">
            <Loader2 className="w-2.5 h-2.5 animate-spin" />
            等待响应
          </span>
        )}
        {isResponded && <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0 ml-auto" />}
        {isDismissed && <XCircle className="w-3 h-3 text-gray-500 shrink-0 ml-auto" />}
      </div>
      {block.message && (
        <div className="px-3 pb-1 text-[11px] text-gray-600 dark:text-gray-400 leading-relaxed">
          {block.message}
        </div>
      )}
      {children}
    </div>
  );
}

export const ConfirmCard = memo(function ConfirmCard({ block }: { block: UIBlock }) {
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);
  const isPending = block.status === "pending";

  const responseText =
    block.status === "responded" && block.response
      ? block.response.confirmed
        ? "已确认"
        : "已拒绝"
      : null;

  return (
    <CardShell block={block}>
      {isPending ? (
        <div className="px-3 py-1.5 flex gap-2">
          <button
            onClick={() => respondById(block.id, { confirmed: true })}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] rounded bg-emerald-100 dark:bg-emerald-600/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-600/30 transition-colors"
          >
            <CheckCircle className="w-3 h-3" />
            确认
          </button>
          <button
            onClick={() => dismissById(block.id)}
            className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] rounded bg-red-100 dark:bg-red-600/15 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-600/25 transition-colors"
          >
            <XCircle className="w-3 h-3" />
            取消
          </button>
        </div>
      ) : responseText ? (
        <div className="px-3 pb-1.5">
          <span
            className={`text-[11px] ${block.response?.confirmed ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}`}
          >
            {responseText}
          </span>
        </div>
      ) : null}
    </CardShell>
  );
});

export const SelectCard = memo(function SelectCard({ block }: { block: UIBlock }) {
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
                      ? "bg-sky-100 dark:bg-sky-600/15 text-sky-700 dark:text-sky-300"
                      : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 hover:text-gray-800 dark:hover:text-gray-300"
                  }`}
                >
                  {checked ? (
                    <CheckSquare className="w-3.5 h-3.5 shrink-0 text-sky-500 dark:text-sky-400" />
                  ) : (
                    <Square className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-gray-600" />
                  )}
                  <div className="min-w-0">
                    <div>{label}</div>
                    {desc && (
                      <div className="text-[10px] text-gray-400 dark:text-gray-500">{desc}</div>
                    )}
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
                className={`shrink-0 ${customSelected ? "text-sky-500 dark:text-sky-400" : "text-gray-400 dark:text-gray-600"}`}
              >
                {customSelected ? (
                  <CheckSquare className="w-3.5 h-3.5" />
                ) : (
                  <Square className="w-3.5 h-3.5" />
                )}
              </button>
              <span
                className={`text-[11px] ${customSelected ? "text-sky-700 dark:text-sky-300" : "text-gray-600 dark:text-gray-400"}`}
              >
                自定义答案
              </span>
            </div>
            {customSelected && (
              <input
                type="text"
                value={customValue}
                onChange={(e) => setCustomValue(e.target.value)}
                placeholder={block.placeholder ?? "输入你的答案"}
                className="w-full ml-6 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-[11px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50"
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
                className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-amber-100 dark:bg-amber-600/20 text-amber-600 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-600/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] transition-colors"
              >
                提交
              </button>
              <button
                onClick={() => dismissById(block.id)}
                className="flex items-center justify-center px-3 py-1.5 rounded-md bg-gray-200/60 dark:bg-gray-700/30 text-gray-600 dark:text-gray-400 hover:bg-gray-300/60 dark:hover:bg-gray-600/50 text-[11px] transition-colors"
              >
                忽略
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
                    ? "bg-sky-100 dark:bg-sky-600/15 text-sky-700 dark:text-sky-300"
                    : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800/50 hover:text-gray-800 dark:hover:text-gray-300"
                }`}
              >
                <CircleDot
                  className={`w-3.5 h-3.5 shrink-0 ${selectedIdx === i ? "text-sky-500 dark:text-sky-400" : "text-gray-400 dark:text-gray-600"}`}
                />
                <div className="min-w-0">
                  <div>{label}</div>
                  {desc && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-500">{desc}</div>
                  )}
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
              className={`shrink-0 ${customSelected || selectedIdx === -1 ? "text-sky-500 dark:text-sky-400" : "text-gray-400 dark:text-gray-600"}`}
            >
              {customSelected || selectedIdx === -1 ? (
                <CircleDot className="w-3.5 h-3.5 text-sky-500 dark:text-sky-400" />
              ) : (
                <CircleDot className="w-3.5 h-3.5 text-gray-400 dark:text-gray-600" />
              )}
            </button>
            <span
              className={`text-[11px] ${customSelected || selectedIdx === -1 ? "text-sky-700 dark:text-sky-300" : "text-gray-600 dark:text-gray-400"}`}
            >
              自定义答案
            </span>
          </div>
          {customSelected && (
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder={block.placeholder ?? "输入你的答案"}
              className="w-full ml-7 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-[11px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50"
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
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-amber-100 dark:bg-amber-600/20 text-amber-600 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-600/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] transition-colors"
            >
              提交
            </button>
            <button
              onClick={() => dismissById(block.id)}
              className="flex items-center justify-center px-3 py-1.5 rounded-md bg-gray-200/60 dark:bg-gray-700/30 text-gray-600 dark:text-gray-400 hover:bg-gray-300/60 dark:hover:bg-gray-600/50 text-[11px] transition-colors"
            >
              忽略
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
          <span className="text-[11px] text-sky-600 dark:text-sky-400">
            {isMulti ? `已选 (${(responseValue as string[]).length}): ` : "选中: "}
            {display}
          </span>
        </div>
      </CardShell>
    );
  }

  return <CardShell block={block}>{null}</CardShell>;
});

export const InputCard = memo(function InputCard({ block }: { block: UIBlock }) {
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
            placeholder={block.placeholder ?? "请输入..."}
            className="flex-1 bg-white dark:bg-gray-800/60 border border-gray-300 dark:border-gray-700/50 rounded px-2 py-1 text-[11px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50"
            onKeyDown={(e) => {
              if (e.key === "Enter") respondById(block.id, { value });
            }}
          />
          <button
            onClick={() => respondById(block.id, { value })}
            className="flex items-center justify-center px-2 py-1 rounded bg-amber-100 dark:bg-amber-600/20 text-amber-600 dark:text-amber-400 hover:bg-amber-200 dark:hover:bg-amber-600/30 transition-colors"
          >
            <Send className="w-3 h-3" />
          </button>
        </div>
      ) : responseValue != null ? (
        <div className="px-3 pb-1.5">
          <span className="text-[11px] text-amber-600 dark:text-amber-400">
            输入: {responseValue || "(空)"}
          </span>
        </div>
      ) : null}
    </CardShell>
  );
});

export const EditorCard = memo(function EditorCard({ block }: { block: UIBlock }) {
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);
  const isPending = block.status === "pending";
  const [value, setValue] = useState(block.prefill ?? "");

  const responseValue =
    block.status === "responded" && block.response ? (block.response.value as string) : null;
  const wasDismissed =
    block.status === "dismissed" ||
    (block.response && (block.response as Record<string, unknown>).cancelled);

  return (
    <CardShell block={block}>
      {isPending ? (
        <div className="px-3 py-1.5 space-y-1.5">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={block.placeholder ?? "请编辑..."}
            rows={4}
            className="w-full bg-white dark:bg-gray-800/60 border border-gray-300 dark:border-gray-700/50 rounded px-2 py-1 text-[11px] text-gray-800 dark:text-gray-200 font-mono placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-violet-500/50 resize-y"
          />
          <div className="flex gap-1.5">
            <button
              onClick={() => respondById(block.id, { value })}
              className="flex-1 flex items-center justify-center gap-1 py-1 text-[11px] rounded bg-violet-100 dark:bg-violet-600/20 text-violet-600 dark:text-violet-400 hover:bg-violet-200 dark:hover:bg-violet-600/30 transition-colors"
            >
              <Send className="w-3 h-3" />
              提交
            </button>
            <button
              onClick={() => dismissById(block.id)}
              className="flex items-center justify-center gap-1 px-2 py-1 text-[11px] rounded bg-gray-200/60 dark:bg-gray-600/15 text-gray-600 dark:text-gray-400 hover:bg-gray-300/60 dark:hover:bg-gray-600/25 transition-colors"
            >
              <X className="w-3 h-3" />
              取消
            </button>
          </div>
        </div>
      ) : responseValue != null ? (
        <div className="px-3 pb-1.5">
          <details>
            <summary className="text-[11px] text-violet-600 dark:text-violet-400 cursor-pointer hover:text-violet-500 dark:hover:text-violet-300">
              编辑内容 ({responseValue.length} 字符)
            </summary>
            <pre className="mt-1 text-[11px] text-gray-800 dark:text-gray-300 bg-gray-100 dark:bg-gray-800/40 rounded p-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono">
              {responseValue}
            </pre>
          </details>
        </div>
      ) : wasDismissed ? (
        <div className="px-3 pb-1.5">
          <span className="text-[11px] text-gray-400 dark:text-gray-500">已取消编辑</span>
        </div>
      ) : null}
    </CardShell>
  );
});

export const NotifyCard = memo(function NotifyCard({ block }: { block: UIBlock }) {
  const notifyColors: Record<string, string> = {
    info: "text-cyan-400",
    warning: "text-amber-400",
    error: "text-red-400",
  };
  const colorClass = notifyColors[block.notifyType ?? "info"] ?? "text-cyan-400";

  return (
    <CardShell block={block}>
      <div className="px-3 pb-1.5">
        <span className={`text-[11px] ${colorClass}`}>
          {block.notifyType === "warning" ? "⚠️ " : block.notifyType === "error" ? "❌ " : "ℹ️ "}
          {block.message ?? "通知已发送"}
        </span>
      </div>
    </CardShell>
  );
});

export const RespondUICard = memo(function RespondUICard({ block }: { block: UIBlock }) {
  const { icon: Icon, color } = getUIMethodIcon("respondUI");

  return (
    <div
      className="overflow-hidden rounded bg-orange-50 dark:bg-orange-950/6 border-l-2 border-orange-400/30 dark:border-orange-500/30"
      data-ui-request-id={block.id}
    >
      <div className="px-3 py-1.5 pl-2 flex items-center gap-2 text-xs">
        <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
        <span className={`font-medium ${color}`}>{block.title ?? "异步响应注入"}</span>
        <Zap className="w-3 h-3 text-orange-500 dark:text-orange-400 shrink-0 ml-auto" />
      </div>
      {block.message && (
        <div className="px-3 pb-1.5 text-[11px] text-orange-600/70 dark:text-orange-300/70">
          {block.message}
        </div>
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
