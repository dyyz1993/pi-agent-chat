/**
 * Web server configuration — single source of truth.
 * Values are read from environment variables with sensible defaults.
 */

export const config = {
  port: parseInt(process.env.PORT ?? "3100"),
  authToken: process.env.AUTH_TOKEN ?? "pi-agent-chat-chat-token",
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE ?? String(50 * 1024 * 1024)),
  logDir: process.env.LOG_DIR ?? "logs",
  piCliPath: process.env.PI_CLI_PATH ?? "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/dist/cli.js",
  piExtensionPaths: {
    subagent: process.env.PI_EXT_SUBAGENT ?? "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/subagent-ext/index.ts",
    todo: process.env.PI_EXT_TODO ?? "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/todo-ext/index.ts",
    bash: process.env.PI_EXT_BASH ?? "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/bash-ext/index.ts",
    lsp: process.env.PI_EXT_LSP ?? "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/lsp/lsp/index.ts",
    preview: process.env.PI_EXT_PREVIEW ?? "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/preview/index.ts",
    autoMemory: process.env.PI_EXT_AUTO_MEMORY ?? "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/auto-memory/index.ts",
    rules: process.env.PI_EXT_RULES ?? "/Users/xuyingzhou/Project/temporary/pi-momo-fork/packages/coding-agent/extensions/rules-engine/index.ts",
    autoSessionTitle: process.env.PI_EXT_AUTO_SESSION_TITLE ?? "",
    fileSnapshot: process.env.PI_EXT_FILE_SNAPSHOT ?? "",
  },
} as const;
