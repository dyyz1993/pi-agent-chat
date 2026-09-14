import { describe, it, expect } from "vitest";
import { isPathAllowed, isPathReadable } from "../../../src/gateway/path-guard";
import { addUserProjectRoot } from "../../../src/shared/agent/session-ownership";

describe("path-guard user scoping", () => {
  it("token-user can access own project roots and scratch space", async () => {
    addUserProjectRoot("alice", "/tmp/alice-project");
    expect(await isPathAllowed("/tmp/alice-project/src/index.ts", "alice")).toBe(true);
    expect(await isPathAllowed("/tmp/anything-here", "alice")).toBe(true);
  });

  it("token-user cannot access other users' roots or server paths", async () => {
    // /tmp is a shared scratch root by design (bash logs, temp files), so
    // place bob's project outside every static root to test real isolation.
    addUserProjectRoot("bob", "/srv/bob-project");
    expect(await isPathAllowed("/srv/bob-project/secret", "alice")).toBe(false);
    expect(await isPathAllowed(process.cwd() + "/src/gateway/path-guard.ts", "alice")).toBe(false);
    expect(await isPathAllowed(process.env.HOME + "/.pi/agent/auth.json", "alice")).toBe(false);
  });

  it("admin keeps the global whitelist behavior", async () => {
    expect(await isPathAllowed("/tmp/admin-scratch", undefined)).toBe(true);
    expect(await isPathAllowed(process.cwd() + "/src/gateway/path-guard.ts", undefined)).toBe(true);
    expect(await isPathAllowed("/definitely/not/allowed", undefined)).toBe(false);
  });

  it("read-only config roots stay readable for everyone", async () => {
    expect(
      await isPathReadable(process.env.HOME + "/.pi/agent/settings.json", "alice"),
    ).toBe(true);
  });
});
