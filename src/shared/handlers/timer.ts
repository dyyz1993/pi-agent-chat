import type { RPCServer } from "@dyyz1993/rpc-core";
import type { MethodParams, MethodResult } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";

type RegisterFn = <K extends keyof RPCMethods & string>(
  method: K,
  handler: (params: MethodParams<RPCMethods, K>) => Promise<MethodResult<RPCMethods, K>>,
) => void;

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r: RegisterFn = (method, handler) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  let timerId: ReturnType<typeof setInterval> | null = null;

  r("timer.start", async () => {
    if (timerId !== null) return { alreadyRunning: true };
    let count = 0;
    timerId = setInterval(() => {
      count++;
      server.emitEvent("timer.tick", { count, timestamp: Date.now() });
    }, 1000);
    return { started: true };
  });

  r("timer.stop", async () => {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
    return { stopped: true };
  });
}
