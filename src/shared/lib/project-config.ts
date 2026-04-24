import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname } from "path";
import { homedir } from "os";
import type { RecentProject } from "../modules/project";

const CONFIG_PATH = join(homedir(), ".pi-agent-chat", "config.json");

interface ProjectConfig {
  recentProjects: RecentProject[];
  activeProject: string | null;
}

async function load(): Promise<ProjectConfig> {
  try {
    if (!existsSync(CONFIG_PATH)) {
      return { recentProjects: [], activeProject: null };
    }
    const raw = await readFile(CONFIG_PATH, "utf-8");
    return JSON.parse(raw) as ProjectConfig;
  } catch {
    return { recentProjects: [], activeProject: null };
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
