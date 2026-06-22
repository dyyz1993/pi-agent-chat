import { describe, expect, it } from "vitest";
import { resolve } from "path";
import { isPathAllowed, isPathReadable } from "../../../src/gateway/path-guard";

const HOME = process.env.HOME ?? "";

describe("gateway path guard", () => {
  it("allows read-only access to hook and settings files used by the Hooks panel", async () => {
    await expect(isPathReadable(resolve(HOME, ".claude", "settings.json"))).resolves.toBe(true);
    await expect(isPathReadable(resolve(HOME, ".claude", "hooks", "pre-tool-use.sh"))).resolves.toBe(true);
    await expect(isPathReadable(resolve(HOME, ".pi", "agent", "settings.json"))).resolves.toBe(true);
  });

  it("does not allow write/delete access to read-only hook and settings paths", async () => {
    await expect(isPathAllowed(resolve(HOME, ".claude", "settings.json"))).resolves.toBe(false);
    await expect(isPathAllowed(resolve(HOME, ".claude", "hooks", "pre-tool-use.sh"))).resolves.toBe(false);
    await expect(isPathAllowed(resolve(HOME, ".pi", "agent", "settings.json"))).resolves.toBe(false);
  });
});
