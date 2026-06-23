import { describe, expect, it } from "vitest";
import { formatProjectStartError } from "../../../src/mainview/stores/session-start-error";
import type { ProjectTab } from "../../../src/mainview/types";

describe("formatProjectStartError", () => {
  it("keeps local project failures unchanged", () => {
    expect(formatProjectStartError(new Error("agent.start timed out"))).toBe(
      "agent.start timed out",
    );
  });

  it("adds ssh host and remote path context for remote project failures", () => {
    const tab: ProjectTab = {
      id: "tab-1",
      name: "remote-app",
      path: "/local/shadow/remote-app",
      runtime: "ssh",
      remote: {
        runtime: "ssh",
        profileId: "profile-1",
        host: "xyz-mac",
        remotePath: "/Users/xyz/project",
        localPath: "/local/shadow/remote-app",
      },
    };

    expect(formatProjectStartError(new Error("ssh unreachable"), tab)).toBe(
      [
        "SSH remote project failed to start.",
        "Host: xyz-mac",
        "Remote path: /Users/xyz/project",
        "Reason: ssh unreachable",
      ].join("\n"),
    );
  });
});
