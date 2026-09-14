/**
 * Gateway authentication helpers.
 *
 * Token resolution supports two sources:
 *  - The primary `authToken` (server config)
 *  - The `TOKEN_USERS` env var: "token1=user1,token2=user2"
 */

import type { IncomingMessage } from "http";

export const FS_COOKIE_NAME = "fs_token";

/** Token stored by /fs after the first query-token visit (SameSite=Strict). */
export function parseFsCookie(req: IncomingMessage): string | null {
  const cookieHeader = req.headers["cookie"] ?? "";
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === FS_COOKIE_NAME && v) return v;
  }
  return null;
}

/**
 * Resolve a token to a username using the TOKEN_USERS env var.
 * Format: "token1=user1,token2=user2"
 * Returns undefined if the token is not found.
 */
export function resolveTokenUser(token: string | null | undefined): string | undefined {
  if (!token) return undefined;
  const tokenUsersRaw = String(process.env.TOKEN_USERS ?? "");
  const pairs = tokenUsersRaw.split(",");
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].trim();
    const eq = pair.indexOf("=");
    if (eq > 0) {
      const tk = pair.substring(0, eq).trim();
      if (tk === token) return pair.substring(eq + 1).trim();
    }
  }
  return undefined;
}

/**
 * Extract the uid of the request's token across all transports
 * (query param, fs cookie, Authorization header). Returns undefined for the
 * primary admin token and for single-token deployments.
 */
export function extractRequestUserId(req: IncomingMessage): string | undefined {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    const fromQuery = resolveTokenUser(url.searchParams.get("token"));
    if (fromQuery) return fromQuery;
    const fromCookie = resolveTokenUser(parseFsCookie(req));
    if (fromCookie) return fromCookie;
    const auth = req.headers["authorization"];
    if (typeof auth === "string" && auth.startsWith("Bearer ")) {
      return resolveTokenUser(auth.slice(7));
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Check if a token is valid against the auth token or TOKEN_USERS env var.
 */
export function isValidToken(token: string | null | undefined, authToken: string): boolean {
  if (!token) return false;
  if (token === authToken) return true;
  return resolveTokenUser(token) !== undefined;
}
