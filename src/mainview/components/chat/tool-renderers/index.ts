import { registerToolRenderer } from "./registry";
import { ReadFileCard } from "./ReadFileCard";
import { WriteFileCard } from "./WriteFileCard";
import { PreviewRenderer } from "./PreviewRenderer";
import { BashExecutionCard } from "./BashRenderer";
import { LspExecutionCard } from "./LspExecutionCard";
import { TodoExecRenderer } from "./TodoRenderer";
import {
  DelegateCard,
  ForkCard,
  DelegateSendCard,
  DelegateStatusCard,
  DelegateStopCard,
  DelegateRemoveCard,
  DelegateClearCard,
} from "./CoordinatorRenderer";
import { AskUserQuestionToolCard, shouldRenderAskUserQuestionToolCard } from "./UICardRenderer";

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
registerToolRenderer("session_delegate_send", { renderExecution: DelegateSendCard });
registerToolRenderer("session_delegate_status", { renderExecution: DelegateStatusCard });
registerToolRenderer("session_delegate_stop", { renderExecution: DelegateStopCard });
registerToolRenderer("session_delegate_remove", { renderExecution: DelegateRemoveCard });
registerToolRenderer("session_delegate_clear_stopped", { renderExecution: DelegateClearCard });
registerToolRenderer("ask-user-question", {
  renderExecution: AskUserQuestionToolCard,
  shouldRenderExecution: shouldRenderAskUserQuestionToolCard,
});
registerToolRenderer("askUserQuestion", {
  renderExecution: AskUserQuestionToolCard,
  shouldRenderExecution: shouldRenderAskUserQuestionToolCard,
});

export { getToolRenderer } from "./registry";
export type { ToolRenderer, ToolRendererProps } from "./registry";
