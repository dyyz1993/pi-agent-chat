#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const packageJsonPath = path.resolve(process.cwd(), "package.json");
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
const fallbacks = packageJson.piAgentChat?.ciYalcFallbacks ?? {};
const ciDependencyOverrides = packageJson.piAgentChat?.ciDependencyOverrides ?? {};
const dependencySections = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
];

const changed = [];
const isCi = process.env.CI === "true";

if (isCi && packageJson.scripts?.postinstall) {
  packageJson.scripts.postinstall = "";
  changed.push("postinstall: disabled for CI");
}

if (isCi && Object.keys(ciDependencyOverrides).length > 0) {
  packageJson.overrides = {
    ...(packageJson.overrides ?? {}),
    ...ciDependencyOverrides,
  };
  for (const [name, version] of Object.entries(ciDependencyOverrides)) {
    changed.push(`override: ${name} -> ${version}`);
  }
}

for (const section of dependencySections) {
  const dependencies = packageJson[section];
  if (!dependencies) continue;

  for (const [name, specifier] of Object.entries(dependencies)) {
    if (typeof specifier !== "string" || !specifier.startsWith("file:.yalc/")) {
      continue;
    }

    const localPackageJson = path.resolve(process.cwd(), specifier.slice("file:".length), "package.json");
    if (fs.existsSync(localPackageJson)) {
      continue;
    }

    const fallback = fallbacks[name];
    if (!fallback) {
      throw new Error(
        `Missing CI fallback for ${name}. Add it to package.json piAgentChat.ciYalcFallbacks.`,
      );
    }

    dependencies[name] = fallback;
    changed.push(`${name}: ${specifier} -> ${fallback}`);
  }
}

if (changed.length === 0) {
  console.log("CI dependency preparation: local yalc packages are present; no changes needed.");
  process.exit(0);
}

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log("CI dependency preparation: updated package metadata:");
for (const entry of changed) {
  console.log(`- ${entry}`);
}
