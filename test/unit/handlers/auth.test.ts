import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveTokenUser, isValidToken } from "../../../src/gateway/auth";

describe("gateway/auth", () => {
  const ENV_BACKUP = { ...process.env };

  beforeEach(() => {
    delete process.env.TOKEN_USERS;
  });

  afterEach(() => {
    // Restore only the TOKEN_USERS key to avoid cross-test pollution.
    if ("TOKEN_USERS" in ENV_BACKUP) {
      process.env.TOKEN_USERS = ENV_BACKUP.TOKEN_USERS;
    } else {
      delete process.env.TOKEN_USERS;
    }
  });

  describe("resolveTokenUser", () => {
    it("matches a single token=user pair", () => {
      process.env.TOKEN_USERS = "abc=alice";
      expect(resolveTokenUser("abc")).toBe("alice");
    });

    it("returns undefined when token is not present", () => {
      process.env.TOKEN_USERS = "abc=alice";
      expect(resolveTokenUser("missing")).toBeUndefined();
    });

    it("returns undefined when TOKEN_USERS is unset/empty", () => {
      expect(resolveTokenUser("abc")).toBeUndefined();
    });

    it("matches the correct user across multiple pairs", () => {
      process.env.TOKEN_USERS = "abc=alice,def=bob,ghi=carol";
      expect(resolveTokenUser("def")).toBe("bob");
      expect(resolveTokenUser("ghi")).toBe("carol");
    });

    it("trims whitespace around tokens and values", () => {
      process.env.TOKEN_USERS = " abc = alice , def = bob ";
      expect(resolveTokenUser("abc")).toBe("alice");
      expect(resolveTokenUser("def")).toBe("bob");
    });

    it("skips entries without an '=' separator", () => {
      process.env.TOKEN_USERS = "garbage,abc=alice";
      expect(resolveTokenUser("garbage")).toBeUndefined();
      expect(resolveTokenUser("abc")).toBe("alice");
    });

    it("preserves '=' characters that appear in the value", () => {
      process.env.TOKEN_USERS = "abc=us=er";
      expect(resolveTokenUser("abc")).toBe("us=er");
    });

    it("skips entries whose '=' is at position 0 (empty key)", () => {
      process.env.TOKEN_USERS = "=nokey,abc=alice";
      expect(resolveTokenUser("")).toBeUndefined();
      expect(resolveTokenUser("abc")).toBe("alice");
    });
  });

  describe("isValidToken", () => {
    const authToken = "server-secret";

    it("returns true when token equals authToken", () => {
      expect(isValidToken("server-secret", authToken)).toBe(true);
    });

    it("returns true when token is listed in TOKEN_USERS", () => {
      process.env.TOKEN_USERS = "user-token=alice";
      expect(isValidToken("user-token", authToken)).toBe(true);
    });

    it("returns false when token is neither authToken nor in TOKEN_USERS", () => {
      process.env.TOKEN_USERS = "user-token=alice";
      expect(isValidToken("bogus", authToken)).toBe(false);
    });

    it("returns false when token is null", () => {
      expect(isValidToken(null, authToken)).toBe(false);
    });

    it("returns false when token is empty string", () => {
      expect(isValidToken("", authToken)).toBe(false);
    });

    it("returns false when token is undefined", () => {
      expect(isValidToken(undefined, authToken)).toBe(false);
    });

    it("prefers authToken match even when TOKEN_USERS is empty", () => {
      expect(isValidToken("server-secret", authToken)).toBe(true);
    });
  });
});
