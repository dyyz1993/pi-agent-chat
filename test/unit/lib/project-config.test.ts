import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";

// 使用真实文件系统测试，写入临时目录
const TEST_CONFIG_DIR = join(homedir(), ".pi-agent-chat");
const TEST_CONFIG_PATH = join(TEST_CONFIG_DIR, "config.json");
const TEST_BACKUP_PATH = join(TEST_CONFIG_DIR, "config.json.bak");

// 保存原始 config 内容以便恢复
let originalConfig: string | null = null;
let originalBackup: string | null = null;

beforeEach(async () => {
  originalConfig = null;
  originalBackup = null;

  // 备份原始配置
  if (existsSync(TEST_CONFIG_PATH)) {
    originalConfig = await import("fs/promises").then((fs) =>
      fs.readFile(TEST_CONFIG_PATH, "utf-8"),
    );
  }
  if (existsSync(TEST_BACKUP_PATH)) {
    originalBackup = await import("fs/promises").then((fs) =>
      fs.readFile(TEST_BACKUP_PATH, "utf-8"),
    );
  }

  // 写入干净的测试配置
  await mkdir(TEST_CONFIG_DIR, { recursive: true });
  await writeFile(TEST_CONFIG_PATH, JSON.stringify({ disabledPlugins: {} }, null, 2), "utf-8");
});

afterEach(async () => {
  // 恢复原始配置
  if (originalConfig !== null) {
    await writeFile(TEST_CONFIG_PATH, originalConfig, "utf-8");
  } else if (existsSync(TEST_CONFIG_PATH)) {
    await rm(TEST_CONFIG_PATH);
  }
  if (originalBackup !== null) {
    await writeFile(TEST_BACKUP_PATH, originalBackup, "utf-8");
  } else if (existsSync(TEST_BACKUP_PATH)) {
    await rm(TEST_BACKUP_PATH);
  }
});

describe("listDisabledPlugins", () => {
  it("returns empty array for project with no disabled plugins", async () => {
    // 需要 dynamic import 以确保每次用最新的模块状态
    const { listDisabledPlugins } = await import("../../../src/shared/lib/project-config");
    const result = await listDisabledPlugins("/project/unknown");
    expect(result).toEqual([]);
  });

  it("returns disabled plugins for a specific project", async () => {
    await writeFile(
      TEST_CONFIG_PATH,
      JSON.stringify({
        disabledPlugins: {
          "/project/a": ["/plugins/test/index.ts"],
          "/project/b": ["/plugins/other/index.ts"],
        },
      }),
      "utf-8",
    );

    const { listDisabledPlugins } = await import("../../../src/shared/lib/project-config");
    const resultA = await listDisabledPlugins("/project/a");
    expect(resultA).toEqual(["/plugins/test/index.ts"]);

    const resultB = await listDisabledPlugins("/project/b");
    expect(resultB).toEqual(["/plugins/other/index.ts"]);

    const resultC = await listDisabledPlugins("/project/c");
    expect(resultC).toEqual([]);
  });
});

describe("listRecentProjects", () => {
  it("filters orphan SSH shadow projects without remote metadata", async () => {
    const orphanLocalPath = join(TEST_CONFIG_DIR, "remote-projects", "ssh-orphan");

    await writeFile(
      TEST_CONFIG_PATH,
      JSON.stringify(
        {
          recentProjects: [
            {
              path: orphanLocalPath,
              name: "ssh-orphan",
              lastOpened: 100,
              pinned: false,
              sessionCount: 0,
            },
            {
              path: "/Users/xuyingzhou/Project/local",
              name: "local",
              lastOpened: 90,
              pinned: false,
              sessionCount: 1,
            },
          ],
          remoteProjects: [],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const { listRecentProjects } = await import("../../../src/shared/lib/project-config");
    const projects = await listRecentProjects();

    expect(projects.map((project) => project.path)).toEqual(["/Users/xuyingzhou/Project/local"]);
  });

  it("hydrates legacy SSH recent projects from remote project records", async () => {
    const localPath = join(TEST_CONFIG_DIR, "remote-projects", "ssh-legacy");

    await writeFile(
      TEST_CONFIG_PATH,
      JSON.stringify(
        {
          recentProjects: [
            {
              path: localPath,
              name: "ssh-legacy",
              lastOpened: 100,
              pinned: false,
              sessionCount: 2,
            },
          ],
          remoteProjects: [
            {
              id: "remote-legacy",
              runtime: "ssh",
              profileId: "ssh-profile",
              host: "xyz-mac",
              remotePath: "/Users/xyz/pi-agent-remote-smoke",
              localPath,
              name: "pi-agent-remote-smoke",
              createdAt: 90,
              lastOpened: 100,
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const { listRecentProjects } = await import("../../../src/shared/lib/project-config");
    const [project] = await listRecentProjects();

    expect(project).toMatchObject({
      path: localPath,
      name: "pi-agent-remote-smoke",
      runtime: "ssh",
      remote: {
        runtime: "ssh",
        host: "xyz-mac",
        remotePath: "/Users/xyz/pi-agent-remote-smoke",
        localPath,
      },
    });
  });
});

describe("openRemoteProject runtime kind", () => {
  it("defaults new SSH projects to standard remote-agent-child", async () => {
    const { openRemoteProject } = await import("../../../src/shared/lib/project-config");

    const opened = await openRemoteProject({
      host: "xyz-mac",
      remotePath: "/tmp/pi-agent-standard",
      projectName: "pi-agent-standard",
    });

    expect(opened.remote.sshRuntimeKind).toBe("remote-agent-child");
    expect(opened.tab.remote?.sshRuntimeKind).toBe("remote-agent-child");
  });

  it("persists explicit quick sandbox SSH projects", async () => {
    const { getRemoteProjectByLocalPath, openRemoteProject } = await import(
      "../../../src/shared/lib/project-config"
    );

    const opened = await openRemoteProject({
      host: "xyz-mac",
      remotePath: "/tmp/pi-agent-quick",
      projectName: "pi-agent-quick",
      sshRuntimeKind: "ssh-command",
    });
    const stored = await getRemoteProjectByLocalPath(opened.remote.localPath);

    expect(opened.remote.sshRuntimeKind).toBe("ssh-command");
    expect(stored).toMatchObject({
      sshRuntimeKind: "ssh-command",
    });
  });

  it("persists per-project remote resource sync selection", async () => {
    const { getRemoteProjectByLocalPath, openRemoteProject } = await import(
      "../../../src/shared/lib/project-config"
    );

    const opened = await openRemoteProject({
      host: "xyz-mac",
      remotePath: "/tmp/pi-agent-resource-sync",
      projectName: "pi-agent-resource-sync",
      sshRuntimeKind: "remote-agent-child",
      remoteResourceSync: {
        enabled: true,
        resourceTypes: ["skills", "rules"],
      },
    });
    const stored = await getRemoteProjectByLocalPath(opened.remote.localPath);

    expect(opened.remote.remoteResourceSync).toEqual({
      enabled: true,
      resourceTypes: ["skills", "rules"],
    });
    expect(opened.tab.remote?.remoteResourceSync).toEqual({
      enabled: true,
      resourceTypes: ["skills", "rules"],
    });
    expect(stored?.remoteResourceSync).toEqual({
      enabled: true,
      resourceTypes: ["skills", "rules"],
    });
  });
});

describe("getRemoteProjectByPath", () => {
  it("finds SSH remote projects by local shadow path, remote path, and remote child path", async () => {
    const localPath = join(TEST_CONFIG_DIR, "remote-projects", "ssh-path-lookup");
    const remotePath = "/Users/xyz/Projects/demo1";

    await writeFile(
      TEST_CONFIG_PATH,
      JSON.stringify(
        {
          remoteProjects: [
            {
              id: "remote-path-lookup",
              runtime: "ssh",
              sshRuntimeKind: "remote-agent-child",
              profileId: "ssh-profile",
              host: "xyz-mac",
              remotePath,
              localPath,
              name: "demo1",
              createdAt: 90,
              lastOpened: 100,
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const { getRemoteProjectByPath } = await import("../../../src/shared/lib/project-config");

    await expect(getRemoteProjectByPath(localPath)).resolves.toMatchObject({
      id: "remote-path-lookup",
    });
    await expect(getRemoteProjectByPath(remotePath)).resolves.toMatchObject({
      id: "remote-path-lookup",
    });
    await expect(getRemoteProjectByPath(`${remotePath}/pi-agent-app`)).resolves.toMatchObject({
      id: "remote-path-lookup",
    });
  });
});

describe("restoreOpenTabs", () => {
  it("hydrates legacy SSH tabs from remote project records", async () => {
    const localPath = join(TEST_CONFIG_DIR, "remote-projects", "ssh-legacy-tab");

    await writeFile(
      TEST_CONFIG_PATH,
      JSON.stringify(
        {
          openTabs: [
            {
              id: `proj-${localPath.replace(/\//g, "-")}`,
              name: "ssh-legacy-tab",
              path: localPath,
            },
          ],
          activeTabId: `proj-${localPath.replace(/\//g, "-")}`,
          remoteProjects: [
            {
              id: "remote-legacy-tab",
              runtime: "ssh",
              sshRuntimeKind: "remote-agent-child",
              profileId: "ssh-profile",
              host: "xyz-mac",
              remotePath: "/Users/xyz/Projects/44444",
              localPath,
              name: "44444",
              createdAt: 90,
              lastOpened: 100,
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const { restoreOpenTabs } = await import("../../../src/shared/lib/project-config");
    const restored = await restoreOpenTabs();

    expect(restored).toMatchObject({
      activeTabId: "remote-remote-legacy-tab",
      tabs: [
        {
          id: "remote-remote-legacy-tab",
          name: "44444",
          path: localPath,
          runtime: "ssh",
          remote: {
            runtime: "ssh",
            sshRuntimeKind: "remote-agent-child",
            host: "xyz-mac",
            remotePath: "/Users/xyz/Projects/44444",
            localPath,
          },
        },
      ],
    });
  });

  it("filters orphan SSH shadow tabs without remote metadata", async () => {
    const orphanLocalPath = join(TEST_CONFIG_DIR, "remote-projects", "ssh-orphan-tab");

    await writeFile(
      TEST_CONFIG_PATH,
      JSON.stringify(
        {
          openTabs: [
            {
              id: "orphan",
              name: "orphan",
              path: orphanLocalPath,
            },
            {
              id: "local",
              name: "local",
              path: "/Users/xuyingzhou/Project/local",
            },
          ],
          activeTabId: "orphan",
          remoteProjects: [],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const { restoreOpenTabs } = await import("../../../src/shared/lib/project-config");
    const restored = await restoreOpenTabs();

    expect(restored).toEqual({
      activeTabId: "local",
      tabs: [
        {
          id: "local",
          name: "local",
          path: "/Users/xuyingzhou/Project/local",
        },
      ],
    });
  });
});

describe("syncOpenTabs", () => {
  it("hydrates SSH shadow tabs before persisting them", async () => {
    const localPath = join(TEST_CONFIG_DIR, "remote-projects", "ssh-sync-tab");
    const legacyTabId = `proj-${localPath.replace(/\//g, "-")}`;

    await writeFile(
      TEST_CONFIG_PATH,
      JSON.stringify(
        {
          remoteProjects: [
            {
              id: "remote-sync-tab",
              runtime: "ssh",
              sshRuntimeKind: "remote-agent-child",
              profileId: "ssh-profile",
              host: "xyz-mac",
              remotePath: "/Users/xyz/Projects/44444",
              localPath,
              name: "44444",
              createdAt: 90,
              lastOpened: 100,
            },
          ],
        },
        null,
        2,
      ),
      "utf-8",
    );

    const { restoreOpenTabs, syncOpenTabs } = await import(
      "../../../src/shared/lib/project-config"
    );
    await syncOpenTabs([{ id: legacyTabId, name: "44444", path: localPath }], legacyTabId);

    const restored = await restoreOpenTabs();
    expect(restored).toMatchObject({
      activeTabId: "remote-remote-sync-tab",
      tabs: [
        {
          id: "remote-remote-sync-tab",
          runtime: "ssh",
          remote: {
            remotePath: "/Users/xyz/Projects/44444",
            sshRuntimeKind: "remote-agent-child",
          },
        },
      ],
    });
  });
});

describe("setDisabledPlugin", () => {
  it("adds a plugin to disabled list", async () => {
    const { setDisabledPlugin } = await import("../../../src/shared/lib/project-config");
    const result = await setDisabledPlugin("/project/a", "/plugins/test/index.ts", true);
    expect(result).toEqual(["/plugins/test/index.ts"]);
  });

  it("removes a plugin from disabled list", async () => {
    await writeFile(
      TEST_CONFIG_PATH,
      JSON.stringify({
        disabledPlugins: {
          "/project/a": ["/plugins/test/index.ts", "/plugins/other/index.ts"],
        },
      }),
      "utf-8",
    );

    const { setDisabledPlugin } = await import("../../../src/shared/lib/project-config");
    const result = await setDisabledPlugin("/project/a", "/plugins/test/index.ts", false);
    expect(result).toEqual(["/plugins/other/index.ts"]);
  });

  it("does not duplicate entries when disabling same plugin twice", async () => {
    const { setDisabledPlugin } = await import("../../../src/shared/lib/project-config");
    await setDisabledPlugin("/project/a", "/plugins/test/index.ts", true);
    const result = await setDisabledPlugin("/project/a", "/plugins/test/index.ts", true);
    expect(result).toEqual(["/plugins/test/index.ts"]);
  });

  it("persists across calls", async () => {
    const { setDisabledPlugin, listDisabledPlugins } =
      await import("../../../src/shared/lib/project-config");

    await setDisabledPlugin("/project/a", "/plugins/x/index.ts", true);
    await setDisabledPlugin("/project/a", "/plugins/y/index.ts", true);

    const result = await listDisabledPlugins("/project/a");
    expect(result).toEqual(["/plugins/x/index.ts", "/plugins/y/index.ts"]);
  });

  it("handles different projects independently", async () => {
    const { setDisabledPlugin, listDisabledPlugins } =
      await import("../../../src/shared/lib/project-config");

    await setDisabledPlugin("/project/a", "/plugins/shared/index.ts", true);
    await setDisabledPlugin("/project/b", "/plugins/shared/index.ts", false);

    const resultA = await listDisabledPlugins("/project/a");
    const resultB = await listDisabledPlugins("/project/b");

    expect(resultA).toEqual(["/plugins/shared/index.ts"]);
    expect(resultB).toEqual([]);
  });
});
