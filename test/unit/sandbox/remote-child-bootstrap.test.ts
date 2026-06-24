/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";
import { join } from "node:path";

import { getRemoteChildBinaryCandidates } from "../../../src/sandbox/remote-child-bootstrap";

describe("remote child bootstrap helpers", () => {
  it("prefers a remote OS/arch-specific binary beside the CLI", () => {
    expect(
      getRemoteChildBinaryCandidates({
        cliPath: "/repo/packages/coding-agent/dist/cli.js",
        remotePlatform: "Darwin",
        remoteArch: "x86_64",
      }),
    ).toEqual([
      join("/repo/packages/coding-agent/dist", "pi-darwin-x64"),
      join("/repo/packages/coding-agent/dist", "pi-darwin-x86_64"),
    ]);
  });

  it("normalizes Linux aarch64 to arm64 candidates", () => {
    expect(
      getRemoteChildBinaryCandidates({
        cliPath: "/repo/packages/coding-agent/dist/cli.js",
        remotePlatform: "Linux",
        remoteArch: "aarch64",
      }),
    ).toContain(join("/repo/packages/coding-agent/dist", "pi-linux-arm64"));
  });

  it("does not fall back to a generic local binary when the remote platform is known", () => {
    expect(
      getRemoteChildBinaryCandidates({
        cliPath: "/repo/packages/coding-agent/dist/cli.js",
        remotePlatform: "Linux",
        remoteArch: "x86_64",
      }),
    ).toEqual([
      join("/repo/packages/coding-agent/dist", "pi-linux-x64"),
      join("/repo/packages/coding-agent/dist", "pi-linux-x86_64"),
    ]);
  });

  it("uses the generic local binary only when remote system detection is unavailable", () => {
    expect(
      getRemoteChildBinaryCandidates({
        cliPath: "/repo/packages/coding-agent/dist/cli.js",
      }),
    ).toEqual([join("/repo/packages/coding-agent/dist", "pi")]);
  });
});
