import type { ProjectTab } from "../types";

function isSshProject(tab?: ProjectTab | null): boolean {
  return tab?.runtime === "ssh" || tab?.remote?.runtime === "ssh";
}

export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  return String(err);
}

export function isDisconnectedRemoteProject(tab?: ProjectTab | null): boolean {
  return isSshProject(tab) && tab?.connected === false;
}

export function formatDisconnectedRemoteProjectError(tab?: ProjectTab | null): string {
  const remote = tab?.remote;
  const details = ["SSH remote project is disconnected."];
  if (remote?.host) details.push(`Host: ${remote.host}`);
  if (remote?.remotePath) details.push(`Remote path: ${remote.remotePath}`);
  details.push("Please reconnect this remote project before opening or creating sessions.");
  return details.join("\n");
}

export function formatProjectStartError(err: unknown, tab?: ProjectTab | null): string {
  const message = getErrorMessage(err);
  const remote = tab?.remote;
  if (!isSshProject(tab)) {
    return message;
  }

  const details = ["SSH remote project failed to start."];
  if (remote?.host) details.push(`Host: ${remote.host}`);
  if (remote?.remotePath) details.push(`Remote path: ${remote.remotePath}`);
  details.push(`Reason: ${message}`);
  return details.join("\n");
}
