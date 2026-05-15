import { registerToolRenderer } from "./registry";
import { ReadFileCard } from "./ReadFileCard";
import { WriteFileCard } from "./WriteFileCard";
import { PreviewRenderer } from "./PreviewRenderer";
import { BashExecutionCard } from "./BashRenderer";
import { LspExecutionCard } from "./LspExecutionCard";
import { TodoExecRenderer } from "./TodoRenderer";
import { DelegateCard, ForkCard } from "./CoordinatorRenderer";

registerToolRenderer("read", { renderExecution: ReadFileCard });
registerToolRenderer("write", { renderExecution: WriteFileCard });
registerToolRenderer("edit", { renderExecution: WriteFileCard });
registerToolRenderer("create_file", { renderExecution: WriteFileCard });
registerToolRenderer("preview", { renderExecution: PreviewRenderer });
registerToolRenderer("bash", { renderExecution: BashExecutionCard });
registerToolRenderer("lsp", { renderExecution: LspExecutionCard });
registerToolRenderer("todo", { renderExecution: TodoExecRenderer });
registerToolRenderer("session_delegate", { renderExecution: DelegateCard });
registerToolRenderer("session_delegate_fork", { renderExecution: ForkCard });

export { getToolRenderer } from "./registry";
export type { ToolRenderer, ToolRendererProps } from "./registry";
