import { memo, useCallback } from "react";
import { Check, Copy } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cx } from "../../lib/classes";
import { IconButton } from "./IconButton";
import { Tooltip } from "./Tooltip";
import { useClipboard } from "../chat/preview/use-clipboard";

type CopyActionSize = "xs" | "sm";

interface CopyActionProps {
  text?: string;
  textGetter?: () => string;
  size?: CopyActionSize;
  className?: string;
  title?: string;
  copiedTitle?: string;
  successMessage?: string;
  failureMessage?: string;
  showToast?: boolean;
  tooltipSide?: "top" | "bottom" | "left" | "right";
}

const iconSizeClasses: Record<CopyActionSize, string> = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
};

const buttonSizeClasses: Record<CopyActionSize, string> = {
  xs: "h-8 w-8 rounded-md",
  sm: "h-9 w-9",
};

export const CopyAction = memo(function CopyAction({
  text,
  textGetter,
  size = "xs",
  className,
  title,
  copiedTitle,
  successMessage,
  failureMessage,
  showToast = true,
  tooltipSide = "top",
}: CopyActionProps) {
  const { t } = useTranslation("common");
  const { copied, copy } = useClipboard(1500, {
    successMessage,
    failureMessage,
    showToast,
  });

  const handleCopy = useCallback(() => {
    const resolvedText = textGetter ? textGetter() : (text ?? "");
    copy(resolvedText);
  }, [copy, text, textGetter]);

  const copyLabel = title ?? t("copy");
  const label = copied ? (copiedTitle ?? t("copied")) : copyLabel;

  return (
    <Tooltip label={label} side={tooltipSide}>
      <IconButton
        onClick={handleCopy}
        label={label}
        title={label}
        size="sm"
        className={cx(buttonSizeClasses[size], className)}
      >
        {copied ? (
          <Check className={cx(iconSizeClasses[size], "text-status-success")} />
        ) : (
          <Copy className={iconSizeClasses[size]} />
        )}
      </IconButton>
    </Tooltip>
  );
});
