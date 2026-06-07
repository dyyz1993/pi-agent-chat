import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import { getProcessManager } from "./agent";
import type { LspDiagnosticsMode, LspServerStatus } from "../modules/lsp";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";

const log = createLogger("lsp");

const CHANNEL_TIMEOUT_MS = 1_000;

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("lsp.status", async (params) => {
    const pm = getProcessManager();

    if (params.sessionId && pm) {
      const cached = pm.getCachedLspState(params.sessionId);
      if (cached) {
        const servers = (cached.servers as Array<Record<string, unknown>>).map((s) => {
          const st = s.status as
            | {
                state?: string;
                reason?: string;
                transport?: string;
                activeCommand?: string[];
                configuredCommand?: string[];
              }
            | undefined;
          return {
            name: s.name as string,
            fileTypes: s.fileTypes as string[] | undefined,
            state: (st?.state ?? s.state ?? "inactive") as LspServerStatus["state"],
            reason: st?.reason ?? (s.reason as string | undefined) ?? "",
            transport: st?.transport,
            activeCommand: st?.activeCommand,
            configuredCommand: st?.configuredCommand,
          } satisfies LspServerStatus;
        });
        return {
          state: cached.state as "inactive" | "starting" | "ready" | "error",
          servers,
          mode: (cached.mode ?? "agent_end") as LspDiagnosticsMode,
        };
      }

      if (pm.hasSession(params.sessionId)) {
        try {
          const raw: unknown = await withTimeout(
            pm.callChannel(
              params.sessionId,
              "lsp" as string,
              "getStatus",
              {},
            ),
            CHANNEL_TIMEOUT_MS,
          );
          const result = raw as {
            servers: Array<{ name: string; fileTypes?: string[]; state: string; reason: string }>;
            state: string;
            mode: string;
          };
          const servers: LspServerStatus[] = result.servers.map((s) => ({
            name: s.name as string,
            fileTypes: s.fileTypes as string[] | undefined,
            state: s.state as LspServerStatus["state"],
            reason: (s.reason as string) ?? "",
          }));
          const state = result.state as "inactive" | "starting" | "ready" | "error";
          return { state, servers, mode: result.mode as LspDiagnosticsMode };
        } catch (e) {
          log.debug("lsp.status: LSP channel not ready, falling back to JSONL", {
            sessionId: params.sessionId,
            error: String(e),
          });
        }
      }
    }

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
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (entry.type === "custom" && entry.customType === "lsp") {
            const data = entry.data as {
              event: string;
              state?: string;
              mode?: string;
              servers?: unknown[];
              reason?: string;
            };
            if (data.event === "status_changed" && !lastStatus) {
              lastStatus = {
                state: data.state ?? "inactive",
                servers: data.servers,
                reason: data.reason,
              };
            }
            if (data.event === "mode_changed" && lastMode === "agent_end") {
              lastMode = data.mode ?? "agent_end";
            }
          }
        } catch {
          log.debug("lsp.status: skipping malformed JSONL line", { line });
          continue;
        }
        if (lastStatus) break;
      }

      return {
        state: (lastStatus?.state ?? "inactive") as "inactive" | "starting" | "ready" | "error",
        servers: (lastStatus?.servers ?? []) as unknown as LspServerStatus[],
        mode: lastMode as LspDiagnosticsMode,
      };
    } catch (e) {
      log.debug("lsp.status: failed to read session file, returning inactive", {
        sessionPath,
        error: String(e),
      });
      return { state: "inactive" as const, servers: [], mode: "agent_end" as const };
    }
  });

  r("lsp.setMode", async (params) => {
    const { sessionId, mode } = params as { sessionId: string; mode: LspDiagnosticsMode };
    const pm = getProcessManager();
    if (!pm) throw new Error("No process manager available");
    try {
      const result = (await withTimeout(
        pm.callChannel(sessionId, "lsp", "lsp.setMode", {
          mode,
        }),
        CHANNEL_TIMEOUT_MS,
      )) as { ok: boolean; mode: LspDiagnosticsMode };
      return result;
    } catch (err) {
      log.warn("lsp.setMode channel call failed", {
        sessionId,
        err: err instanceof Error ? err.message : String(err),
      });
      return { ok: false, mode };
    }
  });
}
