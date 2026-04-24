import { useState, useRef, useEffect, useCallback } from "react";
import { X, Maximize2, Minimize2 } from "lucide-react";

interface InputBarProps {
  value?: string;
  onChange?: (v: string) => void;
  onSend?: () => void;
  disabled?: boolean;
}

export function InputBar({ value = "", onChange, onSend, disabled }: InputBarProps) {
  const [internalValue, setInternalValue] = useState(value);
  const [expanded, setExpanded] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentValue = onChange ? value : internalValue;

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (onChange) onChange(e.target.value);
    else setInternalValue(e.target.value);
  }, [onChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!disabled && onSend) onSend();
      }
    },
    [disabled, onSend]
  );

  const handleClear = useCallback(() => {
    if (onChange) onChange("");
    else setInternalValue("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = expanded ? "200px" : "38px";
    }
  }, [onChange, expanded]);

  const toggleExpand = useCallback(() => {
    setExpanded((prev) => !prev);
  }, []);

  const maxHeight = expanded ? undefined : 120;

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = expanded ? `${Math.max(el.scrollHeight, 200)}px` : `${Math.min(el.scrollHeight, maxHeight ?? 160)}px`;
  }, [currentValue, expanded, maxHeight]);

  const hasContent = currentValue.trim().length > 0;

  return (
    <div className="flex-1 flex items-end gap-1.5 relative">
      <textarea
        ref={textareaRef}
        value={currentValue}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        rows={1}
        placeholder="输入消息、@file、@agent，或粘贴图片与文本..."
        className="flex-1 px-3 py-2 text-sm bg-gray-800/50 text-white rounded-lg border border-gray-700/50 focus:border-indigo-500/50 resize-none outline-none placeholder:text-gray-600 transition-colors"
        style={{ maxHeight: expanded ? "none" : `${maxHeight}px`, minHeight: expanded ? "200px" : "38px" }}
      />
      {hasContent && (
        <button onClick={handleClear} className="absolute right-[52px] bottom-3 p-0.5 rounded hover:bg-gray-700 text-gray-500 hover:text-gray-300 transition-colors" title="清除">
          <X className="w-3 h-3" />
        </button>
      )}
      <button onClick={toggleExpand} className="p-1.5 rounded-md hover:bg-gray-800 text-gray-500 hover:text-gray-300 transition-colors shrink-0" title={expanded ? "收起" : "展开"}>
        {expanded ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
      </button>
    </div>
  );
}
