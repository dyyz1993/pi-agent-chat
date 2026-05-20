import { useCallback, useState, memo } from "react";
import { Copy, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { copyToClipboard } from "../../utils/clipboard";

interface CopyButtonProps {
  text: string;
  size?: "xs" | "sm";
  className?: string;
  title?: string;
}

export const CopyButton = memo(function CopyButton({
  text,
  size = "xs",
  className = "",
}: CopyButtonProps) {
  const { t } = useTranslation("common");
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    copyToClipboard(text).then((ok) => {
      if (ok) {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }
    });
  }, [text]);

  const sizeClasses = size === "xs" ? "w-3.5 h-3.5" : "w-4 h-4";
  const containerSize = size === "xs" ? "p-1" : "p-1.5";

  return (
    <button
      onClick={handleCopy}
      title={copied ? t("copied") : t("copy")}
      className={`${containerSize} rounded hover:bg-surface-hover text-text-secondary hover:text-text-primary transition-colors ${className}`}
    >
      {copied ? (
        <Check className={`${sizeClasses} text-status-success`} />
      ) : (
        <Copy className={`${sizeClasses}`} />
      )}
    </button>
  );
});
