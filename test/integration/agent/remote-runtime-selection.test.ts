/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getRemoteProjectByPath: vi.fn(),
  config: {
    remoteChildEnabled: false,
    remoteSshTarget: "",
    remoteChildProjectPath: "",
    remoteSshPort: undefined as number | undefined,
    remoteSshKey: "",
    remoteChildShell: "zsh -lc",
    remotePiAgentDir: "",
  },
}));

vi.mock("../../../src/server-config", () => ({
  config: mocks.config,
}));

vi.mock("../../../src/shared/lib/project-config", () => ({
  getRemoteProjectByPath: mocks.getRemoteProjectByPath,
}));

import {
  getRemoteProjectSshRuntimeKind,
  resolveActiveRuntimeSelection,
  shouldCreateLocalRuntimeCwd,
  splitSshArgsForRemoteChild,
} from "../../../src/shared/agent/remote-runtime-selection";

describe("remote runtime selection", () => {
  beforeEach(() => {
    mocks.getRemoteProjectByPath.mockReset();
    mocks.config.remoteChildEnabled = false;
    mocks.config.remoteSshTarget = "";
    mocks.config.remoteChildProjectPath = "";
    mocks.config.remoteSshPort = undefined;
    mocks.config.remoteSshKey = "";
    mocks.config.remoteChildShell = "zsh -lc";
    mocks.config.remotePiAgentDir = "";
  });

  it("treats missing SSH submode as standard remote-agent-child", () => {
    expect(getRemoteProjectSshRuntimeKind({ sshRuntimeKind: undefined })).toBe(
      "remote-agent-child",
    );
    expect(getRemoteProjectSshRuntimeKind({ sshRuntimeKind: "ssh-command" })).toBe(
      "ssh-command",
    );
  });

  it("selects standard remote-child for SSH projects by default", async () => {
    mocks.getRemoteProjectByPath.mockResolvedValueOnce({
      id: "remote-id",
      name: "remote",
      runtime: "ssh",
      profileId: "profile-id",
      host: "xyz-mac",
      remotePath: "/tmp/project",
      localPath: "/shadow",
      createdAt: 1,
      lastOpened: 2,
    });

    await expect(resolveActiveRuntimeSelection("/shadow")).resolves.toMatchObject({
      kind: "remote-agent-child",
      source: "remote-project",
      target: "xyz-mac",
      remoteCwd: "/tmp/project",
    });
  });

  it("selects quick fallback only when the remote project asks for ssh-command", async () => {
    const remoteProject = {
      id: "remote-id",
      name: "remote",
      runtime: "ssh",
      sshRuntimeKind: "ssh-command",
      profileId: "profile-id",
      host: "xyz-mac",
      remotePath: "/tmp/project",
      localPath: "/shadow",
      createdAt: 1,
      lastOpened: 2,
    };
    mocks.getRemoteProjectByPath.mockResolvedValueOnce(remoteProject);

    await expect(resolveActiveRuntimeSelection("/shadow")).resolves.toMatchObject({
      kind: "ssh-command",
      remoteProject,
    });
  });

  it("recognizes remote project records when called with the remote path", async () => {
    const remoteProject = {
      id: "remote-id",
      name: "remote",
      runtime: "ssh",
      profileId: "profile-id",
      host: "xyz-mac",
      remotePath: "/Users/xyz/Projects/demo1",
      localPath: "/shadow/demo1",
      createdAt: 1,
      lastOpened: 2,
    };
    mocks.getRemoteProjectByPath.mockResolvedValueOnce(remoteProject);

    await expect(resolveActiveRuntimeSelection("/Users/xyz/Projects/demo1")).resolves.toMatchObject(
      {
        kind: "remote-agent-child",
        source: "remote-project",
        remoteCwd: "/Users/xyz/Projects/demo1",
      },
    );
    expect(mocks.getRemoteProjectByPath).toHaveBeenCalledWith("/Users/xyz/Projects/demo1");
  });

  it("does not create local cwd directories for standard remote-child runtimes", () => {
    expect(shouldCreateLocalRuntimeCwd({ kind: "local" })).toBe(true);
    expect(shouldCreateLocalRuntimeCwd({ kind: "ssh-command" })).toBe(true);
    expect(shouldCreateLocalRuntimeCwd({ kind: "remote-agent-child" })).toBe(false);
  });

  it("parses common SSH args for remote-child bootstrap and stdio", () => {
    expect(
      splitSshArgsForRemoteChild({
        target: "devbox",
        sshArgs: ["-p", "2202", "-i", "/tmp/key", "-l", "deploy", "-o", "ProxyJump=bastion"],
      }),
    ).toEqual({
      target: "deploy@devbox",
      port: 2202,
      keyPath: "/tmp/key",
      extraSshArgs: ["-o", "ProxyJump=bastion"],
    });
  });
});
