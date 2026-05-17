import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { X, Maximize2, Minimize2, ChevronUp, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInputHistory } from "../../hooks/use-input-history";

export interface InputBarHandle {
  send: () => void;
  blur: () => void;
}

interface InputBarProps {
  value?: string;
  onChange?: (v: string) => void;
  onSend?: () => void;
  disabled?: boolean;
  sessionId?: string;
  onTriggerPopup?: (mode: "at" | "slash") => void;
  popupOpen?: boolean;
  onPopupConfirm?: () => void;
  onPopupCancel?: () => void;
  onPopupArrowUp?: () => void;
  onPopupArrowDown?: () => void;
}

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar(
  {
    value = "",
    onChange,
    onSend,
    disabled,
    sessionId = "",
    onTriggerPopup,
    popupOpen,
    onPopupConfirm,
    onPopupCancel,
    onPopupArrowUp,
    onPopupArrowDown,
  },
  ref,
) {
  const { t } = useTranslation("chat");
  const [internalValue, setInternalValue] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { saveToHistory, navigatePrev, navigateNext, clearHistory, resetIndex, hasPrev, hasNext } =
    useInputHistory(sessionId);

  const currentValue = onChange ? value : internalValue;

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (popupOpen) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          onPopupConfirm?.();
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          onPopupCancel?.();
          return;
        }
        if (e.key === "ArrowUp") {
          e.preventDefault();
          onPopupArrowUp?.();
          return;
        }
        if (e.key === "ArrowDown") {
          e.preventDefault();
          onPopupArrowDown?.();
          return;
        }
      }
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!disabled && currentValue.trim()) {
          saveToHistory(currentValue.trim());
          if (onSend) onSend();
        }
      }
    },
    [
      disabled,
      onSend,
      currentValue,
      saveToHistory,
      popupOpen,
      onPopupConfirm,
      onPopupCancel,
      onPopupArrowUp,
      onPopupArrowDown,
    ],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      const prev = currentValue;
      const next = e.target.value;
      if (onChange) onChange(next);
      else setInternalValue(next);
      resetIndex();

      const isSingleCharAdded = prev.length === next.length - 1;
      if (isSingleCharAdded) {
        const added = next[next.length - 1];

        if (popupOpen && added === " ") {
          onPopupCancel?.();
          return;
        }

        if (onTriggerPopup && (added === "@" || added === "/")) {
          const insertPos = next.length - 1;
          const canTrigger = insertPos === 0 || next[insertPos - 1] === " ";
          if (canTrigger) {
            onTriggerPopup(added === "@" ? "at" : "slash");
          }
        }
      }
    },
    [onChange, resetIndex, onTriggerPopup, currentValue, popupOpen, onPopupCancel],
  );

  const handleClear = useCallback(() => {
    if (onChange) onChange("");
    else setInternalValue("");
    clearHistory();
    resetIndex();
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = expanded ? "200px" : "70px";
    }
  }, [onChange, expanded, clearHistory, resetIndex]);

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const handleNavPrev = useCallback(() => {
    const prevText = navigatePrev();
    if (prevText !== null && onChange) onChange(prevText);
    else if (prevText !== null) setInternalValue(prevText);
  }, [navigatePrev, onChange]);

  const handleNavNext = useCallback(() => {
    const nextText = navigateNext();
    if (nextText !== null && onChange) onChange(nextText);
    else if (nextText !== null) setInternalValue(nextText);
  }, [navigateNext, onChange]);

  const send = useCallback(() => {
    if (!currentValue.trim()) return;
    saveToHistory(currentValue.trim());
    if (onSend) onSend();
  }, [currentValue, saveToHistory, onSend]);

  const blur = useCallback(() => {
    textareaRef.current?.blur();
  }, []);

  useImperativeHandle(ref, () => ({ send, blur }), [send, blur]);

  const maxHeight = expanded ? undefined : 120;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = expanded
      ? `${Math.max(el.scrollHeight, 200)}px`
      : `${Math.min(el.scrollHeight, maxHeight ?? 160)}px`;
  }, [currentValue, expanded, maxHeight]);

  const hasContent = currentValue.trim().length > 0;

  return (
    <div
      className="flex-1 rounded-lg border border-gray-300/50 dark:border-gray-700/50 focus-within:border-indigo-500/50 bg-gray-100/50 dark:bg-gray-800/50 overflow-hidden transition-colors"
      style={{ minHeight: expanded ? "200px" : "80px" }}
    >
      <div className="relative h-full flex">
        <textarea
          data-testid="chat-input"
          ref={textareaRef}
          value={currentValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          rows={1}
          placeholder={t("inputPlaceholder")}
          className="flex-1 px-3 py-2 text-sm bg-transparent text-gray-900 dark:text-white resize-none outline-none placeholder:text-gray-400 dark:placeholder:text-gray-600"
          style={{
            maxHeight: expanded ? "none" : `${maxHeight}px`,
            minHeight: expanded ? "200px" : "80px",
          }}
        />
        <div className="flex shrink-0 py-1.5 pr-1.5 gap-1.5">
          <div className="flex flex-col">
            <button
              onClick={handleClear}
              className={`w-7 h-7 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${hasContent ? "border-gray-400 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:border-gray-400" : "border-gray-300/50 dark:border-gray-700/50 text-gray-400 dark:text-gray-700 pointer-events-none"}`}
              title={t("clearInput")}
              aria-label={t("clearInput")}
            >
              <X className="w-4 h-4 md:w-3 md:h-3" />
            </button>
          </div>
          <div
            className={`flex flex-col shrink ${expanded ? "gap-0.5 justify-start" : "gap-0.5 justify-start"}`}
          >
            <button
              onClick={toggleExpand}
              className="w-7 h-7 md:w-5 md:h-5 rounded border border-gray-400 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:border-gray-400 transition-colors flex items-center justify-center"
              title={expanded ? t("collapse") : t("expand")}
              aria-expanded={expanded}
              aria-label={expanded ? t("collapseInput") : t("expandInput")}
            >
              {expanded ? (
                <Minimize2 className="w-4 h-4 md:w-3 md:h-3" />
              ) : (
                <Maximize2 className="w-4 h-4 md:w-3 md:h-3" />
              )}
            </button>
            <button
              onClick={handleNavPrev}
              disabled={!hasPrev}
              className={`w-7 h-7 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${hasPrev ? "border-gray-400 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:border-gray-400" : "border-gray-300/50 dark:border-gray-700/50 text-gray-400 dark:text-gray-700 pointer-events-none"}`}
              title={t("collapse")}
              aria-label={t("prevHistory")}
            >
              <ChevronUp className="w-4 h-4 md:w-3 md:h-3" />
            </button>
            <button
              onClick={handleNavNext}
              disabled={!hasNext}
              className={`w-7 h-7 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${hasNext ? "border-gray-400 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:border-gray-400" : "border-gray-300/50 dark:border-gray-700/50 text-gray-400 dark:text-gray-700 pointer-events-none"}`}
              title={t("expand")}
              aria-label={t("nextHistory")}
            >
              <ChevronDown className="w-4 h-4 md:w-3 md:h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
});
