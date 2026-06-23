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
