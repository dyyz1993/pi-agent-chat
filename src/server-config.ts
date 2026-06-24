/**
 * Web server configuration — single source of truth.
 * Values are read from environment variables with sensible defaults.
 *
 * PI_CLI_PATH — 必须通过环境变量或 .env 设置。
 * 扩展路径从全局目录 ~/.pi/agent/extensions/ 自动发现，无需逐个配置。
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { createLogger } from "./shared/lib/logger";

const log = createLogger("config");

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
  /** 沙箱模式：启用后 agent 在隔离沙箱中运行 */
  sandboxEnabled: process.env.SANDBOX_ENABLED === "true",
  /** 沙盒/远程后端类型: local | sandbox-box | ssh | cloudflare */
  sandboxProvider: (process.env.SANDBOX_PROVIDER ?? "local") as
    | "local"
    | "sandbox-box"
    | "ssh"
    | "cloudflare",
  /** 沙箱基础端口（local provider） */
  sandboxBasePort: parseInt(process.env.SANDBOX_BASE_PORT ?? "3200", 10),
  /** sandbox-box SSH 连接地址 */
  sandboxBoxSshHost: process.env.SANDBOX_BOX_SSH_HOST ?? "192.168.0.29",
  /** sandbox-box SSH 端口 */
  sandboxBoxSshPort: parseInt(process.env.SANDBOX_BOX_SSH_PORT ?? "2201", 10),
  /** sandbox-box SSH 用户 */
  sandboxBoxSshUser: process.env.SANDBOX_BOX_SSH_USER ?? "root",
  /** sandbox-box SSH 密钥路径 */
  sandboxBoxSshKey: process.env.SANDBOX_BOX_SSH_KEY ?? "",
  /** sandbox-box models.json 路径 */
  sandboxBoxModelsJson: process.env.SANDBOX_BOX_MODELS_JSON ?? "",
  /** sandbox-box settings.json 路径 */
  sandboxBoxSettingsJson: process.env.SANDBOX_BOX_SETTINGS_JSON ?? "",
  /** sandbox-box 扩展路径 */
  sandboxBoxExtensionsPath: process.env.SANDBOX_BOX_EXTENSIONS_PATH ?? "",
  /** 沙箱空闲超时（秒） */
  sandboxIdleTimeout: parseInt(process.env.SANDBOX_IDLE_TIMEOUT ?? "1800", 10),
  /** 轻量 SSH runtime 连接目标，支持 ~/.ssh/config Host 或 user@host */
  remoteSshTarget: process.env.REMOTE_SSH_TARGET ?? "",
  /** 轻量 SSH runtime 端口，不填则使用 ssh config 默认值 */
  remoteSshPort: process.env.REMOTE_SSH_PORT
    ? parseInt(process.env.REMOTE_SSH_PORT, 10)
    : undefined,
  /** 轻量 SSH runtime 私钥路径，不填则使用 ssh config 默认值 */
  remoteSshKey: process.env.REMOTE_SSH_KEY ?? "",
  /** 远端真实项目目录 */
  remoteProjectPath: process.env.REMOTE_PROJECT_PATH ?? "",
  /** 远端 bridge/agent bundle 存放目录 */
  remoteAgentDir: process.env.REMOTE_AGENT_DIR ?? "~/.pi/agent/remote-runtime",
  /** 远端 pi CLI 路径，可为 pi 或具体 cli.js */
  remotePiCliPath: process.env.REMOTE_PI_CLI_PATH ?? "pi",
  /** 远端 node 路径 */
  remoteNodePath: process.env.REMOTE_NODE_PATH ?? "node",
  /** 远端启动命令使用的 shell 包装；默认使用 POSIX sh，避免要求远端安装 zsh */
  remoteShell: process.env.REMOTE_SHELL ?? "sh -lc",
  /** 远端 PI_CODING_AGENT_DIR；不填则使用远端 pi 默认值 */
  remotePiAgentDir: process.env.REMOTE_PI_AGENT_DIR ?? "",
  /** 远端 bridge 监听端口，仅监听 127.0.0.1 后通过 SSH tunnel 访问 */
  remoteBridgePort: parseInt(process.env.REMOTE_BRIDGE_PORT ?? "3101", 10),
  /** 本地 tunnel 基础端口 */
  remoteLocalBasePort: parseInt(process.env.REMOTE_LOCAL_BASE_PORT ?? "3300", 10),
  /** 远端 pi 子进程 Node 内存上限，默认偏轻量 */
  remoteChildNodeOptions: process.env.REMOTE_CHILD_NODE_OPTIONS ?? "--max-old-space-size=1536",
  /** 远端没有 pi 命令时，是否上传本地 yalc 包到远端私有目录 */
  remoteBootstrapPiPackage: process.env.REMOTE_BOOTSTRAP_PI_PACKAGE !== "false",
  /** 本地 pi-coding-agent 包目录，用于 SSH runtime 私有 bootstrap */
  remoteLocalPiPackagePath:
    process.env.REMOTE_LOCAL_PI_PACKAGE_PATH ??
    ".yalc/@dyyz1993/pi-coding-agent",
  /** 本地 pi monorepo packages 目录；提供时用于同步完整 workspace 包而不是 yalc stub */
  remoteLocalPiWorkspacePackagesPath:
    process.env.REMOTE_LOCAL_PI_WORKSPACE_PACKAGES_PATH ?? "",
  /** Remote child MVP：直接通过 SSH 启动远端 pi --mode rpc，而不是本地 CLI 或 sandbox bridge */
  remoteChildEnabled: process.env.REMOTE_CHILD_ENABLED === "true",
  /** Remote child 工作目录；默认复用 REMOTE_PROJECT_PATH */
  remoteChildProjectPath:
    process.env.REMOTE_CHILD_PROJECT_PATH ?? process.env.REMOTE_PROJECT_PATH ?? "",
  /** Remote child CLI 路径；可为可执行 pi，或配合 REMOTE_CHILD_NODE_PATH 指向 cli.js */
  remoteChildPiCliPath:
    process.env.REMOTE_CHILD_PI_CLI_PATH ??
    process.env.REMOTE_PI_CLI_PATH ??
    "pi",
  /** Remote child node 路径；设为空字符串表示直接执行 REMOTE_CHILD_PI_CLI_PATH */
  remoteChildNodePath:
    process.env.REMOTE_CHILD_NODE_PATH ??
    process.env.REMOTE_NODE_PATH ??
    "node",
  /** Remote child shell wrapper */
  remoteChildShell:
    process.env.REMOTE_CHILD_SHELL ?? process.env.REMOTE_SHELL ?? "sh -lc",
  /** Remote child 本地单文件二进制；设置后启动前会自动上传到远端版本目录 */
  remoteChildLocalBinaryPath: process.env.REMOTE_CHILD_LOCAL_BINARY_PATH ?? "",
  /** Remote child 本地内置 extensions 目录；不填则使用当前 pi 包的 dist/extensions */
  remoteChildLocalExtensionsDir: process.env.REMOTE_CHILD_LOCAL_EXTENSIONS_DIR ?? "",
  /** Remote child 远端 runtime 根目录 */
  remoteChildRemoteRuntimeDir:
    process.env.REMOTE_CHILD_REMOTE_RUNTIME_DIR ??
    `${process.env.REMOTE_AGENT_DIR ?? "~/.pi/agent/remote-runtime"}/child`,
  /** Remote child 远端二进制文件名 */
  remoteChildBinaryName: process.env.REMOTE_CHILD_BINARY_NAME ?? "pi",
  /** 是否自动上传本地 remote child 二进制 */
  remoteChildAutoUpload: process.env.REMOTE_CHILD_AUTO_UPLOAD !== "false",
  /** Standard SSH 启动前是否同步本地低风险资源（skills/agents/rules）到远端 managed agent dir */
  remoteResourceSyncEnabled: process.env.REMOTE_RESOURCE_SYNC !== "false",
  /** 本地资源同步源，默认使用 PI_CODING_AGENT_DIR 或 ~/.pi/agent */
  remoteResourceSyncLocalAgentDir: process.env.REMOTE_RESOURCE_SYNC_LOCAL_AGENT_DIR ?? "",
  /** 远端 managed PI_CODING_AGENT_DIR；不填则使用 REMOTE_CHILD_REMOTE_RUNTIME_DIR/agent-resources */
  remoteResourceSyncRemoteAgentDir: process.env.REMOTE_RESOURCE_SYNC_REMOTE_AGENT_DIR ?? "",
} as const;

if (MISSING_PI_VARS.length > 0) {
  log.warn(
    `以下环境变量未设置，PI Agent 功能将无法正常工作:\n` +
      MISSING_PI_VARS.map((v) => `  - ${v}`).join("\n") +
      `\n请在 .env 文件中配置这些变量，参考 .env.example`,
  );
}
