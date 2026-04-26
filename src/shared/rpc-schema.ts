import type { AnyMethods } from "@dyyz1993/rpc-core";
import type { SystemMethods } from "./modules/system";
import type { FileMethods } from "./modules/file";
import type { TimerMethods, TimerEvents } from "./modules/timer";
import type { GitMethods } from "./modules/git";
import type { ProjectMethods } from "./modules/project";
import type { SessionMethods } from "./modules/session";
import type { AgentMethods, AgentEvents } from "./modules/agent";
import type { SubagentMethods, SubagentEvents } from "./modules/subagent";
import type { TodoMethods, TodoEvents } from "./modules/todo";
import type { BashMethods, BashEvents } from "./modules/bash";
import type { LspMethods, LspEvents } from "./modules/lsp";
import type { MemoryMethods } from "./modules/memory";

export interface RPCMethods extends AnyMethods, SystemMethods, FileMethods, TimerMethods, GitMethods, ProjectMethods, SessionMethods, AgentMethods, SubagentMethods, TodoMethods, BashMethods, LspMethods, MemoryMethods {}

export interface RPCEvents extends TimerEvents, AgentEvents, SubagentEvents, TodoEvents, BashEvents, LspEvents {}

export interface HandlerOptions {
  platform: "desktop" | "web";
}
