import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let oldAgentDir: string | undefined;
let tempRoot: string;
let projectPath: string;

beforeEach(async () => {
  oldAgentDir = process.env.PI_CODING_AGENT_DIR;
  tempRoot = await mkdtemp(join(tmpdir(), "pi-exec-sandbox-test-"));
  process.env.PI_CODING_AGENT_DIR = join(tempRoot, "agent");
  projectPath = join(tempRoot, "project");
});

afterEach(async () => {
  if (oldAgentDir === undefined) {
    delete process.env.PI_CODING_AGENT_DIR;
  } else {
    process.env.PI_CODING_AGENT_DIR = oldAgentDir;
  }
  await rm(tempRoot, { recursive: true, force: true });
});

describe("execution sandbox config", () => {
  it("defaults to off when no project config exists", async () => {
    const { readProjectExecutionSandbox } = await import(
      "../../../src/shared/lib/execution-sandbox-config"
    );

    const state = readProjectExecutionSandbox(projectPath);

    expect(state.mode).toBe("off");
    expect(state.projectPath).toBe(projectPath);
    expect(state.configPath).toContain("/projects/");
    expect(state.configPath.endsWith("/execution-sandbox.json")).toBe(true);
  });

  it("persists filesystem mode under the project user state dir", async () => {
    const { readProjectExecutionSandbox, writeProjectExecutionSandbox } = await import(
      "../../../src/shared/lib/execution-sandbox-config"
    );

    const written = writeProjectExecutionSandbox(projectPath, "filesystem");
    const raw = JSON.parse(await readFile(written.configPath, "utf-8"));
    const readBack = readProjectExecutionSandbox(projectPath);

    expect(raw).toEqual({ mode: "filesystem" });
    expect(readBack.mode).toBe("filesystem");
    expect(readBack.configPath).toBe(written.configPath);
  });

  it("normalizes invalid persisted modes to off", async () => {
    const { readProjectExecutionSandbox, writeProjectExecutionSandbox } = await import(
      "../../../src/shared/lib/execution-sandbox-config"
    );

    const written = writeProjectExecutionSandbox(projectPath, "filesystem");
    await writeFile(written.configPath, JSON.stringify({ mode: "unknown" }), "utf-8");

    expect(existsSync(written.configPath)).toBe(true);
    expect(readProjectExecutionSandbox(projectPath).mode).toBe("off");
  });

  it("applies the agent child process env switch", async () => {
    const { applyExecutionSandboxEnv } = await import(
      "../../../src/shared/lib/execution-sandbox-config"
    );

    const enabled = applyExecutionSandboxEnv({ FOO: "bar" }, "filesystem");
    const disabled = applyExecutionSandboxEnv({ PI_SANDBOX_RUNTIME: "1", FOO: "bar" }, "off");

    expect(enabled).toMatchObject({ FOO: "bar", PI_SANDBOX_RUNTIME: "1" });
    expect(disabled).toMatchObject({ FOO: "bar" });
    expect(disabled.PI_SANDBOX_RUNTIME).toBeUndefined();
  });
});
