import { Component, type ReactNode } from "react";
import i18n from "../lib/i18n";

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
      <div className="h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <div className="text-center max-w-md px-6">
          <div className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">
            {i18n.t("common:errorTitle")}
          </div>
          <div className="text-gray-500 dark:text-gray-400 text-sm mb-6">
            {i18n.t("common:errorDescription")}
          </div>
          <button
            onClick={this.handleRetry}
            className="px-4 py-2 bg-semantic-accent hover:bg-semantic-accent/80 text-white text-sm rounded-lg transition-colors"
          >
            {i18n.t("common:retry")}
          </button>
          <div className="mt-6">
            <button
              onClick={this.toggleDetails}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xs transition-colors"
            >
              {this.state.detailsOpen ? "▼" : "▶"} {i18n.t("common:errorDetail")}
            </button>
            {this.state.detailsOpen && this.state.error && (
              <pre className="mt-2 text-left text-xs text-status-error dark:text-status-error bg-gray-100 dark:bg-[#111827] rounded-lg p-3 overflow-auto max-h-40 whitespace-pre-wrap break-all">
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
