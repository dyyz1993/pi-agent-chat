import { cpSync, existsSync, mkdirSync, realpathSync, rmSync } from "fs";
import * as path from "path";

import { createLogger } from "../lib/logger";

const log = createLogger("agent");

export type RuntimePackageRepairStatus =
  | "already-present"
  | "not-local-node-modules"
  | "package-root-missing"
  | "source-missing"
  | "repaired";

function resolveCodingAgentPackageRoot(cliPath: string): string | null {
  const resolvedCliPath = existsSync(cliPath) ? realpathSync(cliPath) : cliPath;
  const packageRoot = path.resolve(resolvedCliPath, "..", "..");
  return existsSync(path.join(packageRoot, "package.json")) ? packageRoot : null;
}

function resolveAppRootForNodeModulesPackage(packageRoot: string): string | null {
  const marker = `${path.sep}node_modules${path.sep}@dyyz1993${path.sep}pi-coding-agent`;
  if (!packageRoot.endsWith(marker)) return null;
  return path.resolve(packageRoot, "..", "..", "..");
}

function findPiTuiSource(appRoot: string): string | null {
  const candidates = [
    path.join(appRoot, ".yalc", "@dyyz1993", "pi-tui"),
    path.join(appRoot, "node_modules", "@dyyz1993", "pi-tui"),
  ];

  return (
    candidates.find((candidate) => existsSync(path.join(candidate, "dist", "index.js"))) ?? null
  );
}

export function ensureLocalCodingAgentRuntimeDependencies(
  cliPath: string,
): RuntimePackageRepairStatus {
  const packageRoot = resolveCodingAgentPackageRoot(cliPath);
  if (!packageRoot) return "package-root-missing";

  const appRoot = resolveAppRootForNodeModulesPackage(packageRoot);
  if (!appRoot) return "not-local-node-modules";

  const target = path.join(packageRoot, "node_modules", "@dyyz1993", "pi-tui");
  if (existsSync(path.join(target, "dist", "index.js"))) return "already-present";

  const source = findPiTuiSource(appRoot);
  if (!source) {
    log.warn("Missing nested @dyyz1993/pi-tui and no local source is available", {
      appRoot,
      cliPath,
      packageRoot,
      target,
    });
    return "source-missing";
  }

  rmSync(target, { recursive: true, force: true });
  mkdirSync(path.dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  log.info("Repaired nested @dyyz1993/pi-tui for local pi-coding-agent runtime", {
    packageRoot,
    source,
    target,
  });
  return "repaired";
}
