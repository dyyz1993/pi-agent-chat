import type { RPCServer } from "@dyyz1993/rpc-core";
import type { Dirent } from "fs";
import type { MethodParams, MethodResult } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import { readdir, stat, writeFile, readFile, mkdir, rename, rm, cp } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { createLogger } from "../lib/logger";

const log = createLogger("file");

function parseGitignore(content: string): ((path: string, isDir: boolean) => boolean) {
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
      const regexStr = "^" + pattern.replace(/\./g, "\\.").replace(/\*/g, ".*").replace(/\?/g, ".") + "$";
      try {
        if (new RegExp(regexStr, "i").test(relativePath)) return !isNegated;
      } catch { /* skip invalid regex */ }
    }
    return false;
  };
}

async function loadGitignoreRules(dirPath: string): Promise<(path: string, isDir: boolean) => boolean> {
  const gitignorePath = join(dirPath, ".gitignore");
  if (existsSync(gitignorePath)) {
    try {
      const content = await readFile(gitignorePath, "utf-8");
      return parseGitignore(content);
    } catch { /* ignore */ }
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

type RegisterFn = <K extends keyof RPCMethods & string>(
  method: K,
  handler: (params: MethodParams<RPCMethods, K>) => Promise<MethodResult<RPCMethods, K>>,
) => void;

export function register(server: RPCServer, _options: HandlerOptions): void {
  const r: RegisterFn = (method, handler) => {
    server.register(method, handler as (params: unknown) => Promise<unknown>);
  };

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
    const basePath = resolve(params.path || process.cwd());
    const entries: { name: string; path: string; type: "file" | "directory"; size?: number; isIgnored?: boolean }[] = [];
    try {
      const files = await readdir(basePath, { withFileTypes: true });
      const sorted = sortEntries(files);
      const isIgnoredFn = await loadGitignoreRules(basePath);
      for (const entry of sorted) {
        if (entry.name === ".git") continue;
        const fullPath = join(basePath, entry.name);
        const relFromBase = entry.name;
        const isIgnored = isIgnoredFn(relFromBase, entry.isDirectory());
        try {
          const s = await stat(fullPath);
          entries.push({
            name: entry.name,
            path: fullPath,
            type: entry.isDirectory() ? "directory" : "file",
            size: s.size,
            isIgnored,
          });
        } catch {
          entries.push({ name: entry.name, path: fullPath, type: "file", isIgnored });
        }
      }
    } catch (err) {
      log.error("listDir error", { error: err });
    }
    return { entries, basePath };
  });

  r("file.createFile", async (params) => {
    const filePath = join(params.dirPath, params.name);
    await writeFile(filePath, "");
    return { path: filePath };
  });

  r("file.createDir", async (params) => {
    const dirPath = join(params.dirPath, params.name);
    await mkdir(dirPath, { recursive: true });
    return { path: dirPath };
  });

  r("file.rename", async (params) => {
    const newPath = join(dirname(params.oldPath), params.newName);
    await rename(params.oldPath, newPath);
    return { newPath };
  });

  r("file.delete", async (params) => {
    await rm(params.path, { recursive: true, force: true });
    return { ok: true };
  });

  r("file.copy", async (params) => {
    const { srcPath, destDir } = params;
    const name = srcPath.split("/").pop() || srcPath;
    const destPath = join(destDir, name);
    await cp(srcPath, destPath, { recursive: true });
    return { path: destPath };
  });

  r("file.readFile", async (params) => {
    const filePath = resolve(params.path);
    const content = await readFile(filePath);
    return { content: content.toString(), size: content.length };
  });
}
