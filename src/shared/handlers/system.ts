import type { RPCServer } from "@dyyz1993/rpc-core";
import type { MethodParams, MethodResult } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";

type RegisterFn = <K extends keyof RPCMethods & string>(
  method: K,
  handler: (params: MethodParams<RPCMethods, K>) => Promise<MethodResult<RPCMethods, K>>,
) => void;

export function register(server: RPCServer, options: HandlerOptions): void {
  const r: RegisterFn = (method, handler) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  r("system.ping", async () => ({
    pong: true,
    timestamp: Date.now(),
    platform: options.platform,
  }));

  r("system.hello", async (params) => ({
    message: `Hello ${params.name || "World"}!`,
    timestamp: Date.now(),
  }));

  r("system.echo", async (params) => params);
}
