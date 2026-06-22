import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  getProjectExecutionSandboxPath,
  normalizeProjectPath,
} from "./pi-agent-paths";

export type ExecutionSandboxMode = "off" | "filesystem";

export interface ProjectExecutionSandboxState {
  projectPath: string;
  mode: ExecutionSandboxMode;
  configPath: string;
}

export interface ExecutionSandboxConfigFile {
  mode?: unknown;
}

export function normalizeExecutionSandboxMode(value: unknown): ExecutionSandboxMode {
  return value === "filesystem" ? "filesystem" : "off";
}

export function readProjectExecutionSandbox(
  projectPath: string,
): ProjectExecutionSandboxState {
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  const configPath = getProjectExecutionSandboxPath(normalizedProjectPath);
  let mode: ExecutionSandboxMode = "off";

  if (existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = JSON.parse(raw) as ExecutionSandboxConfigFile;
    mode = normalizeExecutionSandboxMode(parsed.mode);
  }

  return {
    projectPath: normalizedProjectPath,
    mode,
    configPath,
  };
}

export function writeProjectExecutionSandbox(
  projectPath: string,
  mode: ExecutionSandboxMode,
): ProjectExecutionSandboxState {
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  const configPath = getProjectExecutionSandboxPath(normalizedProjectPath);
  const normalizedMode = normalizeExecutionSandboxMode(mode);

  mkdirSync(dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({ mode: normalizedMode }, null, 2)}\n`, "utf-8");

  return {
    projectPath: normalizedProjectPath,
    mode: normalizedMode,
    configPath,
  };
}

export function applyExecutionSandboxEnv(
  env: NodeJS.ProcessEnv,
  mode: ExecutionSandboxMode,
): NodeJS.ProcessEnv {
  const next = { ...env };
  if (mode === "filesystem") {
    next.PI_SANDBOX_RUNTIME = "1";
  } else {
    delete next.PI_SANDBOX_RUNTIME;
  }
  return next;
}
