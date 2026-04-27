/**
 * Web server configuration — single source of truth.
 * Values are read from environment variables with sensible defaults.
 */

export const config = {
  port: parseInt(process.env.PORT || "3100"),
  authToken: process.env.AUTH_TOKEN || "pi-agent-chat-chat-token",
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(50 * 1024 * 1024)),
  logDir: process.env.LOG_DIR || "logs",
  piCliPath: process.env.PI_CLI_PATH || "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/cli.js",
  piExtensionPaths: {
    subagent: process.env.PI_EXT_SUBAGENT || "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/subagent.ts",
    todo: process.env.PI_EXT_TODO || "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/todo.ts",
    bash: process.env.PI_EXT_BASH || "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/bash.ts",
    lsp: process.env.PI_EXT_LSP || "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/lsp/index.ts",
    preview: process.env.PI_EXT_PREVIEW || "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/test/auto-memory/preview.ts",
    autoMemory: process.env.PI_EXT_AUTO_MEMORY || "/Users/xuyingzhou/.pi/agent/extensions/auto-memory/auto-memory.ts",
    autoSessionTitle: process.env.PI_EXT_AUTO_SESSION_TITLE || "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/examples/extensions/auto-session-title.ts",
    rules: process.env.PI_EXT_RULES || "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/src/rules-engine/index.ts",
    fileSnapshot: process.env.PI_EXT_FILE_SNAPSHOT || "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/examples/extensions/file-snapshot.ts",
  },
} as const;
