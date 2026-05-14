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
  disabledSkills: string[];
  /** app-level model favorites (global) */
  modelFavorites: string[];
}

async function load(): Promise<ProjectConfig> {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return {
        recentProjects: [],
        activeProject: null,
        configuredPaths: [],
        openTabs: [],
        activeTabId: null,
        pinnedSessionIds: [],
        favoriteFolders: [],
        disabledSkills: [],
        modelFavorites: [],
      };
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
      disabledSkills: parsed.disabledSkills ?? [],
      modelFavorites: parsed.modelFavorites ?? [],
    };
  } catch {
    return {
      recentProjects: [],
      activeProject: null,
      configuredPaths: [],
      openTabs: [],
      activeTabId: null,
      pinnedSessionIds: [],
      favoriteFolders: [],
      disabledSkills: [],
      modelFavorites: [],
    };
  }
}

// Serial queue for load→modify→save operations to prevent concurrent write races
let saveQueue: Promise<void> = Promise.resolve();

async function loadAndSave<T>(patcher: (config: ProjectConfig) => T): Promise<T> {
  await saveQueue.catch(() => {});
  let result!: T;
  saveQueue = (async () => {
    const config = await load();
    result = patcher(config);
    const dir = dirname(CONFIG_PATH);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
  })();
  await saveQueue;
  return result;
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
  return loadAndSave((config) => {
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
    return existing ?? config.recentProjects[0];
  });
}

export async function removeRecentProject(projectPath: string): Promise<void> {
  return loadAndSave((config) => {
    config.recentProjects = config.recentProjects.filter((p) => p.path !== projectPath);
    if (config.activeProject === projectPath) {
      config.activeProject = config.recentProjects[0]?.path ?? null;
    }
  });
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

export async function addConfiguredPath(path: string, name?: string): Promise<void> {
  return loadAndSave((config) => {
    if (!config.configuredPaths.find((p) => p.path === path)) {
      config.configuredPaths.push({
        path,
        name: name ?? basename(path),
        type: "custom",
      });
    }
  });
}

export async function removeConfiguredPath(path: string): Promise<void> {
  return loadAndSave((config) => {
    config.configuredPaths = config.configuredPaths.filter((p) => p.path !== path);
  });
}

export async function syncOpenTabs(
  tabs: PersistedTab[],
  activeTabId: string | null,
): Promise<void> {
  return loadAndSave((config) => {
    config.openTabs = tabs;
    config.activeTabId = activeTabId;
  });
}

export async function restoreOpenTabs(): Promise<{
  tabs: PersistedTab[];
  activeTabId: string | null;
}> {
  const config = await load();
  return { tabs: config.openTabs, activeTabId: config.activeTabId };
}

export async function pinSession(sessionId: string): Promise<string[]> {
  return loadAndSave((config) => {
    if (!config.pinnedSessionIds.includes(sessionId)) {
      config.pinnedSessionIds.push(sessionId);
    }
    return config.pinnedSessionIds;
  });
}

export async function unpinSession(sessionId: string): Promise<string[]> {
  return loadAndSave((config) => {
    config.pinnedSessionIds = config.pinnedSessionIds.filter((id) => id !== sessionId);
    return config.pinnedSessionIds;
  });
}

export async function listPinnedSessionIds(): Promise<string[]> {
  const config = await load();
  return config.pinnedSessionIds;
}

export async function listFavoriteFolders(): Promise<FavoriteFolder[]> {
  const config = await load();
  return config.favoriteFolders;
}

export async function toggleFavoriteFolder(
  folderPath: string,
): Promise<{ added: boolean; favorites: FavoriteFolder[] }> {
  return loadAndSave((config) => {
    const idx = config.favoriteFolders.findIndex((f) => f.path === folderPath);
    if (idx >= 0) {
      config.favoriteFolders.splice(idx, 1);
      return { added: false, favorites: config.favoriteFolders };
    }
    const fav: FavoriteFolder = {
      path: folderPath,
      name: basename(folderPath),
      addedAt: Date.now(),
    };
    config.favoriteFolders.push(fav);
    return { added: true, favorites: config.favoriteFolders };
  });
}

export async function removeFavoriteFolder(folderPath: string): Promise<void> {
  return loadAndSave((config) => {
    config.favoriteFolders = config.favoriteFolders.filter((f) => f.path !== folderPath);
  });
}

export async function isFavoriteFolder(folderPath: string): Promise<boolean> {
  const config = await load();
  return config.favoriteFolders.some((f) => f.path === folderPath);
}

export async function createDirectory(
  parentPath: string,
  folderName: string,
): Promise<{ ok: boolean; path: string; error?: string }> {
  const safeName = folderName.trim().replace(/[/\\]/g, "");
  if (!safeName) {
    return { ok: false, path: "", error: "Invalid folder name" };
  }
  const fullPath = join(parentPath, safeName);
  if (existsSync(fullPath)) {
    return { ok: false, path: fullPath, error: "Folder already exists" };
  }
  try {
    await mkdir(fullPath, { recursive: true });
    return { ok: true, path: fullPath };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { ok: false, path: "", error: msg };
  }
}

export async function toggleProjectPin(projectPath: string): Promise<boolean> {
  return loadAndSave((config) => {
    const project = config.recentProjects.find((p) => p.path === projectPath);
    if (project) {
      project.pinned = !project.pinned;
      return project.pinned;
    }
    return false;
  });
}

export async function listDirectory(
  dirPath: string,
  searchQuery?: string,
): Promise<DirectoryEntry[]> {
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

export async function listDisabledSkills(): Promise<string[]> {
  const config = await load();
  return config.disabledSkills;
}

export async function setDisabledSkill(skillName: string, disabled: boolean): Promise<string[]> {
  return loadAndSave((config) => {
    if (disabled) {
      if (!config.disabledSkills.includes(skillName)) {
        config.disabledSkills.push(skillName);
      }
    } else {
      config.disabledSkills = config.disabledSkills.filter((n) => n !== skillName);
    }
    return config.disabledSkills;
  });
}

export async function getModelFavorites(): Promise<string[]> {
  const config = await load();
  return config.modelFavorites;
}

export async function toggleModelFavorite(
  modelKey: string,
): Promise<{ added: boolean; favorites: string[] }> {
  return loadAndSave((config) => {
    const list = config.modelFavorites;
    const idx = list.indexOf(modelKey);
    if (idx >= 0) {
      list.splice(idx, 1);
      return { added: false, favorites: list };
    }
    list.push(modelKey);
    return { added: true, favorites: list };
  });
}
