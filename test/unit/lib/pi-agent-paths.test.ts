import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, resolve } from "path";
import { tmpdir } from "os";
import {
  encodeProjectPath,
  expandTildePath,
  getLegacyMemoryProjectDir,
  getPiAgentDir,
  getProjectPathPermissionsPath,
  getProjectSessionDir,
  getProjectTrustStorePath,
  getProjectUserStateDir,
  getSessionBucketKey,
  getSessionsRoot,
  getUserMemoryDir,
  isPathInsideUserMemoryDir,
} from "../../../src/shared/lib/pi-agent-paths";

describe("pi-agent-paths", () => {
  let originalAgentDir: string | undefined;
  let agentDir: string;

  beforeEach(() => {
    originalAgentDir = process.env.PI_CODING_AGENT_DIR;
    agentDir = join(tmpdir(), `pi-agent-paths-${Date.now()}`);
    process.env.PI_CODING_AGENT_DIR = agentDir;
  });

  afterEach(() => {
    if (originalAgentDir === undefined) {
      delete process.env.PI_CODING_AGENT_DIR;
    } else {
      process.env.PI_CODING_AGENT_DIR = originalAgentDir;
    }
  });

  it("honors PI_CODING_AGENT_DIR for app-private roots", () => {
    expect(getPiAgentDir()).toBe(resolve(agentDir));
    expect(getSessionsRoot()).toBe(join(resolve(agentDir), "sessions"));
    expect(getUserMemoryDir()).toBe(join(resolve(agentDir), "memory"));
  });

  it("keeps the existing session bucket key format", () => {
    expect(getSessionBucketKey("/Users/foo/project")).toBe("--Users-foo-project--");
    expect(getSessionBucketKey("C:\\Users\\foo\\project")).toBe("--C--Users-foo-project--");
    expect(getSessionBucketKey("C:/Users/foo")).toBe("--C--Users-foo--");
  });

  it("creates deterministic short project keys with basename suffix", () => {
    expect(encodeProjectPath("/Users/xuyingzhou/Project/study-web/猴子")).toBe("e8ee7279--__");
    expect(encodeProjectPath("/Users/foo/project")).toBe("3c99895f--project");
  });

  it("places project-private trust and permissions under projects/<PROJECT_KEY>", () => {
    const projectPath = "/Users/foo/project";
    const projectDir = getProjectUserStateDir(projectPath);

    expect(projectDir).toBe(join(resolve(agentDir), "projects", "3c99895f--project"));
    expect(getProjectTrustStorePath(projectPath)).toBe(join(projectDir, "trust.json"));
    expect(getProjectPathPermissionsPath(projectPath)).toBe(
      join(projectDir, "path-permissions.json"),
    );
  });

  it("keeps legacy session and memory buckets under agent roots", () => {
    const projectPath = "/Users/foo/project";

    expect(getProjectSessionDir(projectPath)).toBe(
      join(resolve(agentDir), "sessions", "--Users-foo-project--"),
    );
    expect(getLegacyMemoryProjectDir(projectPath)).toBe(
      join(resolve(agentDir), "memory", "--Users-foo-project--"),
    );
  });

  it("expands tilde paths and validates memory containment", () => {
    process.env.PI_CODING_AGENT_DIR = expandTildePath("~/custom-pi-agent");
    const memoryDir = getUserMemoryDir();

    expect(memoryDir).toContain("custom-pi-agent");
    expect(isPathInsideUserMemoryDir(join(memoryDir, "project", "note.md"))).toBe(true);
    expect(isPathInsideUserMemoryDir(join(memoryDir, "..", "outside.md"))).toBe(false);
  });
});
