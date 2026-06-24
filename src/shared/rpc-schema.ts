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
import type { LearningMethods, LearningEvents } from "./modules/learning";
import type { RulesMethods, RulesEvents } from "./modules/rules";
import type { HooksMethods, HooksEvents } from "./modules/hooks";
import type { SnapshotMethods } from "./modules/snapshot";
import type { ChangeReviewMethods } from "./modules/change-review";
import type { CoordinatorEvents } from "./modules/coordinator";
import type { SupervisorMethods, SupervisorEvents } from "./modules/supervisor";

export interface RPCMethods
  extends
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
    LearningMethods,
    RulesMethods,
    HooksMethods,
    SnapshotMethods,
    ChangeReviewMethods,
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
    HooksEvents,
    MemoryEvents,
    LearningEvents,
    FileEvents,
    CoordinatorEvents,
    SupervisorEvents {}

export interface HandlerOptions {
  platform: "desktop" | "web";
  userId?: string;
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
