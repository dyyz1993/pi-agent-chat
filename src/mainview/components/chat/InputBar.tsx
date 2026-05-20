import {
  useState,
  useRef,
  useEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  memo,
} from "react";
import { X, Maximize2, Minimize2, ChevronUp, ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useInputHistory } from "../../hooks/use-input-history";
import { useChatStore } from "../../stores/use-chat-store";

export interface InputBarHandle {
  send: () => void;
  blur: () => void;
}

interface InputBarProps {
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

export const InputBar = memo(
  forwardRef<InputBarHandle, InputBarProps>(function InputBar(
    {
      onSend,
      disabled = false,
      sessionId = "",
      onTriggerPopup,
      popupOpen = false,
      onPopupConfirm,
      onPopupCancel,
      onPopupArrowUp,
      onPopupArrowDown,
    },
    ref,
  ) {
    const { t } = useTranslation("chat");
    const [expanded, setExpanded] = useState(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    const inputText = useChatStore((s) => s.inputText);
    const setInputText = useChatStore((s) => s.setInputText);

    const valueRef = useRef(inputText);
    valueRef.current = inputText;

    const {
      saveToHistory,
      navigatePrev,
      navigateNext,
      clearHistory,
      resetIndex,
      hasPrev,
      hasNext,
    } = useInputHistory(sessionId);

    const disabledRef = useRef(disabled);
    disabledRef.current = disabled;
    const onSendRef = useRef(onSend);
    onSendRef.current = onSend;

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
          const val = valueRef.current;
          if (!disabledRef.current && val.trim()) {
            saveToHistory(val.trim());
            onSendRef.current?.();
          }
        }
      },
      [saveToHistory, popupOpen, onPopupConfirm, onPopupCancel, onPopupArrowUp, onPopupArrowDown],
    );

    const onTriggerPopupRef = useRef(onTriggerPopup);
    onTriggerPopupRef.current = onTriggerPopup;
    const onPopupCancelRef = useRef(onPopupCancel);
    onPopupCancelRef.current = onPopupCancel;

    const handleChange = useCallback(
      (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const prev = valueRef.current;
        const next = e.target.value;
        setInputText(next);
        resetIndex();

        const isSingleCharAdded = prev.length === next.length - 1;
        if (isSingleCharAdded) {
          const added = next[next.length - 1];

          if (popupOpen && added === " ") {
            onPopupCancelRef.current?.();
            return;
          }

          if (added === "@" || added === "/") {
            const insertPos = next.length - 1;
            const canTrigger = insertPos === 0 || next[insertPos - 1] === " ";
            if (canTrigger) {
              onTriggerPopupRef.current?.(added === "@" ? "at" : "slash");
            }
          }
        }
      },
      [setInputText, resetIndex, popupOpen],
    );

    const handleClear = useCallback(() => {
      setInputText("");
      clearHistory();
      resetIndex();
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
        textareaRef.current.style.height = expanded ? "200px" : "70px";
      }
    }, [setInputText, expanded, clearHistory, resetIndex]);

    const toggleExpand = useCallback(() => {
      setExpanded((prev) => !prev);
    }, []);

    const handleNavPrev = useCallback(() => {
      const prevText = navigatePrev();
      if (prevText !== null) setInputText(prevText);
    }, [navigatePrev, setInputText]);

    const handleNavNext = useCallback(() => {
      const nextText = navigateNext();
      if (nextText !== null) setInputText(nextText);
    }, [navigateNext, setInputText]);

    const send = useCallback(() => {
      const val = valueRef.current;
      if (!val.trim()) return;
      saveToHistory(val.trim());
      onSendRef.current?.();
    }, [saveToHistory]);

    const blur = useCallback(() => {
      textareaRef.current?.blur();
    }, []);

    useImperativeHandle(ref, () => ({ send, blur }), [send, blur]);

    const maxHeight = expanded ? undefined : 120;

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      const rafId = requestAnimationFrame(() => {
        el.style.height = "auto";
        el.style.height = expanded
          ? `${Math.max(el.scrollHeight, 200)}px`
          : `${Math.min(el.scrollHeight, maxHeight ?? 160)}px`;
      });
      return () => cancelAnimationFrame(rafId);
    }, [inputText, expanded, maxHeight]);

    const hasContent = inputText.trim().length > 0;

    return (
      <div
        className="flex-1 rounded-lg border border-border-primary bg-bg-elevated/95 focus-within:border-border-focus focus-within:shadow-sm overflow-hidden transition-colors"
        style={{ minHeight: expanded ? "200px" : "80px" }}
      >
        <div className="relative h-full flex">
          <textarea
            data-testid="chat-input"
            ref={textareaRef}
            value={inputText}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
            placeholder={t("inputPlaceholder")}
            className="flex-1 px-3 py-2 text-sm bg-transparent text-text-primary resize-none outline-none placeholder:text-text-tertiary"
            style={{
              maxHeight: expanded ? "none" : `${maxHeight}px`,
              minHeight: expanded ? "200px" : "80px",
            }}
          />
          <div className="flex shrink-0 py-1.5 pr-1.5 gap-1.5">
            <div className="flex flex-col">
              <button
                onClick={handleClear}
                className={`w-7 h-7 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${hasContent ? "border-border-primary/80 text-text-secondary hover:text-text-primary hover:border-border-secondary hover:bg-surface-hover" : "border-border-primary/50 text-text-tertiary pointer-events-none"}`}
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
                className="w-7 h-7 md:w-5 md:h-5 rounded border border-border-primary/80 text-text-secondary hover:text-text-primary hover:border-border-secondary hover:bg-surface-hover transition-colors flex items-center justify-center"
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
                className={`w-7 h-7 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${hasPrev ? "border-border-primary/80 text-text-secondary hover:text-text-primary hover:border-border-secondary hover:bg-surface-hover" : "border-border-primary/50 text-text-tertiary pointer-events-none"}`}
                title={t("collapse")}
                aria-label={t("prevHistory")}
              >
                <ChevronUp className="w-4 h-4 md:w-3 md:h-3" />
              </button>
              <button
                onClick={handleNavNext}
                disabled={!hasNext}
                className={`w-7 h-7 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${hasNext ? "border-border-primary/80 text-text-secondary hover:text-text-primary hover:border-border-secondary hover:bg-surface-hover" : "border-border-primary/50 text-text-tertiary pointer-events-none"}`}
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
  }),
);
