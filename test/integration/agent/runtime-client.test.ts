/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { buildRpcClientArgs } from "../../../src/shared/agent/agent-runtime-client";

describe("agent runtime client helpers", () => {
  it("keeps extension args and appends an existing session path", () => {
    expect(
      buildRpcClientArgs({
        extensionArgs: ["--no-extensions", "--extension", "/tmp/ext"],
        sessionPath: "/tmp/session.jsonl",
        sessionExists: true,
      }),
    ).toEqual(["--no-extensions", "--extension", "/tmp/ext", "--session", "/tmp/session.jsonl"]);
  });

  it("skips missing or empty session paths", () => {
    expect(
      buildRpcClientArgs({
        extensionArgs: ["--no-extensions"],
        sessionPath: "/tmp/missing.jsonl",
        sessionExists: false,
      }),
    ).toEqual(["--no-extensions"]);

    expect(
      buildRpcClientArgs({
        extensionArgs: ["--no-extensions"],
        sessionPath: undefined,
        sessionExists: true,
      }),
    ).toEqual(["--no-extensions"]);
  });
});
