import type { ImageContent } from "@dyyz1993/pi-ai";

import { apiClient } from "../lib/api-client";

const SEND_TIMEOUT_MS = 60_000;

export function isAgentNotStartedError(err: unknown, sessionId: string): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes(`Agent not started for session ${sessionId}`);
}

export async function sendAgentMessageWithTimeout(
  sessionId: string,
  content: string,
  images: ImageContent[],
): Promise<void> {
  const sendPromise = apiClient.call("agent.send", {
    sessionId,
    content,
    images,
  });
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Send timed out (60s)")), SEND_TIMEOUT_MS),
  );
  await Promise.race([sendPromise, timeoutPromise]);
}
