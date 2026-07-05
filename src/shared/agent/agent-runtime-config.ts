import { existsSync, readdirSync, realpathSync, statSync } from "fs";
import * as path from "path";

import { config } from "../../server-config";
import { createLogger } from "../lib/logger";

const log = createLogger("agent");

export const TIER_KEYS = ["fast", "pro", "max"] as const;
export type TierKey = (typeof TIER_KEYS)[number];

function isTruthyEnv(value: string | undefined): boolean {
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

export const BUILTIN_INTERNAL_EXTENSION_NAMES = new Set(
  isTruthyEnv(process.env.PI_DISABLE_MULTI_COMPACTION) ? [] : ["_multi-compaction"],
);

interface ScanExtensionDirOptions {
  allowPrivateEntries?: ReadonlySet<string>;
}

/**
 * Scan an extensions directory and collect each loadable extension entry.
 *
 * Layout: each subdirectory with an index.ts/js, or each .ts/.js file,
 * is treated as an extension. Symlinks are resolved.
 */
export function scanExtensionDir(
  dir: string,
  extensionPaths: string[],
  options: ScanExtensionDirOptions = {},
): void {
  if (!existsSync(dir)) return;

  try {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const isPrivateEntry = entry.name.startsWith("_");
      if (
        entry.name.startsWith(".") ||
        (isPrivateEntry && !options.allowPrivateEntries?.has(entry.name)) ||
        entry.name === "node_modules" ||
        entry.name === "__tests__"
      )
        continue;

      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(path.join(dir, entry.name));
          isDir = stats.isDirectory();
          isFile = stats.isFile();
        } catch (error) {
          log.debug("scanExtensions: skipping symlink target", {
            name: entry.name,
            error: String(error),
          });
          continue;
        }
      }

      const fullPath = path.join(dir, entry.name);
      if (isDir) {
        const indexTs = path.join(fullPath, "index.ts");
        const indexJs = path.join(fullPath, "index.js");
        if (existsSync(indexTs)) {
          extensionPaths.push(indexTs);
        } else if (existsSync(indexJs)) {
          extensionPaths.push(indexJs);
        }
      } else if (isFile && (entry.name.endsWith(".ts") || entry.name.endsWith(".js"))) {
        extensionPaths.push(fullPath);
      }
    }
  } catch (err: unknown) {
    log.warn("Failed to scan extensions directory", {
      dir,
      err: err instanceof Error ? err.message : String(err),
    });
  }
}

function extensionDirForPackageRoot(pkgDir: string): string {
  const srcDir = path.join(pkgDir, "src", "extensions");
  if (existsSync(srcDir)) return srcDir;
  return path.join(pkgDir, "dist", "extensions");
}

export function getBuiltinExtensionsDirForCliPath(cliPath: string): string {
  const resolvedCliPath = existsSync(cliPath) ? realpathSync(cliPath) : cliPath;
  const packageRootFromCli = path.resolve(resolvedCliPath, "..", "..");
  const legacyPackageRoot = path.join(
    path.resolve(resolvedCliPath, "..", ".."),
    "@dyyz1993",
    "pi-coding-agent",
  );

  for (const pkgDir of [packageRootFromCli, legacyPackageRoot]) {
    const extDir = extensionDirForPackageRoot(pkgDir);
    if (existsSync(extDir)) return extDir;
  }

  return extensionDirForPackageRoot(packageRootFromCli);
}

export function getBuiltinExtensionsDir(): string {
  return getBuiltinExtensionsDirForCliPath(config.piCliPath);
}

export function discoverExtensionArgs(options?: { includeUser?: boolean }): string[] {
  const extensionPaths: string[] = [];
  const includeUser = options?.includeUser ?? true;

  const userExtDir = config.piExtensionsDir;
  if (includeUser && existsSync(userExtDir)) {
    scanExtensionDir(userExtDir, extensionPaths);
  } else if (includeUser) {
    log.warn("Global extensions directory not found", { extDir: userExtDir });
  }

  const builtinExtDir = getBuiltinExtensionsDir();
  if (existsSync(builtinExtDir)) {
    scanExtensionDir(builtinExtDir, extensionPaths, {
      allowPrivateEntries: BUILTIN_INTERNAL_EXTENSION_NAMES,
    });
  }

  log.info("Discovered extensions", {
    userDir: userExtDir,
    builtinDir: builtinExtDir,
    count: extensionPaths.length,
  });
  for (const p of extensionPaths) {
    log.info("  -> extension:", { path: p });
  }
  return extensionPaths.flatMap((p) => ["--extension", p]);
}

export function parseTierModel(
  tier: TierKey,
  modelName: string | undefined,
): {
  provider: string;
  modelId: string;
} {
  if (!modelName) {
    throw new Error(`Tier "${tier}" is not configured`);
  }

  const [provider, ...modelParts] = modelName.split("/");
  const modelId = modelParts.join("/");
  if (!provider || !modelId) {
    throw new Error(`Invalid tier model mapping: ${tier} -> ${modelName}`);
  }

  return { provider, modelId };
}
