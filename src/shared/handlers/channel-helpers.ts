import { getProcessManager } from "./agent";
import { withTimeout } from "../lib/with-timeout";

/** Default timeout for channel forwarding calls (ms). */
export const DEFAULT_CHANNEL_TIMEOUT_MS = 1_000;

/**
 * Forward a request to a CLI channel via the process manager.
 *
 * Returns the channel result, or `null` when there is no active process
 * for the session or the call throws/times out.
 *
 * @param params       RPC params; `sessionId` is used to look up the process.
 * @param channelName  Channel registered in the CLI (e.g. "hooks", "rules-engine").
 * @param methodName   Method exposed by the channel extension.
 * @param payload      Arguments passed to the channel method.
 * @param timeoutMs    Timeout in milliseconds (defaults to {@link DEFAULT_CHANNEL_TIMEOUT_MS}).
 * @param options.skipHasSessionCheck When `true`, do not call `manager.hasSession(sid)`
 *        before forwarding (some handlers only check for the manager itself,
 *        mirroring their original behaviour).
 */
export async function forwardToChannel<TResult = unknown>(
  params: { sessionId?: string } & Record<string, unknown>,
  channelName: string,
  methodName: string,
  payload: object,
  timeoutMs: number = DEFAULT_CHANNEL_TIMEOUT_MS,
  options: { skipHasSessionCheck?: boolean } = {},
): Promise<TResult | null> {
  const manager = getProcessManager();
  const sid = params.sessionId;
  if (!manager || !sid) return null;
  if (!options.skipHasSessionCheck && !manager.hasSession(sid)) return null;
  try {
    return (await withTimeout(
      manager.callChannel(sid, channelName, methodName, payload as Record<string, unknown>),
      timeoutMs,
    )) as TResult;
  } catch {
    return null;
  }
}
