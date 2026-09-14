/**
 * Session ownership + per-user file roots for multi-token deployments.
 *
 * Threat model: with TOKEN_USERS configured, every token maps to a uid. The
 * primary AUTH_TOKEN is the admin and has no uid — admin always passes.
 * Token-users may only touch sessions they created and file paths inside
 * projects they opened.
 *
 * P0 scope: ownership lives in server memory (bounded). After a server
 * restart, a token-user's previous sessions become inaccessible again
 * (fail-closed); the admin account is unaffected. Single-token and desktop
 * deployments have no uid at all, so behavior is unchanged.
 */

import { resolve } from "path";
import { createLogger } from "../lib/logger";

const log = createLogger("session");

// sessionId -> owner uid. Sessions created by the admin are not registered.
const owners = new Map<string, string>();

// uid -> canonical project roots the user opened sessions on.
const userRoots = new Map<string, Set<string>>();

// Bounded registries (see bounded-memory-windows invariant): drop oldest
// entries rather than growing without limit.
const MAX_OWNED_SESSIONS = 10_000;
const MAX_ROOTS_PER_USER = 500;

export function setSessionOwner(sessionId: string, uid: string | undefined): void {
  if (!uid) return;
  if (owners.size >= MAX_OWNED_SESSIONS && !owners.has(sessionId)) {
    const oldest = owners.keys().next().value;
    if (oldest !== undefined) owners.delete(oldest);
  }
  owners.set(sessionId, uid);
}

export function getSessionOwner(sessionId: string): string | undefined {
  return owners.get(sessionId);
}

export function clearSessionOwner(sessionId: string): void {
  owners.delete(sessionId);
}

export function addUserProjectRoot(uid: string, projectPath: string): void {
  let roots = userRoots.get(uid);
  if (!roots) {
    roots = new Set<string>();
    userRoots.set(uid, roots);
  }
  if (roots.size >= MAX_ROOTS_PER_USER) {
    const oldest = roots.values().next().value;
    if (oldest !== undefined) roots.delete(oldest);
  }
  roots.add(resolve(projectPath));
}

export function getUserProjectRoots(uid: string): string[] {
  return [...(userRoots.get(uid) ?? [])];
}

export function canAccessSession(sessionId: string, uid: string | undefined): boolean {
  if (!uid) return true;
  const owner = owners.get(sessionId);
  return owner !== undefined && owner === uid;
}

function extractSessionId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const sessionId = (value as Record<string, unknown>).sessionId;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}

/** Gate for WS RPC requests: any request carrying a sessionId must be owned. */
export function isRequestAllowed(
  _method: string,
  params: unknown,
  uid: string | undefined,
): boolean {
  if (!uid) return true;
  const sessionId = extractSessionId(params);
  if (!sessionId) return true;
  if (canAccessSession(sessionId, uid)) return true;
  log.warn("RPC denied: session not owned by caller", { sessionId, uid });
  return false;
}

/**
 * Gate for broadcast events: events scoped to a sessionId are only delivered
 * to connections that may access that session. Global events (no sessionId)
 * stay visible to everyone.
 */
export function isEventVisible(
  _eventType: string,
  payload: unknown,
  metadata: unknown,
  uid: string | undefined,
): boolean {
  if (!uid) return true;
  const sessionId = extractSessionId(payload) ?? extractSessionId(metadata);
  if (!sessionId) return true;
  return canAccessSession(sessionId, uid);
}
