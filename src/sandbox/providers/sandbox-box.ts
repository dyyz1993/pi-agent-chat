import { execFile } from "child_process";
import { resolve } from "path";
import { existsSync } from "fs";
import { createLogger } from "../../shared/lib/logger";
import { getProjectRoot } from "../../shared/lib/paths";
import type { ISandboxProvider, SandboxInstance } from "../types";

const log = createLogger("sandbox-box");

export interface SandboxBoxConfig {
  sshHost: string;
  sshPort: number;
  sshUser: string;
  sshKeyPath: string;
  sandboxPort: number;
  bridgePort: number;
  baseLocalPort: number;
  piCliPath: string;
  projectSourcePath: string;
  modelsJsonPath?: string;
  settingsJsonPath?: string;
  extensionsPath?: string;
}

interface SandboxRecord {
  instance: SandboxInstance;
  tunnelPid?: number;
}

function exec(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 },
      (err, stdout, stderr) => {
        if (err) {
          reject(new Error(`${cmd} ${args.join(" ")} failed: ${err.message}\nstderr: ${stderr}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class SandboxBoxProvider implements ISandboxProvider {
  private readonly config: SandboxBoxConfig;
  private readonly sandboxes = new Map<string, SandboxRecord>();
  private nextLocalPort: number;

  constructor(config: SandboxBoxConfig) {
    this.config = config;
    this.nextLocalPort = config.baseLocalPort;
  }

  private sandboxName(userId: string): string {
    return `user-${userId}`;
  }

  private async ssh(cmd: string): Promise<string> {
    const args = [
      "-i",
      this.config.sshKeyPath,
      "-p",
      String(this.config.sshPort),
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      `${this.config.sshUser}@${this.config.sshHost}`,
      cmd,
    ];
    return exec("ssh", args);
  }

  private async nsenter(pid: number, cmd: string): Promise<string> {
    return this.ssh(`nsenter -t ${pid} -p -m -n -- ${cmd}`);
  }

  private async scp(localPath: string, remotePath: string): Promise<void> {
    const args = [
      "-i",
      this.config.sshKeyPath,
      "-P",
      String(this.config.sshPort),
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      localPath,
      `${this.config.sshUser}@${this.config.sshHost}:${remotePath}`,
    ];
    await exec("scp", args);
  }

  private allocLocalPort(): number {
    return this.nextLocalPort++;
  }

  private async findSandboxPid(name: string): Promise<number | null> {
    try {
      const out = await this.ssh("sandbox list");
      const lines = out.split("\n");
      for (const line of lines) {
        if (line.includes(name) && line.includes("running")) {
          const parts = line.trim().split(/\s+/);
          const numParts = parts.filter((p) => /^\d+$/.test(p));
          const pidStr = numParts[numParts.length - 1];
          if (pidStr) {
            return parseInt(pidStr, 10);
          }
        }
      }
      return null;
    } catch {
      return null;
    }
  }

  private async getSandboxIP(pid: number): Promise<string> {
    const out = await this.nsenter(pid, "ip addr show eth0");
    const match = out.match(/inet\s+(10\.10\.\d+\.\d+)/);
    if (!match) {
      throw new Error(`failed to find sandbox IP for pid ${pid}`);
    }
    return match[1];
  }

  private async waitForBridge(pid: number, maxRetries = 15): Promise<void> {
    const sandboxIP = await this.getSandboxIP(pid);
    for (let i = 0; i < maxRetries; i++) {
      try {
        const out = await this.nsenter(
          pid,
          `curl -sf http://${sandboxIP}:${this.config.bridgePort}/health --max-time 3`,
        );
        const parsed = JSON.parse(out) as { status: string };
        if (parsed.status === "ok") {
          log.info("bridge ready", { pid, sandboxIP });
          return;
        }
      } catch {
        // not ready yet
      }
      log.info("waiting for bridge", { attempt: i + 1, pid });
      await sleep(2000);
    }
    throw new Error(`bridge not ready after ${maxRetries} retries for pid ${pid}`);
  }

  private async killTunnel(localPort: number): Promise<void> {
    try {
      let pids: string[] = [];
      try {
        const out = await exec("lsof", ["-ti", `:${localPort}`]);
        pids = out.trim().split("\n").filter(Boolean);
      } catch {
        try {
          const out = await exec("ss", ["-tlnp", `sport = :${localPort}`]);
          const pidRegex = /pid=(\d+)/g;
          let match: RegExpExecArray | null;
          while ((match = pidRegex.exec(out)) !== null) {
            pids.push(match[1]);
          }
        } catch {}
      }
      for (const pid of pids) {
        try {
          process.kill(parseInt(pid, 10), "SIGKILL");
        } catch {}
      }
    } catch {}
  }

  private async establishTunnel(localPort: number, sandboxIP: string): Promise<void> {
    const args = [
      "-i",
      this.config.sshKeyPath,
      "-p",
      String(this.config.sshPort),
      "-o",
      "StrictHostKeyChecking=no",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      "-f",
      "-N",
      "-L",
      `${localPort}:${sandboxIP}:${this.config.bridgePort}`,
      `${this.config.sshUser}@${this.config.sshHost}`,
    ];
    await exec("ssh", args);
  }

  private async isSandboxAlive(name: string): Promise<boolean> {
    try {
      const pid = await this.findSandboxPid(name);
      return pid !== null && pid > 0;
    } catch {
      return false;
    }
  }

  async getOrCreate(userId: string, _config: SandboxProviderConfig): Promise<SandboxInstance> {
    const name = this.sandboxName(userId);
    const projectPath = this.config.projectSourcePath;
    const existing = this.sandboxes.get(userId);
    if (existing && existing.instance.status === "ready") {
      const alive = await this.isSandboxAlive(name);
      if (alive) {
        existing.instance.lastActiveAt = Date.now();
        return existing.instance;
      }
      log.warn("sandbox marked ready but dead on host, will recreate", { name });
      if (existing.instance.sandboxPid) {
        await this._backupMemoryFromPid(userId, existing.instance.sandboxPid).catch(() => {});
      }
      this.sandboxes.delete(userId);
    }

    const pid = await this.findSandboxPid(name);

    if (pid !== null && pid > 0) {
      log.info("sandbox exists, re-establishing tunnel", { name, pid });
      const sandboxIP = await this.getSandboxIP(pid);
      const localPort = this.allocLocalPort();
      await this.killTunnel(localPort);
      await this.establishTunnel(localPort, sandboxIP);
      await this.waitForBridge(pid);

      const instance: SandboxInstance = {
        id: name,
        userId,
        projectPath,
        endpoint: `http://127.0.0.1:${localPort}`,
        status: "ready",
        createdAt: existing?.instance.createdAt ?? Date.now(),
        lastActiveAt: Date.now(),
        sandboxName: name,
        sandboxPid: pid,
        localPort,
      };
      this.sandboxes.set(userId, { instance, tunnelPid: undefined });
      return instance;
    }

    log.info("creating sandbox", { name });
    await this._syncFromPreservedData(userId, name);
    await this.ssh(`sandbox destroy ${name} 2>/dev/null || true`);
    const record: SandboxRecord = {
      instance: {
        id: name,
        userId,
        projectPath,
        endpoint: "",
        status: "creating",
        createdAt: Date.now(),
        lastActiveAt: Date.now(),
        sandboxName: name,
      },
    };
    this.sandboxes.set(userId, record);

    try {
      await this.ssh(`sandbox create ${name} --port ${this.config.sandboxPort} || true`).catch(
        (err) => {
          log.warn("sandbox create had errors (ignored)", { error: err.message });
        },
      );

      const newPid = await this.findSandboxPid(name);
      if (newPid === null) {
        throw new Error(`failed to find sandbox pid after create for ${name}`);
      }
      record.instance.sandboxPid = newPid;
      record.instance.status = "starting";
      log.info("sandbox created", { name, pid: newPid });

      const npmGlobal = "/usr/local";
      const piPath = `${npmGlobal}/bin/pi`;

      const piExists = await this.nsenter(newPid, `test -f ${piPath} && echo yes`).catch(() => "");
      if (piExists.trim() !== "yes") {
        await this.nsenter(
          newPid,
          `bash -c 'PATH="/usr/local/bin:/usr/bin:/bin" npm install -g @dyyz1993/pi-coding-agent 2>&1 || true'`,
        ).catch(() => log.warn("npm install pi failed (non-fatal)", { name }));
      }
      log.info("pi ready", { name, pid: newPid, existed: piExists.trim() === "yes" });

      const tmpDir = `/tmp/sandbox-staging-${name}`;
      await this.ssh(`mkdir -p ${tmpDir}`);

      if (this.config.modelsJsonPath) {
        await this.scp(this.config.modelsJsonPath, `${tmpDir}/models.json`);
        await this.nsenter(newPid, `mkdir -p /root/.pi/agent`);
        await this.ssh(
          `nsenter -t ${newPid} -p -m -n -- cp ${tmpDir}/models.json /root/.pi/agent/models.json`,
        );
      }

      if (this.config.settingsJsonPath) {
        await this.scp(this.config.settingsJsonPath, `${tmpDir}/settings.json`);
        await this.nsenter(newPid, `mkdir -p /root/.pi/agent`);
        await this.ssh(
          `nsenter -t ${newPid} -p -m -n -- cp ${tmpDir}/settings.json /root/.pi/agent/settings.json`,
        );
      }

      if (this.config.extensionsPath) {
        await this.ssh(
          `tar czf ${tmpDir}/extensions.tar.gz -C ${this.config.extensionsPath} . || true`,
        );
        await this.nsenter(newPid, `mkdir -p /root/.pi/agent/extensions`);
        await this.ssh(
          `nsenter -t ${newPid} -p -m -n -- bash -c 'tar xzf ${tmpDir}/extensions.tar.gz -C /root/.pi/agent/extensions'`,
        );
      }

      const mjsPath = resolve(getProjectRoot(), "dist-server/sandbox-agent.mjs");
      const jsPath = resolve(getProjectRoot(), "dist-server/sandbox-agent.js");
      const agentBundle = existsSync(mjsPath) ? mjsPath : jsPath;
      const agentExt = agentBundle.endsWith(".mjs") ? "mjs" : "js";
      const agentName = `sandbox-agent.${agentExt}`;
      const tmpBundle = `${tmpDir}/${agentName}`;
      await this.scp(agentBundle, tmpBundle);
      await this.nsenter(newPid, `mkdir -p /root/workspace`);
      await this.ssh(
        `nsenter -t ${newPid} -p -m -n -- cp ${tmpDir}/${agentName} /root/workspace/${agentName}`,
      );
      await this.nsenter(newPid, `mkdir -p /root/workspace/project`);

      await this._restoreUserDataToSandbox(userId, newPid);

      const startCmd = [
        `PATH="${npmGlobal}/bin:/usr/local/bin:/usr/bin:/bin"`,
        `setsid node /root/workspace/${agentName}`,
        `--port=${this.config.bridgePort}`,
        `--cli-path=${piPath}`,
        "--cwd=/root/workspace/project",
        "</dev/null",
        ">/root/workspace/bridge.log",
        "2>&1 & disown",
      ].join(" ");

      await this.nsenter(newPid, `bash -c '${startCmd}'`);
      log.info("bridge started", { name, pid: newPid });

      await this.waitForBridge(newPid);

      const sandboxIP = await this.getSandboxIP(newPid);
      const localPort = this.allocLocalPort();
      await this.killTunnel(localPort);
      await this.establishTunnel(localPort, sandboxIP);

      record.instance.endpoint = `http://127.0.0.1:${localPort}`;
      record.instance.status = "ready";
      record.instance.localPort = localPort;
      record.instance.lastActiveAt = Date.now();

      log.info("sandbox ready", {
        name,
        pid: newPid,
        localPort,
        endpoint: record.instance.endpoint,
      });
      return record.instance;
    } catch (err) {
      record.instance.status = "error";
      log.error("failed to create sandbox", {
        name,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  private userDataDir(userId: string): string {
    return `/root/data/user-data/${userId}`;
  }

  private async _backupMemoryFromPid(userId: string, pid: number): Promise<void> {
    try {
      const hasWorkspace = await this.nsenter(
        pid,
        `test -d /root/workspace && echo yes || echo no`,
      );
      if (hasWorkspace.trim() === "yes") {
        await this.ssh(`mkdir -p ${this.userDataDir(userId)}`);
        const backupDir = `${this.userDataDir(userId)}/workspace`;
        await this.ssh(`rm -rf ${backupDir}`);
        await this.ssh(`mkdir -p ${backupDir}`);
        await this.ssh(
          `nsenter -t ${pid} -p -m -n -- bash -c 'tar cf - --exclude=sandbox-agent.* --exclude=bridge.log -C /root workspace' | tar xf - -C ${this.userDataDir(userId)}`,
        );
      }

      const hasMemory = await this.nsenter(
        pid,
        `test -d /root/.pi/agent/memory && echo yes || echo no`,
      ).catch(() => "no");
      if (hasMemory.trim() === "yes") {
        const memoryBackupDir = `${this.userDataDir(userId)}/pi-memory`;
        await this.ssh(`rm -rf ${memoryBackupDir} && mkdir -p ${memoryBackupDir}`);
        await this.ssh(
          `nsenter -t ${pid} -p -m -n -- bash -c 'tar cf - -C /root/.pi/agent memory' | tar xf - -C ${memoryBackupDir}`,
        );
      }
      log.info("backupFromPid: backed up", { userId });
    } catch (err) {
      log.warn("backupFromPid: failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async _syncFromPreservedData(userId: string, name: string): Promise<void> {
    try {
      const preservedHome = `/root/data/sandboxes/${name}/home`;
      const hasPreserved = await this.ssh(
        `test -d ${preservedHome}/workspace && echo yes || echo no`,
      );
      if (hasPreserved.trim() !== "yes") {
        log.info("syncFromPreservedData: no preserved data", { userId, name });
        return;
      }

      const targetDir = `${this.userDataDir(userId)}/workspace`;
      const hasTarget = await this.ssh(`test -d ${targetDir} && echo yes || echo no`);

      if (hasTarget.trim() === "yes") {
        log.info("syncFromPreservedData: user-data already exists, skipping", { userId });
        return;
      }

      await this.ssh(`mkdir -p ${this.userDataDir(userId)}`);
      await this.ssh(
        `tar cf - --exclude=sandbox-agent.* --exclude=bridge.log -C ${preservedHome} workspace | tar xf - -C ${this.userDataDir(userId)}`,
      );
      log.info("syncFromPreservedData: restored from preserved", { userId, name });
    } catch (err) {
      log.warn("syncFromPreservedData: failed", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async _restoreUserDataToSandbox(userId: string, pid: number): Promise<void> {
    const workspaceDir = `${this.userDataDir(userId)}/workspace`;
    const memoryDir = `${this.userDataDir(userId)}/pi-memory/memory`;
    try {
      const hasWorkspace = await this.ssh(`test -d ${workspaceDir} && echo yes || echo no`);
      if (hasWorkspace.trim() === "yes") {
        await this.ssh(
          `tar cf - -C ${this.userDataDir(userId)} workspace | nsenter -t ${pid} -p -m -n -- tar xf - -C /root`,
        );
      }

      const hasMemory = await this.ssh(`test -d ${memoryDir} && echo yes || echo no`);
      if (hasMemory.trim() === "yes") {
        await this.nsenter(pid, `mkdir -p /root/.pi/agent/memory`);
        await this.ssh(
          `tar cf - -C ${this.userDataDir(userId)}/pi-memory memory | nsenter -t ${pid} -p -m -n -- tar xf - -C /root/.pi/agent`,
        );
      }

      log.info("restoreUserData: restored", { userId });
    } catch (err) {
      log.warn("restoreUserData: failed (non-fatal)", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  async destroy(userId: string): Promise<void> {
    const record = this.sandboxes.get(userId);
    if (!record) return;

    const name = this.sandboxName(userId);

    if (record.instance.localPort) {
      await this.killTunnel(record.instance.localPort).catch(() => {});
    }

    if (record.instance.sandboxPid) {
      await this._backupMemoryFromPid(userId, record.instance.sandboxPid).catch(() => {});
    }

    try {
      await this.ssh(`sandbox destroy ${name}`);
    } catch (err) {
      log.warn("failed to destroy sandbox on remote", {
        name,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.sandboxes.delete(userId);
    log.info("sandbox destroyed", { name });
  }

  async getStatus(userId: string): Promise<SandboxInstance | null> {
    const record = this.sandboxes.get(userId);
    return record?.instance ?? null;
  }

  async isAlive(userId: string): Promise<boolean> {
    const name = this.sandboxName(userId);
    return this.isSandboxAlive(name);
  }

  keepAlive(userId: string): void {
    const record = this.sandboxes.get(userId);
    if (record) {
      record.instance.lastActiveAt = Date.now();
    }
  }

  async execInSandbox(userId: string, cmd: string): Promise<string> {
    const record = this.sandboxes.get(userId);
    if (!record?.instance.sandboxPid) {
      throw new Error(`No running sandbox for ${userId}`);
    }
    return this.nsenter(record.instance.sandboxPid, cmd);
  }

  getSandboxPid(userId: string): number | undefined {
    return this.sandboxes.get(userId)?.instance.sandboxPid;
  }

  async cleanupStaleSandboxes(
    activePrefixes: string[],
  ): Promise<{ destroyed: number; kept: number }> {
    log.info("cleanupStaleSandboxes: scanning", { activePrefixes });
    try {
      const out = await this.ssh("sandbox list 2>/dev/null || true");
      const lines = out
        .split("\n")
        .filter((l) => l.trim() && !l.includes("NAME") && !l.includes("---"));
      let destroyed = 0;
      let kept = 0;
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const name = parts[0];
        if (!name || name.startsWith("pi-sandbox-box")) {
          kept++;
          continue;
        }
        const isActive = activePrefixes.some((p) => name === p);
        if (isActive) {
          kept++;
          continue;
        }
        const status = parts[1] ?? "";
        const pidStr = parts[parts.length - 1] ?? "0";
        const pid = parseInt(pidStr, 10);
        const isStopped = status === "stopped" || pid === 0;
        const isUserOwned = name.startsWith("user-");
        const isOldRunning = !isActive && !isStopped && !isUserOwned;
        const shouldCleanup = isOldRunning || (isStopped && !isUserOwned);
        if (shouldCleanup) {
          try {
            if (name.startsWith("user-") && pid > 0) {
              const userId = name.slice(5);
              await this._backupMemoryFromPid(userId, pid).catch(() => {});
            }
            await this.ssh(`sandbox destroy ${name} 2>/dev/null || true`);
            if (!name.startsWith("user-")) {
              await this.ssh(`rm -rf /root/data/sandboxes/${name} 2>/dev/null || true`);
            }
            log.info("cleanupStaleSandboxes: destroyed", { name, wasStopped: isStopped });
            destroyed++;
          } catch (err) {
            log.warn("cleanupStaleSandboxes: destroy failed", { name, error: String(err) });
          }
        } else {
          kept++;
        }
      }
      log.info("cleanupStaleSandboxes: done", { destroyed, kept });
      return { destroyed, kept };
    } catch (err) {
      log.warn("cleanupStaleSandboxes: scan failed", { error: String(err) });
      return { destroyed: 0, kept: 0 };
    }
  }

  async shutdown(): Promise<void> {
    const userIds = [...this.sandboxes.keys()];
    await Promise.all(
      userIds.map((userId) =>
        this.destroy(userId).catch((err) => {
          log.warn("shutdown destroy failed", {
            userId,
            error: err instanceof Error ? err.message : String(err),
          });
        }),
      ),
    );
  }
}
