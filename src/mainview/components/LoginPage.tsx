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
    <div className="h-screen flex items-center justify-center bg-white dark:bg-gray-950">
      <div className="w-full max-w-sm mx-4">
        <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-lg dark:shadow-gray-900/50 border border-gray-200 dark:border-gray-800 p-8">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-indigo-50 dark:bg-indigo-950/50 mb-4">
              <svg
                className="w-7 h-7 text-indigo-500"
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
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              PI Agent Chat
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              请输入 Auth Token 以连接服务
            </p>
          </div>

          <form onSubmit={handleSubmit}>
            {loginError && (
              <div className="mb-4 p-3 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm flex items-center gap-2">
                ⚠️ {loginError}
              </div>
            )}
            <div className="mb-5">
              <label
                htmlFor="auth-token"
                className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5"
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
                  className="flex-1 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent text-sm"
                  autoFocus
                />
                {token && (
                  <button
                    type="button"
                    onClick={handleClear}
                    className="px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 text-sm"
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
              className="w-full py-2 px-4 rounded-lg bg-indigo-500 hover:bg-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors flex items-center justify-center gap-2"
            >
              {loginError ? "重试" : "连接"}
            </button>
          </form>

          <p className="text-xs text-gray-400 dark:text-gray-500 text-center mt-5">
            Token 将保存在浏览器本地存储中
          </p>
        </div>
      </div>
    </div>
  );
}
