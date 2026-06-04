import { useState, useEffect } from "react";

interface LoginPageProps {
  onLogin: () => void;
  loginError?: string | null;
  onClearError?: () => void;
}

export function LoginPage({ onLogin, loginError, onClearError }: LoginPageProps) {
  const [token, setToken] = useState("");

  useEffect(() => {
    const storedToken = localStorage.getItem("rpc-auth-token");
    if (storedToken && storedToken.trim()) {
      setToken(storedToken.trim());
    } else {
      setToken("demo-test-token");
    }
  }, []);

  const handleClear = () => {
    setToken("");
    localStorage.removeItem("rpc-auth-token");
    onClearError?.();
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;

    localStorage.setItem("rpc-auth-token", token.trim());
    onLogin();
  };

  return (
    <div className="h-screen flex items-center justify-center bg-bg-elevated dark:bg-surface-code">
      <div className="w-full max-w-sm mx-4">
        <div className="bg-bg-elevated dark:bg-surface-code rounded-2xl shadow-lg dark:shadow-surface-code/50 border border-border-secondary p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-semantic-accent/10 dark:bg-semantic-accent/5 mb-4">
              <svg
                className="w-7 h-7 text-semantic-accent"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                />
              </svg>
            </div>
            <h1 className="text-xl font-semibold text-text-primary">PI Agent Chat</h1>
            <p className="text-sm text-text-tertiary mt-1">请输入 Auth Token 以连接服务</p>
          </div>

          <form onSubmit={handleSubmit}>
            {loginError && (
              <div className="mb-4 p-3 rounded-lg bg-status-error/10 dark:bg-status-error/20 border border-status-error/30 text-status-error dark:text-status-error/80 text-sm flex items-center gap-2">
                ⚠️ {loginError}
              </div>
            )}
            <div className="mb-5">
              <label
                htmlFor="auth-token"
                className="block text-sm font-medium text-text-secondary mb-1.5"
              >
                Auth Token
              </label>
              <div className="flex gap-2">
                <input
                  id="auth-token"
                  type="text"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="请输入 Token"
                  className="flex-1 px-3 py-2 rounded-lg border border-border-secondary bg-bg-elevated dark:bg-surface-dim text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-semantic-accent focus:border-transparent text-sm"
                  autoFocus
                />
                {token && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="px-3 py-2 rounded-lg border border-border-secondary hover:bg-surface-dim dark:hover:bg-surface-hover text-text-tertiary text-sm"
                    title="清除 Token"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={!token.trim()}
              className="w-full py-2 px-4 rounded-lg bg-semantic-accent hover:bg-semantic-accent/80 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loginError ? "重试" : "连接"}
            </button>
          </form>

          <p className="text-xs text-text-tertiary text-center mt-5">
            Token 将保存在浏览器本地存储中
          </p>
        </div>
      </div>
    </div>
  );
}
