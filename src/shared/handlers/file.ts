import type { RPCServer } from "@dyyz1993/rpc-core";
import type { Dirent } from "fs";
import type { HandlerOptions } from "../rpc-schema";
import { createRegister } from "../rpc-schema";
import { readdir, stat, writeFile, readFile, mkdir, rename, rm, cp } from "fs/promises";
import { existsSync, watch, statSync } from "fs";
import { join, dirname, resolve, posix } from "path";
import { createLogger } from "../lib/logger";
import type { RemoteProjectRecord } from "../modules/project";
import { listRemoteProjects } from "../lib/project-config";

const log = createLogger("file");

const DEBOUNCE_MS = 800;

type FileTarget =
  | { kind: "local"; path: string }
  | { kind: "ssh"; path: string; remote: RemoteProjectRecord };

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function stripTrailingSlash(value: string): string {
  return value.length > 1 ? value.replace(/\/+$/, "") : value;
}

function relativeIfInside(basePath: string, candidatePath: string): string | null {
  const base = stripTrailingSlash(basePath);
  const candidate = stripTrailingSlash(candidatePath);
  if (candidate === base) return "";
  const prefix = `${base}/`;
  return candidate.startsWith(prefix) ? candidate.slice(prefix.length) : null;
}

async function resolveFileTarget(inputPath: string | undefined): Promise<FileTarget> {
  const rawPath = inputPath ?? process.cwd();
  const localPath = resolve(rawPath);
  const remoteProjects = await listRemoteProjects().catch(() => []);
  for (const remote of remoteProjects) {
    const localSuffix = relativeIfInside(resolve(remote.localPath), localPath);
    if (localSuffix !== null) {
      return {
        kind: "ssh",
        path: localSuffix ? posix.join(remote.remotePath, localSuffix) : remote.remotePath,
        remote,
      };
    }
    const remoteSuffix = relativeIfInside(remote.remotePath, rawPath);
    if (remoteSuffix !== null) {
      return { kind: "ssh", path: rawPath, remote };
    }
  }
  return { kind: "local", path: localPath };
}

function runSshCommand(
  remote: RemoteProjectRecord,
  command: string,
  options?: { allowNonZero?: boolean; stdin?: string },
): { stdout: string; stderr: string; exitCode: number } {
  const proc = Bun.spawnSync(
    [
      "ssh",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=8",
      ...(remote.sshArgs ?? []),
      remote.host,
      command,
    ],
    {
      stdout: "pipe",
      stderr: "pipe",
      stdin: options?.stdin ? Buffer.from(options.stdin) : undefined,
    },
  );
  const stdout = proc.stdout.toString();
  const stderr = proc.stderr.toString();
  if (proc.exitCode !== 0 && !options?.allowNonZero) {
    throw new Error(stderr.trim() || "ssh command failed");
  }
  return { stdout, stderr, exitCode: proc.exitCode ?? 0 };
}

function remoteDirname(filePath: string): string {
  return posix.dirname(filePath);
}

function remoteJoin(...parts: string[]): string {
  return posix.join(...parts);
}

const watcherState = new WeakMap<
  RPCServer,
  {
    watcher: ReturnType<typeof watch> | null;
    path: string | null;
    debounceTimer: ReturnType<typeof setTimeout> | null;
    pendingChanges: Map<string, "create" | "delete" | "rename">;
    gitignoreFn: ((path: string, isDir: boolean) => boolean) | null;
  }
>();

function getWatcherState(server: RPCServer) {
  if (!watcherState.has(server)) {
    watcherState.set(server, {
      watcher: null,
      path: null,
      debounceTimer: null,
      pendingChanges: new Map(),
      gitignoreFn: null,
    });
  }
  return watcherState.get(server) as {
    watcher: ReturnType<typeof watch> | null;
    path: string | null;
    debounceTimer: ReturnType<typeof setTimeout> | null;
    pendingChanges: Map<string, "create" | "delete" | "rename">;
    gitignoreFn: ((path: string, isDir: boolean) => boolean) | null;
  };
}

function startFileWatcher(server: RPCServer, projectPath: string): void {
  const state = getWatcherState(server);
  if (state.path === projectPath && state.watcher) return;
  stopFileWatcher(server);

  state.path = projectPath;
  state.gitignoreFn = null;

  // Async-load .gitignore rules for one-level filtering
  loadGitignoreRules(projectPath).then((fn) => {
    const s = getWatcherState(server);
    if (s.path === projectPath) {
      s.gitignoreFn = fn;
      log.debug("File watcher .gitignore rules loaded", { path: projectPath });
    }
  });

  try {
    state.watcher = watch(projectPath, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const segments = filename.split(/[/\\]/);

      // 1) Always exclude build artifacts & vcs dirs at any depth
      if (segments.includes("node_modules") || segments.includes(".git")) return;

      // 2) Depth limit: only push top-level (depth === 1) changes.
      //    Deeper changes are ignored — user can manually refresh the tree.
      if (segments.length > 1) return;

      const changedPath = join(projectPath, filename);

      // 3) .gitignore filter (skip top-level entries that are ignored)
      if (state.gitignoreFn) {
        let isDir = false;
        try {
          isDir = statSync(changedPath).isDirectory();
        } catch {
          // file may already be deleted — treat as file
        }
        if (state.gitignoreFn(filename, isDir)) return;
      }

      const changeType: "create" | "delete" | "rename" =
        eventType === "rename" ? (existsSync(changedPath) ? "create" : "delete") : "create";

      state.pendingChanges.set(changedPath, changeType);

      if (state.debounceTimer) clearTimeout(state.debounceTimer);
      state.debounceTimer = setTimeout(() => {
        const s = getWatcherState(server);
        s.debounceTimer = null;
        for (const [path, type] of s.pendingChanges) {
          server.emitEvent("file.changed", { changedPath: path, type });
        }
        s.pendingChanges.clear();
      }, DEBOUNCE_MS);
    });

    state.watcher.on("error", (err) => {
      log.error("File watcher error", { error: err instanceof Error ? err.message : String(err) });
    });

    log.info("File watcher started", { path: projectPath });
  } catch (err) {
    log.error("Failed to start file watcher", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function stopFileWatcher(server: RPCServer): void {
  const state = getWatcherState(server);
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer);
    state.debounceTimer = null;
  }
  if (state.watcher) {
    state.watcher.close();
    state.watcher = null;
  }
  state.path = null;
  state.gitignoreFn = null;
}

function parseGitignore(content: string): (path: string, isDir: boolean) => boolean {
  const patterns: { pattern: string; isDirOnly: boolean; isNegated: boolean }[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const isNegated = trimmed.startsWith("!");
    let pattern = isNegated ? trimmed.slice(1) : trimmed;
    const isDirOnly = pattern.endsWith("/");
    if (isDirOnly) pattern = pattern.slice(0, -1);
    if (!pattern) continue;
    patterns.push({ pattern, isDirOnly, isNegated });
  }
  return (relativePath: string, isDir: boolean) => {
    for (const { pattern, isDirOnly, isNegated } of patterns) {
      if (isDirOnly && !isDir) continue;
      const regexStr =
        "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
      try {
        if (new RegExp(regexStr, "i").test(relativePath)) return !isNegated;
      } catch (e) {
        log.debug("parseGitignore: skipping invalid regex", {
          pattern,
          regexStr,
          error: String(e),
        });
      }
    }
    return false;
  };
}

async function loadGitignoreRules(
  dirPath: string,
): Promise<(path: string, isDir: boolean) => boolean> {
  const gitignorePath = join(dirPath, ".gitignore");
  if (existsSync(gitignorePath)) {
    try {
      const content = await readFile(gitignorePath, "utf-8");
      return parseGitignore(content);
    } catch (e) {
      log.debug("loadGitignoreRules: failed to read .gitignore", {
        gitignorePath,
        error: String(e),
      });
    }
  }
  return () => false;
}

function sortEntries(entries: Dirent[]): Dirent[] {
  return [...entries].sort((a, b) => {
    const aIsDir = a.isDirectory();
    const bIsDir = b.isDirectory();
    if (aIsDir !== bIsDir) return aIsDir ? -1 : 1;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });
}

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r = createRegister(server);

  r("file.findProjectRoot", async () => {
    let dir = process.cwd();
    for (let i = 0; i < 20; i++) {
      if (existsSync(join(dir, "package.json"))) return { path: dir };
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    return { path: process.cwd() };
  });

  r("file.listDir", async (params) => {
    const target = await resolveFileTarget(params.path);
    const basePath = target.path;
    if (target.kind === "local") {
      startFileWatcher(server, basePath);
    } else {
      stopFileWatcher(server);
    }
    const entries: {
      name: string;
      path: string;
      type: "file" | "directory";
      size?: number;
      isIgnored?: boolean;
    }[] = [];
    try {
      if (target.kind === "ssh") {
        const code = [
          "import json, os, sys",
          "base = sys.argv[1]",
          "items = []",
          "for name in os.listdir(base):",
          "    if name == '.git':",
          "        continue",
          "    path = os.path.join(base, name)",
          "    try:",
          "        st = os.stat(path)",
          "        is_dir = os.path.isdir(path)",
          "        items.append({'name': name, 'path': path, 'type': 'directory' if is_dir else 'file', 'size': st.st_size, 'isIgnored': False})",
          "    except Exception:",
          "        items.append({'name': name, 'path': path, 'type': 'file', 'isIgnored': False})",
          "items.sort(key=lambda item: (item['type'] != 'directory', item['name'].lower()))",
          "print(json.dumps({'entries': items, 'basePath': base}))",
        ].join("\n");
        const result = runSshCommand(
          target.remote,
          `python3 -c ${shellQuote(code)} ${shellQuote(basePath)}`,
        );
        const parsed = JSON.parse(result.stdout) as { entries?: typeof entries; basePath?: string };
        return { entries: parsed.entries ?? [], basePath: parsed.basePath ?? basePath };
      }
      const files = await readdir(basePath, { withFileTypes: true });
      const sorted = sortEntries(files);
      const watcherState = getWatcherState(server);
      const isIgnoredFn = watcherState.gitignoreFn ?? (await loadGitignoreRules(basePath));
      const results = await Promise.all(
        sorted.map(async (entry) => {
          if (entry.name === ".git") return null;
          const fullPath = join(basePath, entry.name);
          const isIgnored = isIgnoredFn(entry.name, entry.isDirectory());
          try {
            const s = await stat(fullPath);
            return {
              name: entry.name,
              path: fullPath,
              type: (entry.isDirectory() ? "directory" : "file") as "file" | "directory",
              size: s.size,
              isIgnored,
            };
          } catch (e) {
            log.debug("file.listDir: stat failed for entry", { fullPath, error: String(e) });
            return {
              name: entry.name,
              path: fullPath,
              type: "file" as "file" | "directory",
              isIgnored,
            };
          }
        }),
      );
      for (const r of results) {
        if (r) entries.push(r);
      }
    } catch (err) {
      log.error("listDir error", { error: err });
    }
    return { entries, basePath };
  });

  r("file.createFile", async (params) => {
    const dirTarget = await resolveFileTarget(params.dirPath);
    const filePath =
      dirTarget.kind === "ssh" ? remoteJoin(dirTarget.path, params.name) : join(dirTarget.path, params.name);
    if (dirTarget.kind === "ssh") {
      runSshCommand(dirTarget.remote, `: > ${shellQuote(filePath)}`);
      return { path: filePath };
    }
    await writeFile(filePath, "");
    return { path: filePath };
  });

  r("file.createDir", async (params) => {
    const parentTarget = await resolveFileTarget(params.dirPath);
    const dirPath =
      parentTarget.kind === "ssh"
        ? remoteJoin(parentTarget.path, params.name)
        : join(parentTarget.path, params.name);
    if (parentTarget.kind === "ssh") {
      runSshCommand(parentTarget.remote, `mkdir -p ${shellQuote(dirPath)}`);
      return { path: dirPath };
    }
    await mkdir(dirPath, { recursive: true });
    return { path: dirPath };
  });

  r("file.rename", async (params) => {
    const oldTarget = await resolveFileTarget(params.oldPath);
    const newPath =
      oldTarget.kind === "ssh"
        ? remoteJoin(remoteDirname(oldTarget.path), params.newName)
        : join(dirname(oldTarget.path), params.newName);
    if (oldTarget.kind === "ssh") {
      runSshCommand(oldTarget.remote, `mv -- ${shellQuote(oldTarget.path)} ${shellQuote(newPath)}`);
      return { newPath };
    }
    await rename(oldTarget.path, newPath);
    return { newPath };
  });

  r("file.delete", async (params) => {
    const target = await resolveFileTarget(params.path);
    if (target.kind === "ssh") {
      runSshCommand(target.remote, `rm -rf -- ${shellQuote(target.path)}`);
      return { ok: true };
    }
    await rm(target.path, { recursive: true, force: true });
    return { ok: true };
  });

  r("file.copy", async (params) => {
    const srcTarget = await resolveFileTarget(params.srcPath);
    const destTarget = await resolveFileTarget(params.destDir);
    const name = srcTarget.path.split("/").pop() ?? srcTarget.path;
    const destPath =
      destTarget.kind === "ssh" ? remoteJoin(destTarget.path, name) : join(destTarget.path, name);
    if (srcTarget.kind === "ssh" || destTarget.kind === "ssh") {
      if (srcTarget.kind !== "ssh" || destTarget.kind !== "ssh" || srcTarget.remote.id !== destTarget.remote.id) {
        throw new Error("Copy between local and remote projects is not supported here");
      }
      runSshCommand(srcTarget.remote, `cp -R -- ${shellQuote(srcTarget.path)} ${shellQuote(destPath)}`);
      return { path: destPath };
    }
    await cp(srcTarget.path, destPath, { recursive: true });
    return { path: destPath };
  });

  r("file.readFile", async (params) => {
    const target = await resolveFileTarget(params.path);
    if (target.kind === "ssh") {
      const result = runSshCommand(target.remote, `cat -- ${shellQuote(target.path)}`);
      return { content: result.stdout, size: Buffer.byteLength(result.stdout) };
    }
    const filePath = target.path;
    const content = await readFile(filePath);
    return { content: content.toString(), size: content.length };
  });

  r("file.readBinaryFile", async (params) => {
    const target = await resolveFileTarget(params.path);
    if (target.kind === "ssh") {
      const result = runSshCommand(target.remote, `base64 < ${shellQuote(target.path)} | tr -d '\\n'`);
      const base64 = result.stdout.trim();
      return {
        base64,
        size: Buffer.byteLength(base64, "base64"),
      };
    }
    const filePath = target.path;
    const content = await readFile(filePath);
    return { base64: content.toString("base64"), size: content.length };
  });

  r("file.writeFile", async (params) => {
    const target = await resolveFileTarget(params.path);
    const filePath = target.path;
    if (target.kind === "ssh") {
      runSshCommand(target.remote, `cat > ${shellQuote(filePath)}`, { stdin: params.content });
      log.info("Remote file written", { path: filePath, host: target.remote.host });
      return { ok: true };
    }
    log.info("File written", { path: filePath });
    await writeFile(filePath, params.content, "utf-8");
    return { ok: true };
  });

  r("file.editFile", async (params) => {
    const target = await resolveFileTarget(params.path);
    const filePath = target.path;
    const content =
      target.kind === "ssh"
        ? runSshCommand(target.remote, `cat -- ${shellQuote(filePath)}`).stdout
        : await readFile(filePath, "utf-8");

    let newContent = content;
    for (const edit of params.edits) {
      if (!newContent.includes(edit.oldText)) {
        log.error("Old text not found in file", { path: filePath, oldText: edit.oldText });
        continue;
      }
      newContent = newContent.replace(edit.oldText, edit.newText);
    }

    if (target.kind === "ssh") {
      runSshCommand(target.remote, `cat > ${shellQuote(filePath)}`, { stdin: newContent });
      log.info("Remote file edited", { path: filePath, editsCount: params.edits.length });
      return { ok: true };
    }
    await writeFile(filePath, newContent, "utf-8");
    log.info("File edited", { path: filePath, editsCount: params.edits.length });
    return { ok: true };
  });
}
