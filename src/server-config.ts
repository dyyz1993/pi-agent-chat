/**
 * Web server configuration — single source of truth.
 * Values are read from environment variables with sensible defaults.
 */

export const config = {
  port: parseInt(process.env.PORT || "3100"),
  authToken: process.env.AUTH_TOKEN || "pi-agent-chat-chat-token",
  maxUploadSize: parseInt(process.env.MAX_UPLOAD_SIZE || String(50 * 1024 * 1024)),
} as const;
