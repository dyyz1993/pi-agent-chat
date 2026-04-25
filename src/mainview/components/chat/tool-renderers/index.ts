import { registerToolRenderer } from "./registry";
import { ReadFileCard } from "./ReadFileCard";
import { WriteFileCard } from "./WriteFileCard";
import { PreviewRenderer } from "./PreviewRenderer";

registerToolRenderer("read", { renderExecution: ReadFileCard });
registerToolRenderer("write", { renderExecution: WriteFileCard });
registerToolRenderer("edit", { renderExecution: WriteFileCard });
registerToolRenderer("create_file", { renderExecution: WriteFileCard });
registerToolRenderer("preview", { renderExecution: PreviewRenderer });

export { getToolRenderer } from "./registry";
export type { ToolRenderer, ToolRendererProps } from "./registry";
