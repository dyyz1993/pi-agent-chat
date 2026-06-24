import { describe, expect, it } from "vitest";
import { getProjectWorkspacePath } from "../../../src/mainview/lib/project-workspace-path";
import type { ProjectTab } from "../../../src/mainview/types";

describe("getProjectWorkspacePath", () => {
  it("returns the local path for local tabs", () => {
    expect(getProjectWorkspacePath({ id: "local", name: "app", path: "/Users/me/app" })).toBe(
      "/Users/me/app",
    );
  });

  it("returns the remote path for SSH tabs", () => {
    const tab: ProjectTab = {
      id: "remote-demo",
      name: "demo1",
      path: "/Users/me/.pi-agent-chat/remote-projects/ssh-demo",
      runtime: "ssh",
      remote: {
        runtime: "ssh",
        sshRuntimeKind: "remote-agent-child",
        profileId: "profile-1",
        host: "xyz-mac",
        remotePath: "/Users/xyz/Projects/demo1",
        localPath: "/Users/me/.pi-agent-chat/remote-projects/ssh-demo",
      },
    };

    expect(getProjectWorkspacePath(tab)).toBe("/Users/xyz/Projects/demo1");
  });
});
