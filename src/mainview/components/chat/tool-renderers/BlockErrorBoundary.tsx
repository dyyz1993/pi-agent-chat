import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { CopyButton } from "../CopyButton";

interface BlockErrorBoundaryProps {
  children: ReactNode;
  blockId?: string;
}

interface BlockErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class BlockErrorBoundary extends Component<
  BlockErrorBoundaryProps,
  BlockErrorBoundaryState
> {
  constructor(props: BlockErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): BlockErrorBoundaryState {
    return { hasError: true, error };
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const err = this.state.error;
    const errorText = err
      ? `${err.message}${err.stack ? `\n\n${err.stack}` : ""}`
      : "Unknown error";

    return (
      <div
        data-block-id={this.props.blockId}
        className="border-l-2 border-red-400 bg-red-50 dark:bg-red-950/15 px-3 py-1.5"
      >
        <div className="flex items-center gap-1.5 text-xs text-red-600 dark:text-red-400">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium">Render Error</span>
          <div className="ml-auto">
            <CopyButton text={errorText} />
          </div>
        </div>
        <pre className="mt-1 text-[10px] text-red-500/80 dark:text-red-300/70 font-mono whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
          {err?.message}
        </pre>
      </div>
    );
  }
}
