import { registerToolRenderer } from "./registry";
import { ReadFileCard } from "./ReadFileCard";
import { WriteFileCard } from "./WriteFileCard";
import { PreviewRenderer } from "./PreviewRenderer";
import { BashExecutionCard } from "./BashRenderer";
import { LspExecutionCard } from "./LspExecutionCard";

registerToolRenderer("read", { renderExecution: ReadFileCard });
registerToolRenderer("write", { renderExecution: WriteFileCard });
registerToolRenderer("edit", { renderExecution: WriteFileCard });
registerToolRenderer("create_file", { renderExecution: WriteFileCard });
registerToolRenderer("preview", { renderExecution: PreviewRenderer });
registerToolRenderer("bash", { renderExecution: BashExecutionCard });
registerToolRenderer("lsp", { renderExecution: LspExecutionCard });

export { getToolRenderer } from "./registry";
export type { ToolRenderer, ToolRendererProps } from "./registry";
