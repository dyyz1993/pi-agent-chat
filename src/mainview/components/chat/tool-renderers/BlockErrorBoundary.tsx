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
        className="border-l-2 border-status-error bg-status-error/5 px-3 py-1.5"
      >
        <div className="flex items-center gap-1.5 text-xs text-status-error">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          <span className="font-medium">Render Error</span>
          <div className="ml-auto">
            <CopyButton text={errorText} />
          </div>
        </div>
        <pre className="mt-1 text-[10px] text-status-error/80 font-mono whitespace-pre-wrap break-all max-h-20 overflow-y-auto">
          {err?.message}
        </pre>
      </div>
    );
  }
}
