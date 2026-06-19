import { memo } from "react";
import type { SpecialBlockRendererProps } from "../special-block-registry";
import { registerSpecialBlock } from "../special-block-registry";
import { BashBackgroundProcessCard } from "../BashBackgroundProcessCard";

export const BackgroundProcessBlockCard = memo(function BackgroundProcessBlockCard({
  block,
}: SpecialBlockRendererProps) {
  return (
    <BashBackgroundProcessCard
      compact
      data={{
        ...block.attrs,
        body: block.body,
        bashId: block.attrs.bash_id,
        toolCallId: block.attrs.tool_call_id,
        backgroundTrigger: block.attrs.trigger,
        exitCode: block.attrs.exit_code,
        durationMs: block.attrs.duration_ms,
        logPath: block.attrs.log_path,
      }}
    />
  );
});

registerSpecialBlock("background_process", BackgroundProcessBlockCard);
