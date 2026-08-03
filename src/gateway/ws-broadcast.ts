import type WebSocket from "ws";
import { createLogger } from "../shared/lib/logger";

const log = createLogger("gateway");

/**
 * Send a message to a single WebSocket client without throwing when the
 * underlying transport is closed or in a bad state. Used by broadcast
 * loops where one bad client must not abort delivery to the others.
 */
export function safeWsSend(ws: WebSocket, msg: string): void {
  try {
    ws.send(msg);
  } catch (err) {
    log.warn("Failed to broadcast event to a WebSocket client", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
