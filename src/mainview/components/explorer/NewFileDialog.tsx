import { useRef, useState, useCallback, useEffect } from "react";
import { X } from "lucide-react";
import { useFocusTrap } from "../../hooks/use-focus-trap";

interface NewFileDialogProps {
  filePath: string;
  fileName: string;
  onSave: (content: string) => void;
  onSkip: () => void;
}

export function NewFileDialog({ fileName, onSave, onSkip }: NewFileDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [content, setContent] = useState("");

  useFocusTrap(dialogRef, { onEscape: onSkip });

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        onSave(content);
      }
    },
    [content, onSave],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onSkip();
      }}
    >
      <div
        ref={dialogRef}
        className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-2xl p-4 min-w-[400px] max-w-[600px]"
        role="dialog"
        aria-modal="true"
        aria-label={`New File: ${fileName}`}
      >
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            New File: {fileName}
          </h3>
          <button
            className="p-1 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors"
            onClick={onSkip}
            aria-label="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={content}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter file content (optional)..."
          className="w-full h-[300px] text-xs font-mono bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded p-2 text-gray-900 dark:text-white resize-y mb-3 focus:outline-none focus:border-indigo-500"
        />

        <div className="flex justify-end gap-2">
          <button
            className="px-3 py-1.5 text-xs bg-gray-200 dark:bg-gray-700 hover:bg-gray-300 dark:hover:bg-gray-600 rounded transition-colors text-gray-800 dark:text-gray-200"
            onClick={onSkip}
          >
            Skip
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-indigo-600 hover:bg-indigo-700 text-white rounded transition-colors"
            onClick={() => onSave(content)}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
