import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import type { SubagentSessionInfo } from "../modules/subagent";
import { readFile } from "fs/promises";
import { existsSync } from "fs";

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  r("subagent.listBySession", async (params) => {
    const { sessionPath } = params;

    if (!existsSync(sessionPath)) {
      return { subsessions: [] };
    }

    const content = await readFile(sessionPath, "utf-8");
    const lines = content.split("\n").filter((l) => l.trim());
    const subsessions: SubagentSessionInfo[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as Record<string, unknown>;

        if (entry.type === "custom" && entry.customType === "subagent") {
          const data = entry.data as SubagentSessionInfo | undefined;
          if (data?.sessionId && data?.sessionPath) {
            subsessions.push(data);
          }
        }
      } catch {
        continue;
      }
    }

    return { subsessions };
  });
}
