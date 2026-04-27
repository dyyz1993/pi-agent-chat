import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, basename } from "path";
import { homedir } from "os";
import type { RecentProject, ConfiguredPath } from "../modules/project";

const CONFIG_PATH = join(homedir(), ".pi-agent-chat", "config.json");

export interface PersistedTab {
  id: string;
  name: string;
  path: string;
}

interface ProjectConfig {
  recentProjects: RecentProject[];
  activeProject: string | null;
  configuredPaths: ConfiguredPath[];
  openTabs: PersistedTab[];
  activeTabId: string | null;
  pinnedSessionIds: string[];
}

async function load(): Promise<ProjectConfig> {
  try {
    if (!existsSync(CONFIG_PATH)) {
    return { recentProjects: [], activeProject: null, configuredPaths: [], openTabs: [], activeTabId: null, pinnedSessionIds: [] };
    }
    const raw = await readFile(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
    return {
      recentProjects: parsed.recentProjects ?? [],
      activeProject: parsed.activeProject ?? null,
      configuredPaths: parsed.configuredPaths ?? [],
      openTabs: parsed.openTabs ?? [],
      activeTabId: parsed.activeTabId ?? null,
      pinnedSessionIds: parsed.pinnedSessionIds ?? [],
    };
  } catch {
    return { recentProjects: [], activeProject: null, configuredPaths: [], openTabs: [], activeTabId: null, pinnedSessionIds: [] };
  }
}

async function save(config: ProjectConfig): Promise<void> {
  const dir = dirname(CONFIG_PATH);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

export async function listRecentProjects(): Promise<RecentProject[]> {
  const config = await load();
  return config.recentProjects;
}

export async function addRecentProject(
  projectPath: string,
  name: string,
  sessionCount: number,
): Promise<RecentProject> {
  const config = await load();
  const existing = config.recentProjects.find((p) => p.path === projectPath);

  if (existing) {
    existing.lastOpened = Date.now();
    existing.sessionCount = sessionCount;
  } else {
    config.recentProjects.unshift({
      path: projectPath,
      name,
      lastOpened: Date.now(),
      pinned: false,
      sessionCount,
    });
  }

  config.activeProject = projectPath;
  await save(config);
  return existing || config.recentProjects[0];
}

export async function removeRecentProject(projectPath: string): Promise<void> {
  const config = await load();
  config.recentProjects = config.recentProjects.filter((p) => p.path !== projectPath);
  if (config.activeProject === projectPath) {
    config.activeProject = config.recentProjects[0]?.path ?? null;
  }
  await save(config);
}

export async function getActiveProject(): Promise<string | null> {
  const config = await load();
  return config.activeProject;
}

export async function listConfiguredPaths(): Promise<ConfiguredPath[]> {
  const config = await load();
  if (config.configuredPaths.length === 0) {
    return [
      { path: homedir(), name: "主目录", type: "home" },
      { path: join(homedir(), "Documents"), name: "文档", type: "documents" },
    ];
  }
  return config.configuredPaths;
}

export async function addConfiguredPath(
  path: string,
  name?: string,
): Promise<void> {
  const config = await load();
  if (!config.configuredPaths.find((p) => p.path === path)) {
    config.configuredPaths.push({
      path,
      name: name || basename(path),
      type: "custom",
    });
    await save(config);
  }
}

export async function removeConfiguredPath(path: string): Promise<void> {
  const config = await load();
  config.configuredPaths = config.configuredPaths.filter((p) => p.path !== path);
  await save(config);
}

export async function syncOpenTabs(tabs: PersistedTab[], activeTabId: string | null): Promise<void> {
  const config = await load();
  config.openTabs = tabs;
  config.activeTabId = activeTabId;
  await save(config);
}

export async function restoreOpenTabs(): Promise<{ tabs: PersistedTab[]; activeTabId: string | null }> {
  const config = await load();
  return { tabs: config.openTabs, activeTabId: config.activeTabId };
}

export async function pinSession(sessionId: string): Promise<string[]> {
  const config = await load();
  if (!config.pinnedSessionIds.includes(sessionId)) {
    config.pinnedSessionIds.push(sessionId);
    await save(config);
  }
  return config.pinnedSessionIds;
}

export async function unpinSession(sessionId: string): Promise<string[]> {
  const config = await load();
  config.pinnedSessionIds = config.pinnedSessionIds.filter((id) => id !== sessionId);
  await save(config);
  return config.pinnedSessionIds;
}

export async function listPinnedSessionIds(): Promise<string[]> {
  const config = await load();
  return config.pinnedSessionIds;
}
