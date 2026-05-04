import { Component, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  detailsOpen: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, detailsOpen: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, detailsOpen: false };
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, detailsOpen: false });
  };

  toggleDetails = () => {
    this.setState((prev) => ({ ...prev, detailsOpen: !prev.detailsOpen }));
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="h-screen flex items-center justify-center bg-gray-950">
        <div className="text-center max-w-md px-6">
          <div className="text-2xl font-semibold text-white mb-2">出错了</div>
          <div className="text-gray-400 text-sm mb-6">页面渲染遇到了问题</div>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-sm rounded-lg transition-colors"
          >
            重试
          </button>
          <div className="mt-6">
            <button
              onClick={this.toggleDetails}
              className="text-gray-500 hover:text-gray-400 text-xs transition-colors"
            >
              {this.state.detailsOpen ? "▼" : "▶"} 错误详情
            </button>
            {this.state.detailsOpen && this.state.error && (
              <pre className="mt-2 text-left text-xs text-red-400 bg-[#111827] rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap break-all">
                {this.state.error.message}
                {this.state.error.stack && (
                  <>
                    {"\n\n"}
                    {this.state.error.stack}
                  </>
                )}
              </pre>
            )}
          </div>
        </div>
      </div>
    );
  }
}
