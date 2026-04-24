import type { RPCServer } from "@dyyz1993/rpc-core";
import type { MethodParams, MethodResult } from "@dyyz1993/rpc-core";
import type { RPCMethods, HandlerOptions } from "../rpc-schema";
import { readdir, stat, writeFile, readFile, mkdir, rename, rm, cp } from "fs/promises";
import { existsSync } from "fs";
import { join, dirname, resolve } from "path";
import { createLogger } from "../lib/logger";

const log = createLogger("file");

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
    const entries: { name: string; path: string; type: "file" | "directory"; size?: number }[] = [];
    try {
      const files = await readdir(basePath);
      for (const name of files) {
        const fullPath = join(basePath, name);
        try {
          const s = await stat(fullPath);
          entries.push({
            name,
            path: fullPath,
            type: s.isDirectory() ? "directory" : "file",
            size: s.size,
          });
        } catch {
          entries.push({ name, path: fullPath, type: "file" });
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
