/**
 * Web server configuration — single source of truth.
 * Values are read from environment variables with sensible defaults.
 *
 * PI_CLI_PATH — 必须通过环境变量或 .env 设置。
 * 扩展路径从全局目录 ~/.pi/agent/extensions/ 自动发现，无需逐个配置。
 */

import { homedir } from "node:os";
import { join } from "node:path";

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
  /** 全局扩展目录，所有扩展通过软链集中管理于此 */
  piExtensionsDir: join(homedir(), ".pi", "agent", "extensions"),
  /** 本地代理注册 API 地址（如 shanbox），不配置则不启用代理 */
  proxyApiUrl: process.env.PROXY_API_URL ?? "",
  /** 代理服务的公网域名（如 shanbox.19930810.xyz:8443），用于构造公网 URL */
  proxyPublicDomain: process.env.PROXY_PUBLIC_DOMAIN ?? "",
} as const;

if (MISSING_PI_VARS.length > 0) {
  console.warn(
    `[config] ⚠ 以下环境变量未设置，PI Agent 功能将无法正常工作:\n` +
      MISSING_PI_VARS.map((v) => `  - ${v}`).join("\n") +
      `\n请在 .env 文件中配置这些变量，参考 .env.example`,
  );
}
