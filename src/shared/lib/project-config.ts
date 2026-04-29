import { readFile, writeFile, mkdir, readdir } from "fs/promises";
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

export interface FavoriteFolder {
  path: string;
  name: string;
  addedAt: number;
}

export interface DirectoryEntry {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface ProjectConfig {
  recentProjects: RecentProject[];
  activeProject: string | null;
  configuredPaths: ConfiguredPath[];
  openTabs: PersistedTab[];
  activeTabId: string | null;
  pinnedSessionIds: string[];
  favoriteFolders: FavoriteFolder[];
}

async function load(): Promise<ProjectConfig> {
  try {
    if (!existsSync(CONFIG_PATH)) {
    return { recentProjects: [], activeProject: null, configuredPaths: [], openTabs: [], activeTabId: null, pinnedSessionIds: [], favoriteFolders: [] };
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
      favoriteFolders: parsed.favoriteFolders ?? [],
    };
  } catch {
    return { recentProjects: [], activeProject: null, configuredPaths: [], openTabs: [], activeTabId: null, pinnedSessionIds: [], favoriteFolders: [] };
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

export async function listFavoriteFolders(): Promise<FavoriteFolder[]> {
  const config = await load();
  return config.favoriteFolders;
}

export async function addFavoriteFolder(folderPath: string): Promise<FavoriteFolder> {
  const config = await load();
  const existing = config.favoriteFolders.find((f) => f.path === folderPath);
  if (existing) return existing;
  const fav: FavoriteFolder = { path: folderPath, name: basename(folderPath), addedAt: Date.now() };
  config.favoriteFolders.push(fav);
  await save(config);
  return fav;
}

export async function toggleFavoriteFolder(folderPath: string): Promise<{ added: boolean; favorites: FavoriteFolder[] }> {
  const config = await load();
  const idx = config.favoriteFolders.findIndex((f) => f.path === folderPath);
  if (idx >= 0) {
    config.favoriteFolders.splice(idx, 1);
    await save(config);
    return { added: false, favorites: config.favoriteFolders };
  }
  const fav: FavoriteFolder = { path: folderPath, name: basename(folderPath), addedAt: Date.now() };
  config.favoriteFolders.push(fav);
  await save(config);
  return { added: true, favorites: config.favoriteFolders };
}

export async function removeFavoriteFolder(folderPath: string): Promise<void> {
  const config = await load();
  config.favoriteFolders = config.favoriteFolders.filter((f) => f.path !== folderPath);
  await save(config);
}

export async function isFavoriteFolder(folderPath: string): Promise<boolean> {
  const config = await load();
  return config.favoriteFolders.some((f) => f.path === folderPath);
}

export async function toggleProjectPin(projectPath: string): Promise<boolean> {
  const config = await load();
  const project = config.recentProjects.find((p) => p.path === projectPath);
  if (project) {
    project.pinned = !project.pinned;
    await save(config);
    return project.pinned;
  }
  return false;
}

export async function listDirectory(dirPath: string, searchQuery?: string): Promise<DirectoryEntry[]> {
  if (!existsSync(dirPath)) return [];
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    let results: DirectoryEntry[] = [];
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      if (!entry.isDirectory()) continue;
      const fullPath = join(dirPath, entry.name);
      results.push({ name: entry.name, path: fullPath, isDirectory: true });
    }
    results.sort((a, b) => a.name.localeCompare(b.name));
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      results = results.filter((e) => e.name.toLowerCase().includes(q));
    }
    return results;
  } catch {
    return [];
  }
}
