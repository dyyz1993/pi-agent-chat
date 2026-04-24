import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import type { SessionEntry } from "../modules/session";
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

  r("session.getEntries", async (params) => {
    const { sessionPath, limit = 200, cursor } = params;

    if (!existsSync(sessionPath)) {
      return { entries: [], hasMore: false };
    }

    const content = await readFile(sessionPath, "utf-8");
    const allLines = content.split("\n").filter((l) => l.trim());

    const startIdx = cursor ? parseInt(cursor, 10) : 1;
    const entries: SessionEntry[] = [];

    for (let i = startIdx; i < allLines.length && entries.length < limit; i++) {
      try {
        const parsed = JSON.parse(allLines[i]);
        entries.push({
          id: parsed.id || `entry-${i}`,
          type: (parsed.type || "custom") as SessionEntry["type"],
          parentId: parsed.parentId || null,
          timestamp: new Date(parsed.timestamp || 0).getTime(),
          data: parsed,
        });
      } catch {
        continue;
      }
    }

    const hasMore = startIdx + limit < allLines.length;
    return { entries, hasMore };
  });
}
