import type { AnyMethods, RPCServer } from "@dyyz1993/rpc-core";
import type { SystemMethods } from "./modules/system";
import type { FileMethods, FileEvents } from "./modules/file";
import type { TimerMethods, TimerEvents } from "./modules/timer";
import type { GitMethods } from "./modules/git";
import type { ProjectMethods } from "./modules/project";
import type { SessionMethods } from "./modules/session";
import type { AgentMethods, AgentEvents } from "./modules/agent";
import type { SubagentMethods, SubagentEvents } from "./modules/subagent";
import type { TodoMethods, TodoEvents } from "./modules/todo";
import type { BashMethods, BashEvents } from "./modules/bash";
import type { LspMethods, LspEvents } from "./modules/lsp";
import type { MemoryMethods, MemoryEvents } from "./modules/memory";
import type { RulesMethods, RulesEvents } from "./modules/rules";
import type { SnapshotMethods } from "./modules/snapshot";
import type { CoordinatorEvents } from "./modules/coordinator";
import type { SupervisorMethods, SupervisorEvents } from "./modules/supervisor";

export interface RPCMethods
  extends
    AnyMethods,
    SystemMethods,
    FileMethods,
    TimerMethods,
    GitMethods,
    ProjectMethods,
    SessionMethods,
    AgentMethods,
    SubagentMethods,
    TodoMethods,
    BashMethods,
    LspMethods,
    MemoryMethods,
    RulesMethods,
    SnapshotMethods,
    SupervisorMethods {}

export interface RPCEvents
  extends
    TimerEvents,
    AgentEvents,
    SubagentEvents,
    TodoEvents,
    BashEvents,
    LspEvents,
    RulesEvents,
    MemoryEvents,
    FileEvents,
    CoordinatorEvents,
    SupervisorEvents {}

export interface HandlerOptions {
  platform: "desktop" | "web";
}

export interface HandlerRegister {
  (server: RPCServer, options: HandlerOptions): void;
  readonly __handlerType: "register";
}

export interface HandlerCleanup {
  (server: RPCServer): void;
  readonly __handlerType: "cleanup";
}

export function asRegister(
  fn: (server: RPCServer, options: HandlerOptions) => void,
): HandlerRegister {
  return fn as HandlerRegister;
}

export function asCleanup(fn: (server: RPCServer) => void): HandlerCleanup {
  return fn as HandlerCleanup;
}

export type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;

export type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

export function createRegister(rpcSrv: {
  register: (method: string, handler: (params: unknown) => Promise<unknown>) => void;
}) {
  return <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    rpcSrv.register(method, handler as (params: unknown) => Promise<unknown>);
  };
}
