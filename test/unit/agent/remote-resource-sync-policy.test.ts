/**
 * @vitest-environment node
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { getRemoteProjectTrustArgs } from "../../../src/shared/agent/remote-resource-sync-policy";
import { encodeProjectPath, normalizeProjectPath } from "../../../src/shared/lib/pi-agent-paths";

const originalPiAgentDir = process.env.PI_CODING_AGENT_DIR;
const tempRoots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-remote-policy-test-"));
  tempRoots.push(dir);
  process.env.PI_CODING_AGENT_DIR = dir;
  return dir;
}

afterEach(() => {
  process.env.PI_CODING_AGENT_DIR = originalPiAgentDir;
  for (const dir of tempRoots.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("remote resource sync policy", () => {
  it("passes project trust decisions to standard SSH runtime args", () => {
    const agentDir = tempDir();
    const trustPath = normalizeProjectPath("/__pi_remote__/ssh/xyz-mac/Users/xyz/project");
    const trustFile = join(agentDir, "projects", encodeProjectPath(trustPath), "trust.json");
    mkdirSync(dirname(trustFile), { recursive: true });
    writeFileSync(trustFile, JSON.stringify({ decision: true }, null, 2));

    const args = getRemoteProjectTrustArgs({
      cwd: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd",
      runtime: {
        kind: "remote-agent-child",
        source: "remote-project",
        remoteProject: {
          id: "remote-id",
          name: "project",
          runtime: "ssh",
          sshRuntimeKind: "remote-agent-child",
          profileId: "profile-id",
          host: "xyz-mac",
          remotePath: "/Users/xyz/project",
          localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd",
          createdAt: 1,
          lastOpened: 2,
        },
        target: "xyz-mac",
        remoteCwd: "/Users/xyz/project",
        shell: "bash -lc",
      },
    });

    expect(args).toEqual(["--approve"]);
  });

  it("passes explicit untrusted decisions to standard SSH runtime args", () => {
    const agentDir = tempDir();
    const trustPath = normalizeProjectPath("/__pi_remote__/ssh/xyz-mac/Users/xyz/project");
    const trustFile = join(agentDir, "projects", encodeProjectPath(trustPath), "trust.json");
    mkdirSync(dirname(trustFile), { recursive: true });
    writeFileSync(trustFile, JSON.stringify({ decision: false }, null, 2));

    const args = getRemoteProjectTrustArgs({
      cwd: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd",
      runtime: {
        kind: "remote-agent-child",
        source: "remote-project",
        remoteProject: {
          id: "remote-id",
          name: "project",
          runtime: "ssh",
          sshRuntimeKind: "remote-agent-child",
          profileId: "profile-id",
          host: "xyz-mac",
          remotePath: "/Users/xyz/project",
          localPath: "/Users/xuyingzhou/.pi-agent-chat/remote-projects/ssh-abcd",
          createdAt: 1,
          lastOpened: 2,
        },
        target: "xyz-mac",
        remoteCwd: "/Users/xyz/project",
        shell: "bash -lc",
      },
    });

    expect(args).toEqual(["--no-approve"]);
  });
});
