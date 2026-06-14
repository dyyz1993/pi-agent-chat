/**
 * Gateway authentication helpers.
 *
 * Token resolution supports two sources:
 *  - The primary `authToken` (server config)
 *  - The `TOKEN_USERS` env var: "token1=user1,token2=user2"
 */

/**
 * Resolve a token to a username using the TOKEN_USERS env var.
 * Format: "token1=user1,token2=user2"
 * Returns undefined if the token is not found.
 */
export function resolveTokenUser(token: string): string | undefined {
  const tokenUsersRaw = String(process.env.TOKEN_USERS);
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
 * Check if a token is valid against the auth token or TOKEN_USERS env var.
 */
export function isValidToken(token: string | null | undefined, authToken: string): boolean {
  if (!token) return false;
  if (token === authToken) return true;
  return resolveTokenUser(token) !== undefined;
}
