import type { RPCServer } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
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

  r("lsp.status", async (params) => {
    const { sessionPath } = params;

    if (!existsSync(sessionPath)) {
      return { state: "inactive" as const, servers: [], mode: "agent_end" as const };
    }

    try {
      const content = await readFile(sessionPath, "utf-8");
      const lines = content.split("\n").filter((l) => l.trim());

      let lastStatus: { state: string; servers?: unknown[]; reason?: string } | null = null;
      let lastMode = "agent_end";

      for (const line of lines.reverse()) {
        try {
          const entry = JSON.parse(line);
          if (entry.type === "custom" && entry.customType === "lsp") {
            const data = entry.data as { event: string; state?: string; mode?: string; servers?: unknown[]; reason?: string };
            if (data.event === "status_changed" && !lastStatus) {
              lastStatus = { state: data.state ?? "inactive", servers: data.servers, reason: data.reason };
            }
            if (data.event === "mode_changed" && lastMode === "agent_end") {
              lastMode = data.mode ?? "agent_end";
            }
          }
        } catch {
          continue;
        }
        if (lastStatus) break;
      }

      return {
        state: (lastStatus?.state ?? "inactive") as "inactive" | "starting" | "ready" | "error",
        servers: (lastStatus?.servers ?? []) as unknown as import("../modules/lsp").LspServerStatus[],
        mode: lastMode as import("../modules/lsp").LspDiagnosticsMode,
      };
    } catch {
      return { state: "inactive" as const, servers: [], mode: "agent_end" as const };
    }
  });

  r("lsp.setMode", async (params) => {
    const { sessionId, mode } = params as { sessionId: string; mode: import("../modules/lsp").LspDiagnosticsMode };
    const pm = getProcessManager();
    if (!pm) throw new Error("No process manager available");
    pm.sendChannelData(sessionId, "lsp", { action: "setMode", mode });

    return { ok: true, mode };
  });
}
