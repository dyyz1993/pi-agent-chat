import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import type { BashProcess } from "../modules/bash";
import type { BashChannelCommand } from "../modules/bash";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { getProcessManager } from "./agent";

type P<K extends keyof RPCMethods> = RPCMethods[K] extends { params: infer P } ? P : never;
type R<K extends keyof RPCMethods> = RPCMethods[K] extends { result: infer R } ? R : never;

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = <K extends keyof RPCMethods & string>(
    method: K,
    handler: (params: P<K>) => Promise<R<K>>,
  ) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

  r("bash.list", async (params) => {
    const { sessionPath } = params;

    if (!existsSync(sessionPath)) {
      return { processes: [] };
    }

    try {
      const content = await readFile(sessionPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      const processes: BashProcess[] = [];

      for (const line of lines) {
        try {
          const entry = JSON.parse(line);

          if (entry.type === "custom" && entry.customType === "bash") {
            const data = entry.data as { type: string; process: BashProcess; timestamp: number } | undefined;
            if (data?.process) {
              processes.push(data.process);
            }
          }
        } catch {
          continue;
        }
      }

      return { processes };
    } catch {
      return { processes: [] };
    }
  });

  r("bash.command", async (params) => {
    const { sessionId, action, toolCallId } = params as {
      sessionId: string;
    } & BashChannelCommand & { sessionId: string };

    const pm = getProcessManager();
    if (!pm) throw new Error("No process manager available");
    pm.sendChannelData(sessionId, "bash", { action, toolCallId });

    return { ok: true };
  });
}
