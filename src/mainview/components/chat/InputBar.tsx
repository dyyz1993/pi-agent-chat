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
import { useAttachmentStore } from "../../stores/use-attachment-store";

export interface InputBarHandle {
  send: () => void;
  blur: () => void;
  focus: () => void;
}

interface InputBarProps {
  onSend?: () => void;
  disabled?: boolean;
  sessionId?: string;
  placeholder?: string;
  historyEnabled?: boolean;
  onTriggerPopup?: (mode: "at" | "slash") => void;
  popupOpen?: boolean;
  onPopupConfirm?: () => void;
  onPopupCancel?: () => void;
  onPopupArrowUp?: () => void;
  onPopupArrowDown?: () => void;
}

const COLLAPSED_INPUT_HEIGHT = 72;
const EXPANDED_INPUT_HEIGHT = 200;

export const InputBar = memo(
  forwardRef<InputBarHandle, InputBarProps>(function InputBar(
    {
      onSend,
      disabled = false,
      sessionId = "",
      placeholder,
      historyEnabled = true,
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
    const attachmentCount = useAttachmentStore((s) => s.attachments.length);

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
        if (e.key === "ArrowUp" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
          if (!historyEnabled) return;
          const el = e.currentTarget as HTMLTextAreaElement;
          if (el.selectionStart === 0 && el.selectionEnd === 0) {
            e.preventDefault();
            const prevText = navigatePrev();
            if (prevText !== null) setInputText(prevText);
          }
          return;
        }
        if (e.key === "ArrowDown" && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
          if (!historyEnabled) return;
          const el = e.currentTarget as HTMLTextAreaElement;
          const len = el.value.length;
          if (el.selectionStart === len && el.selectionEnd === len) {
            e.preventDefault();
            const nextText = navigateNext();
            if (nextText !== null) setInputText(nextText);
          }
          return;
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          const val = valueRef.current;
          if (!disabledRef.current && val.trim()) {
            if (historyEnabled) saveToHistory(val.trim());
            onSendRef.current?.();
          }
        }
      },
      [
        saveToHistory,
        popupOpen,
        onPopupConfirm,
        onPopupCancel,
        onPopupArrowUp,
        onPopupArrowDown,
        navigatePrev,
        navigateNext,
        setInputText,
        historyEnabled,
      ],
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
        textareaRef.current.style.height = `${expanded ? EXPANDED_INPUT_HEIGHT : COLLAPSED_INPUT_HEIGHT}px`;
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
      if (historyEnabled) saveToHistory(val.trim());
      onSendRef.current?.();
    }, [saveToHistory, historyEnabled]);

    const blur = useCallback(() => {
      textareaRef.current?.blur();
    }, []);

    const focus = useCallback(() => {
      textareaRef.current?.focus();
    }, []);

    useImperativeHandle(ref, () => ({ send, blur, focus }), [send, blur, focus]);

    const maxHeight = expanded ? undefined : 120;

    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      const rafId = requestAnimationFrame(() => {
        el.style.height = "auto";
        el.style.height = expanded
          ? `${Math.max(el.scrollHeight, EXPANDED_INPUT_HEIGHT)}px`
          : `${Math.min(el.scrollHeight, maxHeight ?? 160)}px`;
      });
      return () => cancelAnimationFrame(rafId);
    }, [inputText, expanded, maxHeight]);

    const hasContent = inputText.trim().length > 0;

    return (
      <div
        className="flex-1 rounded-lg border border-border-primary bg-bg-elevated/95 focus-within:border-border-focus focus-within:shadow-sm overflow-hidden transition-colors"
        style={{ minHeight: expanded ? `${EXPANDED_INPUT_HEIGHT}px` : `${COLLAPSED_INPUT_HEIGHT}px` }}
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
            placeholder={
              placeholder ??
              (attachmentCount > 0
                ? t("inputPlaceholderWithAttachment", { count: attachmentCount })
                : t("inputPlaceholder"))
            }
            className="flex-1 px-3 py-2 text-sm bg-transparent text-text-primary resize-none outline-none placeholder:text-text-tertiary"
            style={{
              maxHeight: expanded ? "none" : `${maxHeight}px`,
              minHeight: expanded ? `${EXPANDED_INPUT_HEIGHT}px` : `${COLLAPSED_INPUT_HEIGHT}px`,
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
                disabled={!historyEnabled || !hasPrev}
                className={`w-7 h-7 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${historyEnabled && hasPrev ? "border-border-primary/80 text-text-secondary hover:text-text-primary hover:border-border-secondary hover:bg-surface-hover" : "border-border-primary/50 text-text-tertiary pointer-events-none"}`}
                title={t("collapse")}
                aria-label={t("prevHistory")}
              >
                <ChevronUp className="w-4 h-4 md:w-3 md:h-3" />
              </button>
              <button
                onClick={handleNavNext}
                disabled={!historyEnabled || !hasNext}
                className={`w-7 h-7 md:w-5 md:h-5 rounded border flex items-center justify-center transition-colors ${historyEnabled && hasNext ? "border-border-primary/80 text-text-secondary hover:text-text-primary hover:border-border-secondary hover:bg-surface-hover" : "border-border-primary/50 text-text-tertiary pointer-events-none"}`}
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
