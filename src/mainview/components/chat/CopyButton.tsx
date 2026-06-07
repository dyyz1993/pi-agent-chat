import { memo } from "react";
import { CopyAction } from "../primitives";

interface CopyButtonProps {
  text?: string;
  textGetter?: () => string;
  size?: "xs" | "sm";
  className?: string;
  title?: string;
}

export const CopyButton = memo(function CopyButton({
  text,
  textGetter,
  size = "xs",
  className = "",
  title,
}: CopyButtonProps) {
  return (
    <CopyAction text={text} textGetter={textGetter} size={size} className={className} title={title} showToast={false} />
  );
});
