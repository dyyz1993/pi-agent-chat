/**
 * Issue Monitor RPC handler.
 *
 * Bridges frontend RPC `issue-monitor.callChannel` to the fork extension's
 * "issue-monitor" channel via process-manager.callChannel. The extension emits
 * status events through channel_data which are routed to the frontend via
 * "issue-monitor.event" (see agent-channel-handlers / agent-event-routing).
 *
 * If the session is not live (no running agent process) or the extension is
 * not installed, returns a structured error instead of throwing, so the UI can
 * show a helpful message rather than a generic RPC failure.
 */
import type { RPCServer } from "@dyyz1993/rpc-core";
import type { HandlerOptions, R } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { createLogger } from "../lib/logger";
import { withTimeout } from "../lib/with-timeout";
import { getProcessManager } from "./agent";
import type { IssueMonitorChannelResult, IssueMonitorConfig, IssueMonitorStatusPayload } from "../modules/issue-monitor";

const log = createLogger("issue-monitor");

const CHANNEL_TIMEOUT_MS = 2_000;

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("issue-monitor.callChannel", async (params) => {
    const manager = getProcessManager();
    if (!manager || !manager.hasSession(params.sessionId)) {
      return {
        ok: false,
        error: "Agent is not running for this session. Start a session to view issue monitor status.",
      } as IssueMonitorChannelResult as R<"issue-monitor.callChannel">;
    }

    try {
      const result: unknown = await withTimeout(
        manager.callChannel(params.sessionId, "issue-monitor", params.method, {}),
        CHANNEL_TIMEOUT_MS,
      );

      // Extension returns either { status/config, ... } shape (getStatus) or a
      // config object (getConfig). Normalize into the discriminated result.
      if (
        result &&
        typeof result === "object" &&
        ("repos" in result || "interval" in result)
      ) {
        const data = result as Record<string, unknown>;
        if ("interval" in data && Array.isArray((data as { repos?: unknown }).repos)) {
          return { ok: true, config: data as unknown as IssueMonitorConfig } as IssueMonitorChannelResult as R<
            "issue-monitor.callChannel"
          >;
        }
        return { ok: true, data: data as unknown as IssueMonitorStatusPayload } as IssueMonitorChannelResult as R<
          "issue-monitor.callChannel"
        >;
      }

      log.warn("issue-monitor channel returned unexpected shape", { result });
      return {
        ok: false,
        error: "Unexpected response from issue-monitor extension.",
      } as IssueMonitorChannelResult as R<"issue-monitor.callChannel">;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.warn("issue-monitor channel call failed", { method: params.method, err: msg });
      return {
        ok: false,
        error:
          msg.includes("not found") || msg.includes("Method")
            ? "issue-monitor extension is not installed or not loaded. Build the fork and reload the agent."
            : msg,
      } as IssueMonitorChannelResult as R<"issue-monitor.callChannel">;
    }
  });
}
