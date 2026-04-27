import { useCallback, useState, memo } from "react";
import { Copy, Check } from "lucide-react";

interface CopyButtonProps {
  text: string;
  size?: "xs" | "sm";
  className?: string;
  title?: string;
}

export const CopyButton = memo(function CopyButton({ text, size = "xs", className = "", title = "复制" }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* fallback: no-op */ }
  }, [text]);

  const sizeClasses = size === "xs" ? "w-3.5 h-3.5" : "w-4 h-4";
  const containerSize = size === "xs" ? "p-1" : "p-1.5";

  return (
    <button
      onClick={handleCopy}
      title={copied ? "已复制" : title}
      className={`${containerSize} rounded hover:bg-gray-700/60 text-gray-500 hover:text-gray-300 transition-colors ${className}`}
    >
      {copied ? (
        <Check className={`${sizeClasses} text-green-400`} />
      ) : (
        <Copy className={`${sizeClasses}`} />
      )}
    </button>
  );
});
