import { spawn, type ChildProcess } from "child_process";
import { execSync } from "child_process";
import WebSocket from "ws";
import { tmpdir, homedir } from "os";
import { join } from "path";
import { mkdir, rm, symlink } from "fs/promises";
import { existsSync } from "fs";

export interface TestServerConfig {
  port: number;
  authToken: string;
  projectPath?: string;
}

export interface TestServerResult {
  proc: ChildProcess;
  tmpDir: string;
}

function killPort(port: number): void {
  try {
    execSync(`lsof -ti:${port} | xargs kill -9 2>/dev/null || true`, {
      stdio: "pipe",
      timeout: 5000,
    });
  } catch {
    // port is free, ignore
  }
}

async function waitForPortFree(port: number, timeoutMs = 5000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      execSync(`lsof -ti:${port}`, { stdio: "pipe" });
      await new Promise((r) => setTimeout(r, 300));
    } catch {
      return;
    }
  }
  throw new Error(`Port ${port} still in use after ${timeoutMs}ms`);
}

export async function startTestServer(config: TestServerConfig): Promise<TestServerResult> {
  const tmpDir = join(tmpdir(), `pi-test-${config.port}-${Date.now()}`);
  await mkdir(tmpDir, { recursive: true });

  killPort(config.port);
  await waitForPortFree(config.port);

  const isolatedHome = join(tmpDir, "home");
  await mkdir(isolatedHome, { recursive: true });
  await mkdir(join(isolatedHome, ".claude"), { recursive: true });

  // Symlink .pi/agent/ from real home so pi CLI can find models.json, auth.json, extensions, etc.
  const realPiAgent = join(homedir(), ".pi", "agent");
  const isolatedPi = join(isolatedHome, ".pi");
  if (existsSync(realPiAgent)) {
    await mkdir(isolatedPi, { recursive: true });
    const isolatedPiAgent = join(isolatedPi, "agent");
    if (!existsSync(isolatedPiAgent)) {
      await symlink(realPiAgent, isolatedPiAgent, "junction");
    }
  }

  const wsUrl = `ws://localhost:${config.port}/ws?token=${config.authToken}`;
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    PORT: String(config.port),
    AUTH_TOKEN: config.authToken,
    LOG_DIR: join(tmpDir, "logs"),
    HOME: isolatedHome,
  };

  const proc = spawn("bun", ["src/server.ts"], {
    cwd: process.cwd(),
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });

  const serverLog: string[] = [];
  proc.stdout?.on("data", (d: Buffer) => serverLog.push(`[stdout] ${d.toString().trim()}`));
  proc.stderr?.on("data", (d: Buffer) => serverLog.push(`[stderr] ${d.toString().trim()}`));

  proc.on("exit", (code) => {
    serverLog.push(`[exit] code=${code}`);
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const log = serverLog.join("\n");
      reject(new Error(`Server startup timeout (port ${config.port})\nServer log:\n${log}`));
    }, 30000);

    const check = () => {
      if (proc.exitCode !== null) {
        clearTimeout(timeout);
        const log = serverLog.join("\n");
        reject(
          new Error(`Server exited prematurely with code ${proc.exitCode}\nServer log:\n${log}`),
        );
        return;
      }
      const ws = new WebSocket(wsUrl);
      ws.on("open", () => {
        clearTimeout(timeout);
        ws.close();
        resolve();
      });
      ws.on("error", () => {
        setTimeout(check, 500);
      });
    };
    setTimeout(check, 1000);
  });

  return { proc, tmpDir };
}

export async function stopTestServer(result: TestServerResult): Promise<void> {
  const { proc, tmpDir } = result;
  if (proc.exitCode === null) {
    proc.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        proc.kill("SIGKILL");
        resolve();
      }, 5000);
      proc.on("exit", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
}
