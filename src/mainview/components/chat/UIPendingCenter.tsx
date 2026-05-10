import { useEffect, useState, useRef } from "react";
import { MessageCircleQuestion, X, ArrowRight, CheckSquare, Square, Send } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIDialogStore } from "../../stores/use-ui-dialog-store";
import { useSessionStore } from "../../stores/use-session-store";
import { useFocusTrap } from "../../hooks/use-focus-trap";

function PanelCard({
  req,
}: {
  req: ReturnType<typeof useUIDialogStore.getState>["pending"][number];
}) {
  const { t } = useTranslation("chat");
  const respondById = useUIDialogStore((s) => s.respondById);
  const dismissById = useUIDialogStore((s) => s.dismissById);

  const methodLabel: Record<string, string> = {
    confirm: t("uiPending.confirm"),
    select: t("uiPending.select"),
    input: t("uiPending.inputLabel"),
    editor: t("uiPending.editor"),
  };

  const isSelect = req.method === "select";
  const isConfirm = req.method === "confirm";
  const isInput = req.method === "input";
  const options = req.options ?? [];
  const isMulti = !!req.multiple;

  if (isMulti || isSelect) {
    const [checkedSet, setCheckedSet] = useState<Set<number>>(new Set());
    const [customValue, setCustomValue] = useState("");

    return (
      <div className="border border-gray-300/40 dark:border-gray-700/40 rounded-xl overflow-hidden bg-gray-50/50 dark:bg-gray-900/50">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-300/50 dark:border-gray-700/50">
          <span
            className={`text-[11px] font-medium ${req.method === "select" ? "text-sky-400" : "text-emerald-400"}`}
          >
            {methodLabel[req.method] ?? req.method}
          </span>
          <span className="text-[10px] text-gray-500 ml-auto">{req.title}</span>
        </div>
        <div className="px-3 py-2">
          {req.message && (
            <p className="text-[11px] text-gray-700 dark:text-gray-300 mb-2 leading-relaxed">
              {req.message}
            </p>
          )}
          <div className="space-y-0.5 mb-2">
            {options.map((opt, i) => {
              const descParts = opt.split(" ");
              const label = descParts[0] ?? opt;
              const desc = descParts.slice(1).join(" ");
              const checked = checkedSet.has(i);
              return (
                <button
                  key={i}
                  onClick={() =>
                    setCheckedSet((prev) => {
                      const next = new Set(prev);
                      if (next.has(i)) next.delete(i);
                      else next.add(i);
                      return next;
                    })
                  }
                  className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left transition-colors ${
                    checked
                      ? "bg-sky-600/15 text-sky-700 dark:text-sky-300"
                      : "hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-500 dark:text-gray-400"
                  }`}
                >
                  {checked ? (
                    <CheckSquare className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                  ) : (
                    <Square className="w-3.5 h-3.5 shrink-0 text-gray-400 dark:text-gray-600" />
                  )}
                  <div className="min-w-0">
                    <div className="text-[11px]">{label}</div>
                    {desc && (
                      <div className="text-[10px] text-gray-400 dark:text-gray-500">{desc}</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 px-1 mt-2">
            <input
              type="text"
              value={customValue}
              onChange={(e) => setCustomValue(e.target.value)}
              placeholder={req.placeholder ?? t("uiCard.customAnswer")}
              className="flex-1 bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2 py-1 text-[11px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50"
              onKeyDown={(e) =>
                e.key === "Enter" &&
                customValue.trim() &&
                respondById(req.requestId, { value: customValue.trim() })
              }
            />
            <button
              onClick={() => {
                if (checkedSet.size > 0)
                  respondById(req.requestId, {
                    value: Array.from(checkedSet).map((i) => options[i]),
                  });
                else if (customValue.trim())
                  respondById(req.requestId, { value: customValue.trim() });
              }}
              disabled={checkedSet.size === 0 && !customValue.trim()}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] transition-colors"
            >
              <Send className="w-3 h-3" /> {t("uiPending.confirm")}
            </button>
            <button
              onClick={() => dismissById(req.requestId)}
              className="flex items-center justify-center px-3 py-1.5 rounded-md bg-gray-200/30 dark:bg-gray-700/30 text-gray-500 dark:text-gray-400 hover:bg-gray-300/50 dark:hover:bg-gray-600/50 text-[11px] transition-colors"
            >
              {t("common:dismiss")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isConfirm) {
    return (
      <div className="border border-gray-300/40 dark:border-gray-700/40 rounded-xl overflow-hidden bg-gray-50/50 dark:bg-gray-900/50">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-300/60 dark:border-gray-700/60">
          <span className="text-[11px] font-medium text-emerald-400">{methodLabel.confirm}</span>
          <span className="text-[10px] text-gray-500 ml-auto">{req.title}</span>
        </div>
        <div className="px-3 py-2">
          {req.message && (
            <p className="text-[11px] text-gray-700 dark:text-gray-300 mb-2.5 leading-relaxed">
              {req.message}
            </p>
          )}
          <div className="flex gap-2">
            <button
              onClick={() => respondById(req.requestId, { confirmed: true })}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30 text-[11px] transition-colors"
            >
              {t("uiPending.confirm")}
            </button>
            <button
              onClick={() => dismissById(req.requestId)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md bg-red-600/15 text-red-400 hover:bg-red-600/25 text-[11px] transition-colors"
            >
              {t("common:cancel")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (isInput) {
    const [value, setValue] = useState("");
    return (
      <div className="border border-gray-300/40 dark:border-gray-700/40 rounded-xl overflow-hidden bg-gray-50/50 dark:bg-gray-900/50">
        <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-gray-300/60 dark:border-gray-700/60">
          <span className="text-[11px] font-medium text-amber-400">{methodLabel.input}</span>
          <span className="text-[10px] text-gray-500 ml-auto">{req.title}</span>
        </div>
        <div className="px-3 py-2">
          {req.message && (
            <p className="text-[11px] text-gray-700 dark:text-gray-300 mb-2.5 leading-relaxed">
              {req.message}
            </p>
          )}
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={req.placeholder ?? t("uiCard.pleaseInput")}
            className="w-full bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded px-2.5 py-1.5 text-[11px] text-gray-800 dark:text-gray-200 placeholder:text-gray-400 dark:placeholder:text-gray-600 focus:outline-none focus:border-amber-500/50"
            onKeyDown={(e) => e.key === "Enter" && respondById(req.requestId, { value })}
          />
          <div className="flex gap-2 mt-2">
            <button
              onClick={() => respondById(req.requestId, { value })}
              disabled={!value.trim()}
              className="flex-1 flex items-center justify-center gap-1 px-3 py-1.5 rounded-md bg-amber-600/20 text-amber-400 hover:bg-amber-600/30 disabled:opacity-40 disabled:cursor-not-allowed text-[11px] transition-colors"
            >
              <Send className="w-3 h-3" /> {t("uiPending.confirm")}
            </button>
            <button
              onClick={() => dismissById(req.requestId)}
              className="flex items-center justify-center px-3 py-1.5 rounded-md bg-gray-200/30 dark:bg-gray-700/30 text-gray-500 dark:text-gray-400 hover:bg-gray-300/50 dark:hover:bg-gray-700/50 text-[11px] transition-colors"
            >
              {t("common:dismiss")}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export function UIPendingCenter() {
  const { t } = useTranslation("chat");
  const pending = useUIDialogStore((s) => s.pending);
  const panelOpen = useUIDialogStore((s) => s.panelOpen);
  const setPanelOpen = useUIDialogStore((s) => s.setPanelOpen);
  const togglePanel = useUIDialogStore((s) => s.togglePanel);
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, { onEscape: () => setPanelOpen(false) });

  useEffect(() => {
    if (!panelOpen || pending.length > 0) return;
    setPanelOpen(false);
  }, [pending.length, panelOpen, setPanelOpen]);

  if (!panelOpen && pending.length === 0) return null;

  const handleGotoChat = () => {
    setPanelOpen(false);
    if (pending.length > 0) {
      useSessionStore.getState().setActiveSession(pending[0].sessionId);
      requestAnimationFrame(() => {
        const el = document.querySelector(`[data-ui-request-id="${pending[0].requestId}"]`);
        if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    }
  };

  return (
    <>
      <button
        onClick={(e) => {
          e.stopPropagation();
          togglePanel();
        }}
        className="p-1 rounded transition-colors text-amber-400 hover:text-amber-300 relative animate-pulse"
        title={t("uiPending.pendingRequestsCount", { count: pending.length })}
      >
        <MessageCircleQuestion className="w-3.5 h-3.5" />
        {pending.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[10px] h-[10px] flex items-center justify-center bg-amber-500 rounded-full text-[7px] leading-none text-white font-bold px-[2px]">
            {pending.length > 9 ? "9+" : pending.length}
          </span>
        )}
      </button>

      {panelOpen && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center p-6 bg-black/50"
          onClick={(e) => e.target === e.currentTarget && setPanelOpen(false)}
        >
          <div
            ref={dialogRef}
            className="w-full max-w-lg bg-gray-100 dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg shadow-2xl overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-label={t("uiPending.pendingRequestsTitle")}
          >
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-gray-300/60 dark:border-gray-700/60">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-medium text-gray-800 dark:text-gray-200">
                  {t("uiPending.pendingRequestsTitle")}
                </span>
                <span className="px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 text-[11px] font-medium tabular-nums">
                  {pending.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={handleGotoChat}
                  className="flex items-center gap-1 px-2.5 py-1 text-[11px] text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-200/50 dark:hover:bg-gray-700/50 transition-colors"
                >
                  {t("uiPending.gotoSession")}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setPanelOpen(false)}
                  className="text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 p-1 transition-colors"
                  aria-label={t("common:close")}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="px-3 pb-3 pt-2 space-y-2.5">
              {pending.map((req) => (
                <PanelCard key={req.requestId} req={req} />
              ))}
              {pending.length === 0 && (
                <div className="py-8 text-center text-[11px] text-gray-400 dark:text-gray-500">
                  {t("uiPending.noPendingRequests")}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
