import type { AnyMethods } from "@dyyz1993/rpc-core";
import type { SystemMethods } from "./modules/system";
import type { FileMethods } from "./modules/file";
import type { TimerMethods, TimerEvents } from "./modules/timer";
import type { GitMethods } from "./modules/git";
import type { ProjectMethods } from "./modules/project";
import type { SessionMethods } from "./modules/session";
import type { AgentMethods, AgentEvents } from "./modules/agent";

export interface RPCMethods extends AnyMethods, SystemMethods, FileMethods, TimerMethods, GitMethods, ProjectMethods, SessionMethods, AgentMethods {}

export interface RPCEvents extends TimerEvents, AgentEvents {}

export interface HandlerOptions {
  platform: "desktop" | "web";
}
