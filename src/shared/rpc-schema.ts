import type { AnyMethods } from "@dyyz1993/rpc-core";
import type { SystemMethods } from "./modules/system";
import type { FileMethods } from "./modules/file";
import type { TimerMethods, TimerEvents } from "./modules/timer";
import type { ChatMethods, ChatEvents } from "./modules/chat";
import type { GitMethods } from "./modules/git";

/**
 * RPC 方法定义 — 前后端共享的唯一类型入口
 *
 * 新增方法只需两步：
 * 1. 在 modules/ 下添加类型定义，并在下方 extends 链添加
 * 2. 在 handlers/ 下添加 handler 实现（导出 register 函数）
 *
 * handlers/ 自动发现，无需修改 register-all-handlers.ts
 * 入口文件（bun/index.ts, server.ts）无需修改
 */
export interface RPCMethods extends AnyMethods, SystemMethods, FileMethods, TimerMethods, ChatMethods, GitMethods {}

/**
 * RPC 事件定义 — 合并所有模块事件
 */
export interface RPCEvents extends TimerEvents, ChatEvents {}

/**
 * Handler 注册选项
 */
export interface HandlerOptions {
  platform: "desktop" | "web";
}
