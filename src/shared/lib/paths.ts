/**
 * 部署感知的路径工具
 *
 * 开发环境：process.cwd() = 项目根，用 bun 跑 .ts
 * 生产环境：process.cwd() = 部署目录，用 node 跑 .js
 */

import { resolve } from "node:path";
import { existsSync } from "node:fs";

/** 项目根目录（dev 和 prod 都是 process.cwd()） */
export function getProjectRoot(): string {
  return process.cwd();
}

/** sandbox-agent 入口文件路径 */
export function getSandboxAgentPath(): string {
  const root = getProjectRoot();
  const prodPath = resolve(root, "dist-server/sandbox-agent.js");
  if (existsSync(prodPath)) return prodPath;
  return resolve(root, "src/sandbox/sandbox-agent.ts");
}

/** sandbox-agent 运行器命令 */
export function getSandboxAgentRunner(): string {
  // bun 可以直接跑 .ts；node 只能跑 .js
  const isBun = process.execPath.includes("bun");
  if (isBun) return "bun";
  // 生产环境用 node
  return "node";
}
