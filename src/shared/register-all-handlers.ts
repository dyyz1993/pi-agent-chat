import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "./rpc-schema";
import { handlerMap, cleanupMap } from "./handlers/index";

export function registerAllHandlers(server: RPCServer, options: HandlerOptions): void {
  for (const fn of Object.values(handlerMap)) {
    fn(server, options);
  }
}

export function unregisterAllHandlers(server: RPCServer): void {
  for (const fn of Object.values(cleanupMap)) {
    fn(server);
  }
}
