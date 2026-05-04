import { readFile, writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { createLogger } from "./logger";

const log = createLogger("linked-projects");

export interface KeyPath {
  path: string;
  description: string;
}

export interface LinkedProject {
  id: string;
  path: string;
  description: string;
  relationship: "upstream" | "downstream" | "sibling";
  keyPaths: KeyPath[];
  readonly: boolean;
}

export interface LinkedProjectsConfig {
  projects: LinkedProject[];
}

interface LinkResult {
  ok: boolean;
  error?: string;
}

const CONFIG_FILENAME = "linked-projects.json";

function configDir(projectRoot: string): string {
  return join(projectRoot, ".pi");
}

function configPath(projectRoot: string): string {
  return join(configDir(projectRoot), CONFIG_FILENAME);
}

export async function loadLinkedProjects(projectRoot: string): Promise<LinkedProjectsConfig> {
  const filePath = configPath(projectRoot);
  try {
    if (!existsSync(filePath)) {
      return { projects: [] };
    }
    const raw = await readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<LinkedProjectsConfig>;
    return {
      projects: parsed.projects ?? [],
    };
  } catch {
    log.error("Failed to load linked projects config", { path: filePath });
    return { projects: [] };
  }
}

export async function saveLinkedProjects(
  projectRoot: string,
  config: LinkedProjectsConfig,
): Promise<void> {
  const dir = configDir(projectRoot);
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  const filePath = configPath(projectRoot);
  await writeFile(filePath, JSON.stringify(config, null, 2), "utf-8");
}

export async function getLinkedProjects(projectRoot: string): Promise<LinkedProject[]> {
  const config = await loadLinkedProjects(projectRoot);
  return config.projects;
}

export async function linkProject(
  projectRoot: string,
  project: LinkedProject & { validatePath?: boolean },
): Promise<LinkResult> {
  if (project.validatePath && !existsSync(project.path)) {
    return { ok: false, error: `Project path "${project.path}" does not exist` };
  }

  const config = await loadLinkedProjects(projectRoot);
  const existing = config.projects.find((p) => p.id === project.id);
  if (existing) {
    return { ok: false, error: `Project "${project.id}" is already linked` };
  }

  const { validatePath: _validatePath, ...toSave } = project;
  config.projects.push(toSave);
  await saveLinkedProjects(projectRoot, config);

  log.info("Linked project", { id: project.id, path: project.path });
  return { ok: true };
}

export async function unlinkProject(
  projectRoot: string,
  projectId: string,
): Promise<LinkResult> {
  const config = await loadLinkedProjects(projectRoot);
  const idx = config.projects.findIndex((p) => p.id === projectId);
  if (idx === -1) {
    return { ok: false, error: `Project "${projectId}" not found` };
  }

  config.projects.splice(idx, 1);
  await saveLinkedProjects(projectRoot, config);

  log.info("Unlinked project", { id: projectId });
  return { ok: true };
}
