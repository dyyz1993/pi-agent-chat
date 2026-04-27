import { useState, useRef, useEffect, useCallback, forwardRef, useImperativeHandle } from "react";
import { X, Maximize2, Minimize2, ArrowUp, ArrowDown } from "lucide-react";
import { useInputHistory } from "../../hooks/use-input-history";

export interface InputBarHandle {
  send: () => void;
}

interface InputBarProps {
  value?: string;
  onChange?: (v: string) => void;
  onSend?: () => void;
  disabled?: boolean;
  sessionId?: string;
}

export const InputBar = forwardRef<InputBarHandle, InputBarProps>(function InputBar(
  { value = "", onChange, onSend, disabled, sessionId = "" }, ref
) {
  const [internalValue, setInternalValue] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const { saveToHistory, navigatePrev, navigateNext, clearHistory, resetIndex } = useInputHistory(sessionId);

  const currentValue = onChange ? value : internalValue;

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    if (onChange) onChange(v);
    else setInternalValue(v);
    resetIndex();
  }, [onChange, resetIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!disabled && currentValue.trim()) {
          saveToHistory(currentValue.trim());
          if (onSend) onSend();
        }
      }
    },
    [disabled, onSend, currentValue, saveToHistory]
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

  useImperativeHandle(ref, () => ({ send }), [send]);

  const maxHeight = expanded ? undefined : 120;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = expanded ? `${Math.max(el.scrollHeight, 200)}px` : `${Math.min(el.scrollHeight, maxHeight ?? 160)}px`;
  }, [currentValue, expanded, maxHeight]);

  const hasContent = currentValue.trim().length > 0;

  return (
    <div className="flex-1 relative">
      <textarea
        ref={textareaRef}
        value={currentValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        placeholder="输入消息、@file、@agent，或粘贴图片与文本..."
        className="w-full px-3 py-2 pr-12 text-sm bg-gray-800/50 text-white rounded-lg border border-gray-700/50 focus:border-indigo-500/50 resize-none outline-none placeholder:text-gray-600 transition-colors"
        style={{ maxHeight: expanded ? "none" : `${maxHeight}px`, minHeight: expanded ? "200px" : "80px" }}
      />
      <div className="absolute right-1.5 top-1 flex flex-col gap-0.5">
        {/* Row 1: Clear (if has content) + Expand toggle */}
        <div className="flex gap-0.5">
          {hasContent && (
            <button onClick={handleClear} className="w-[26px] h-[26px] p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center" title="清除输入和历史">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button onClick={toggleExpand} className="w-[26px] h-[26px] p-1 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors flex items-center justify-center" title={expanded ? "收起" : "展开"}>
            {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
        </div>
        {/* Row 2: Navigation arrows - same layout as Row 1 with placeholder for X */}
        <div className="flex gap-0.5">
          {/* Placeholder for X button alignment */}
          {!hasContent && <div className="w-[26px] h-[26px]" />}
          <button onClick={handleNavPrev} className="w-[26px] h-[26px] p-1 rounded hover:bg-gray-700 text-gray-600 hover:text-gray-300 transition-colors flex items-center justify-center" title="上一条">
            <ArrowUp className="w-3.5 h-3.5" />
          </button>
          <button onClick={handleNavNext} className="w-[26px] h-[26px] p-1 rounded hover:bg-gray-700 text-gray-600 hover:text-gray-300 transition-colors flex items-center justify-center" title="下一条">
            <ArrowDown className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
});
