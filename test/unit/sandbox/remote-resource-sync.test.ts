/**
 * @vitest-environment node
 */
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  buildRemoteResourceSyncInstallCommand,
  collectRemoteSyncSources,
  resolveRemoteSyncedAgentDir,
  stageRemoteResourceSync,
} from "../../../src/sandbox/remote-resource-sync";

const tempRoots: string[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-remote-resource-sync-test-"));
  tempRoots.push(dir);
  return dir;
}

describe("remote resource sync", () => {
  afterEach(() => {
    for (const dir of tempRoots.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("resolves the managed remote agent dir below the remote child runtime dir", () => {
    expect(
      resolveRemoteSyncedAgentDir({
        remoteChildRemoteRuntimeDir: "~/.pi/agent/remote-runtime/child",
      }),
    ).toBe("~/.pi/agent/remote-runtime/child/agent-resources");

    expect(
      resolveRemoteSyncedAgentDir({
        remoteResourceAgentDir: "/remote/custom-agent",
        remoteChildRemoteRuntimeDir: "~/.pi/agent/remote-runtime/child",
      }),
    ).toBe("/remote/custom-agent");
  });

  it("collects only configured low-risk resource directories", () => {
    const root = tempDir();
    mkdirSync(join(root, "skills", "example"), { recursive: true });
    mkdirSync(join(root, "agents"), { recursive: true });
    mkdirSync(join(root, "memory"), { recursive: true });
    writeFileSync(join(root, "models.json"), "{}");

    expect(collectRemoteSyncSources({ localAgentDir: root, userAgentsSkillsDir: false })).toEqual([
      { type: "skills", localPath: join(root, "skills") },
      { type: "agents", localPath: join(root, "agents") },
    ]);
  });

  it("includes ~/.agents skills as a compatibility source when syncing skills", () => {
    const root = tempDir();
    const agentsSkillsDir = tempDir();
    mkdirSync(join(root, "skills", "pi-skill"), { recursive: true });
    mkdirSync(join(agentsSkillsDir, "agents-skill"), { recursive: true });
    writeFileSync(join(root, "skills", "pi-skill", "SKILL.md"), "# Pi");
    writeFileSync(join(agentsSkillsDir, "agents-skill", "SKILL.md"), "# Agents");

    const staged = stageRemoteResourceSync({
      localAgentDir: root,
      resourceTypes: ["skills"],
      userAgentsSkillsDir: agentsSkillsDir,
      now: new Date("2026-06-24T00:00:00.000Z"),
    });
    tempRoots.push(staged.stagingDir);

    expect(readFileSync(join(staged.stagingDir, "skills", "pi-skill", "SKILL.md"), "utf8")).toBe(
      "# Pi",
    );
    expect(
      readFileSync(join(staged.stagingDir, "skills", "agents-skill", "SKILL.md"), "utf8"),
    ).toBe("# Agents");
    expect(staged.manifest.resources).toEqual([
      expect.objectContaining({ type: "skills", files: 2 }),
    ]);
  });

  it("stages resources with a manifest and blocks secrets and symlinks", () => {
    const root = tempDir();
    mkdirSync(join(root, "skills", "safe-skill"), { recursive: true });
    writeFileSync(join(root, "skills", "safe-skill", "SKILL.md"), "# Safe");
    writeFileSync(join(root, "skills", "safe-skill", ".env"), "TOKEN=secret");
    symlinkSync("/tmp/elsewhere", join(root, "skills", "safe-skill", "linked"));
    mkdirSync(join(root, "rules"), { recursive: true });
    writeFileSync(join(root, "rules", "project.md"), "Always test");

    const staged = stageRemoteResourceSync({
      localAgentDir: root,
      userAgentsSkillsDir: false,
      now: new Date("2026-06-24T00:00:00.000Z"),
    });
    tempRoots.push(staged.stagingDir);

    expect(staged.hasResources).toBe(true);
    expect(staged.manifest.schemaVersion).toBe("remote-resource-sync/v1");
    expect(staged.manifest.resources.map((resource) => resource.type)).toEqual([
      "skills",
      "rules",
    ]);
    expect(readFileSync(join(staged.stagingDir, "skills", "safe-skill", "SKILL.md"), "utf8")).toBe(
      "# Safe",
    );
    expect(staged.manifest.blocked).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: join(root, "skills", "safe-skill", ".env") }),
        expect.objectContaining({ path: join(root, "skills", "safe-skill", "linked") }),
      ]),
    );
    expect(
      JSON.parse(
        readFileSync(join(staged.stagingDir, ".remote-resource-sync", "manifest.json"), "utf8"),
      ),
    ).toMatchObject({ hash: staged.manifest.hash, managedBy: "pi-agent-chat" });
  });

  it("merges project-scoped skill sources into the synced skills directory", () => {
    const root = tempDir();
    const projectRoot = tempDir();
    mkdirSync(join(root, "skills", "global-skill"), { recursive: true });
    mkdirSync(join(projectRoot, "project-skill"), { recursive: true });
    writeFileSync(join(root, "skills", "global-skill", "SKILL.md"), "# Global");
    writeFileSync(join(projectRoot, "project-skill", "SKILL.md"), "# Project");

    const staged = stageRemoteResourceSync({
      localAgentDir: root,
      resourceTypes: ["skills"],
      extraSources: [{ type: "skills", localPath: projectRoot }],
      userAgentsSkillsDir: false,
      now: new Date("2026-06-24T00:00:00.000Z"),
    });
    tempRoots.push(staged.stagingDir);

    expect(
      readFileSync(join(staged.stagingDir, "skills", "global-skill", "SKILL.md"), "utf8"),
    ).toBe("# Global");
    expect(
      readFileSync(join(staged.stagingDir, "skills", "project-skill", "SKILL.md"), "utf8"),
    ).toBe("# Project");
    expect(staged.manifest.resources).toEqual([
      expect.objectContaining({ type: "skills", files: 2 }),
    ]);
  });

  it("builds an install command scoped to the managed agent root", () => {
    const command = buildRemoteResourceSyncInstallCommand({
      remoteAgentDir: "~/.pi/agent/remote-runtime/child/agent-resources",
      remoteTarball: "~/.pi/agent/remote-runtime/child/agent-resources/.remote-resource-sync/resources.tgz",
      hash: "abcdef0123456789",
    });

    expect(command).toContain(
      'rm -rf "${HOME}/.pi/agent/remote-runtime/child/agent-resources/skills"',
    );
    expect(command).toContain(
      'mv "${HOME}/.pi/agent/remote-runtime/child/agent-resources/.remote-resource-sync/staging-abcdef012345/skills" "${HOME}/.pi/agent/remote-runtime/child/agent-resources/skills"',
    );
    expect(command).not.toContain("auth.json");
    expect(command).not.toContain("models.json");
    expect(command).not.toContain("/memory");
  });
});
