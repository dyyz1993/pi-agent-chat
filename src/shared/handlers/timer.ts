import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

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
