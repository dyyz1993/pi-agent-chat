import { memo } from "react";
import { Streamdown } from "streamdown";

export default memo(function StreamingMarkdownContent({ text }: { text: string }) {
  return (
    <Streamdown mode="streaming" parseIncompleteMarkdown controls={false}>
      {text}
    </Streamdown>
  );
});
