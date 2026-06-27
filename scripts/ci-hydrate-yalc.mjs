#!/usr/bin/env node
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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

disablePostinstallInCi();

for (const pkg of packages) {
  hydratePackage(pkg);
}
