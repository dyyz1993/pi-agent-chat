import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { register as system } from "./system";
import { register as file } from "./file";
import { register as timer } from "./timer";
import { register as git } from "./git";
import { register as project } from "./project";
import { register as session } from "./session";
import { register as agent } from "./agent";
import { register as subagent } from "./subagent";
import { register as todo } from "./todo";
import { register as bash } from "./bash";
import { register as lsp } from "./lsp";
import { register as memory } from "./memory";
import { register as learning } from "./learning";
import { register as usage } from "./usage";
import { register as rules } from "./rules";
import { register as hooks } from "./hooks";
import { register as snapshot } from "./snapshot";
import { register as changeReview } from "./change-review";
import { register as supervisor } from "./supervisor";
import { register as updater } from "./updater";
import { unregister as agentCleanup } from "./agent";

type RegisterFn = (server: RPCServer, options: HandlerOptions) => void;
type CleanupFn = (server: RPCServer) => void;

export const handlerMap: Record<string, RegisterFn> = {
  system,
  file,
  timer,
  git,
  project,
  session,
  agent,
  subagent,
  todo,
  bash,
  lsp,
  memory,
  learning,
  usage,
  rules,
  hooks,
  snapshot,
  changeReview,
  supervisor,
  updater,
};

export const cleanupMap: Record<string, CleanupFn> = {
  agentCleanup,
};
