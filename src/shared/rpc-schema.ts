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

export interface RPCMethods extends AnyMethods, SystemMethods, FileMethods, TimerMethods, GitMethods, ProjectMethods, SessionMethods, AgentMethods, SubagentMethods, TodoMethods {}

export interface RPCEvents extends TimerEvents, AgentEvents, SubagentEvents, TodoEvents {}

export interface HandlerOptions {
  platform: "desktop" | "web";
}
