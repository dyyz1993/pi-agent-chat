/**
 * Web server configuration — single source of truth.
 * Values are read from environment variables with sensible defaults.
 *
 * PI路径相关变量（PI_CLI_PATH, PI_EXT_*）必须通过环境变量或 .env 文件设置，
 * 无内置默认值。启动时若未设置会打印警告。
 */

const MISSING_PI_VARS: string[] = [];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    MISSING_PI_VARS.push(name);
    return "";
  }
  return value;
}

export const config = {
  port: parseInt(process.env.PORT ?? "3100"),
  authToken: process.env.AUTH_TOKEN ?? "",
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE ?? String(50 * 1024 * 1024)),
  logDir: process.env.LOG_DIR ?? "logs",
  piCliPath: requireEnv("PI_CLI_PATH"),
  piExtensionPaths: {
    subagent: requireEnv("PI_EXT_SUBAGENT"),
    todo: requireEnv("PI_EXT_TODO"),
    bash: requireEnv("PI_EXT_BASH"),
    lsp: requireEnv("PI_EXT_LSP"),
    preview: requireEnv("PI_EXT_PREVIEW"),
    autoMemory: requireEnv("PI_EXT_AUTO_MEMORY"),
    rules: requireEnv("PI_EXT_RULES"),
    autoSessionTitle: requireEnv("PI_EXT_AUTO_SESSION_TITLE"),
    fileSnapshot: requireEnv("PI_EXT_FILE_SNAPSHOT"),
    askTools: requireEnv("PI_EXT_ASK_TOOLS"),
    messageBridge: requireEnv("PI_EXT_MESSAGE_BRIDGE"),
    coordinator: requireEnv("PI_EXT_COORDINATOR"),
  },
} as const;

if (MISSING_PI_VARS.length > 0) {
  console.warn(
    `[config] ⚠ 以下环境变量未设置，PI Agent 功能将无法正常工作:\n` +
      MISSING_PI_VARS.map((v) => `  - ${v}`).join("\n") +
      `\n请在 .env 文件中配置这些变量，参考 .env.example`,
  );
}
