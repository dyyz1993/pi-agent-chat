import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";

export function register(server: RPCServer, options: HandlerOptions): void {
  const r = createRegister(server);

  r("system.ping", async () => ({
    pong: true,
    timestamp: Date.now(),
    platform: options.platform,
  }));

  r("system.hello", async (params) => ({
    message: `Hello ${params.name ?? "World"}!`,
    timestamp: Date.now(),
  }));

  r("system.echo", async (params) => params);
}
