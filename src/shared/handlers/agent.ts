import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import { AgentProcessManager } from "../agent/process-manager";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

let manager: AgentProcessManager | null = null;

export function getProcessManager(): AgentProcessManager | null {
  return manager;
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  if (!manager) {
    manager = new AgentProcessManager(server);
  } else {
    manager.updateServer(server);
  }

  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  r("agent.start", async (params) => {
    log.info("start called", { sessionId: params.sessionId, projectPath: params.projectPath });
    const result = await manager!.start(params.sessionId, params.projectPath, params.sessionPath);
    log.info("start result", { result });
    return result;
  });

  r("agent.send", async (params) => {
    log.info("send called", { sessionId: params.sessionId, content: params.content });
    const ok = manager!.send(params.sessionId, params.content);
    log.info("send result", { ok });
    return { ok };
  });

  r("agent.stop", async (params) => {
    const ok = manager!.stop(params.sessionId);
    return { ok };
  });

  r("agent.status", async (params) => {
    return manager!.getStatus(params.sessionId);
  });

  r("agent.respondUI", async (params) => {
    const ok = manager!.respondUI(params.sessionId, params.requestId, params.response);
    return { ok };
  });

  r("agent.getState", async (params) => {
    return manager!.getState(params.sessionId);
  });

  r("agent.getSessionStats", async (params) => {
    return manager!.getSessionStats(params.sessionId);
  });
}
