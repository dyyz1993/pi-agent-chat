#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const packages = [
  { name: "@dyyz1993/pi-coding-agent", version: "0.78.2" },
  // 0.78.1 is the latest npm tag, but that tarball currently lacks dist/index.js.
  { name: "@dyyz1993/pi-tui", version: "0.74.56" },
];

function packageYalcPath(name) {
  const [scope, pkg] = name.split("/");
  return join(process.cwd(), ".yalc", scope, pkg);
}

function getHydratedPackageVersion(pkg) {
  const packageJsonPath = join(packageYalcPath(pkg.name), "package.json");
  if (existsSync(packageJsonPath)) {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
    if (typeof packageJson.version === "string" && packageJson.version.length > 0) {
      return packageJson.version;
    }
  }
  return pkg.version;
}

function hydratePackage({ name, version }) {
  const target = packageYalcPath(name);
  if (existsSync(join(target, "package.json"))) {
    console.log(`[ci-hydrate-yalc] ${name} already exists at ${target}`);
    return;
  }

  const temp = mkdtempSync(join(tmpdir(), "pi-agent-chat-yalc-"));
  try {
    mkdirSync(dirname(target), { recursive: true });
    const spec = `${name}@${version}`;
    console.log(`[ci-hydrate-yalc] packing ${spec}`);
    const output = execFileSync("npm", ["pack", spec, "--pack-destination", temp], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    }).trim();
    const tarball = join(temp, output.split(/\r?\n/).at(-1) ?? "");
    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });
    execFileSync("tar", ["-xzf", tarball, "-C", target, "--strip-components=1"], {
      stdio: "inherit",
    });
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

function disablePostinstallInCi() {
  if (process.env.CI !== "true") {
    return;
  }

  const packageJsonPath = join(process.cwd(), "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  if (packageJson.scripts?.postinstall !== undefined) {
    packageJson.scripts.postinstall = "";
    writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
    console.log("[ci-hydrate-yalc] disabled package.json postinstall for CI install");
  }
}

function patchCodingAgentPackage(codingAgentPath) {
  const packageJsonPath = join(codingAgentPath, "package.json");
  if (!existsSync(packageJsonPath)) {
    return;
  }

  const tuiPackage = packages.find((pkg) => pkg.name === "@dyyz1993/pi-tui");
  if (!tuiPackage) {
    return;
  }
  const tuiVersion = getHydratedPackageVersion(tuiPackage);

  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8"));
  packageJson.dependencies ??= {};
  packageJson.dependencies["@dyyz1993/pi-tui"] = tuiVersion;
  writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);

  const shrinkwrapPath = join(codingAgentPath, "npm-shrinkwrap.json");
  if (existsSync(shrinkwrapPath)) {
    rmSync(shrinkwrapPath, { force: true });
  }
}

function pinCodingAgentTransitiveDependencies() {
  const codingAgentPath = packageYalcPath("@dyyz1993/pi-coding-agent");
  const tuiPackage = packages.find((pkg) => pkg.name === "@dyyz1993/pi-tui");
  if (!tuiPackage) {
    return;
  }
  const tuiVersion = getHydratedPackageVersion(tuiPackage);

  patchCodingAgentPackage(codingAgentPath);
  console.log(
    `[ci-hydrate-yalc] pinned @dyyz1993/pi-coding-agent -> @dyyz1993/pi-tui@${tuiVersion}`,
  );
}

function repairInstalledCodingAgentDependencies() {
  const installedCodingAgentPath = join(
    process.cwd(),
    "node_modules",
    "@dyyz1993",
    "pi-coding-agent",
  );
  if (!existsSync(join(installedCodingAgentPath, "package.json"))) {
    return;
  }

  const source = packageYalcPath("@dyyz1993/pi-tui");
  if (!existsSync(join(source, "dist", "index.js"))) {
    return;
  }

  patchCodingAgentPackage(installedCodingAgentPath);

  const target = join(installedCodingAgentPath, "node_modules", "@dyyz1993", "pi-tui");
  rmSync(target, { recursive: true, force: true });
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  console.log(`[ci-hydrate-yalc] repaired installed nested pi-tui at ${target}`);
}

disablePostinstallInCi();

for (const pkg of packages) {
  hydratePackage(pkg);
}

pinCodingAgentTransitiveDependencies();
repairInstalledCodingAgentDependencies();
