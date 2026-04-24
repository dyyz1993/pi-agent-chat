import { useEffect, useRef } from "react";

interface InlineInputProps {
  defaultValue?: string;
  depth: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

export function InlineInput({ defaultValue = "", depth, onSubmit, onCancel }: InlineInputProps) {
  const ref = useRef<HTMLInputElement>(null);
  const committed = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    // Select name part (before extension) if there's a dot
    const dotIndex = defaultValue.lastIndexOf(".");
    if (dotIndex > 0) {
      el.setSelectionRange(0, dotIndex);
    } else {
      el.select();
    }
  }, [defaultValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const val = ref.current?.value.trim();
      committed.current = true;
      if (val) onSubmit(val);
      else onCancel();
    } else if (e.key === "Escape") {
      committed.current = true;
      onCancel();
    }
  };

  const handleBlur = () => {
    if (!committed.current) onCancel();
  };

  return (
    <div style={{ paddingLeft: `${depth * 16 + 24}px` }} className="py-0.5 pr-2">
      <input
        ref={ref}
        type="text"
        defaultValue={defaultValue}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        className="w-full px-1 py-0.5 text-xs bg-gray-700 text-white border border-indigo-500 rounded outline-none"
      />
    </div>
  );
}
