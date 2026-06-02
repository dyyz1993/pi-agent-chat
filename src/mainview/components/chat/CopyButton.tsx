import { memo } from "react";
import { CopyAction } from "../primitives";

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
  title,
}: CopyButtonProps) {
  return (
    <CopyAction text={text} size={size} className={className} title={title} showToast={false} />
  );
});
