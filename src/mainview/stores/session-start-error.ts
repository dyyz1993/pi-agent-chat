import type { ProjectTab } from "../types";

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export function formatProjectStartError(err: unknown, tab?: ProjectTab | null): string {
  const message = getErrorMessage(err);
  const remote = tab?.remote;
  if (tab?.runtime !== "ssh" && remote?.runtime !== "ssh") {
    return message;
  }

  const details = ["SSH remote project failed to start."];
  if (remote?.host) details.push(`Host: ${remote.host}`);
  if (remote?.remotePath) details.push(`Remote path: ${remote.remotePath}`);
  details.push(`Reason: ${message}`);
  return details.join("\n");
}
