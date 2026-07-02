#!/usr/bin/env bun

import { resolve } from "node:path";
import { lintPersistencePaths } from "../tools/persistence-path-lint.ts";

const args = process.argv.slice(2);
let root = process.cwd();
let agentsPath;
let allowlistPath;
let format = "text";
const includeDirs = [];

for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--root") {
    root = resolve(args[++i]);
  } else if (arg === "--agents") {
    agentsPath = resolve(args[++i]);
  } else if (arg === "--allowlist") {
    allowlistPath = resolve(args[++i]);
  } else if (arg === "--format") {
    format = args[++i] ?? "text";
  } else if (arg === "--help" || arg === "-h") {
    printHelp();
    process.exit(0);
  } else {
    includeDirs.push(arg);
  }
}

const report = lintPersistencePaths({
  root,
  agentsPath,
  allowlistPath,
  includeDirs: includeDirs.length ? includeDirs : undefined,
});

if (format === "json") {
  console.log(
    JSON.stringify(
      {
        scannedFiles: report.scannedFiles,
        blockingFindings: report.blockingFindings,
        allowedFindings: report.allowedFindings,
        pathVariables: [...report.contract.pathVariables].sort(),
        registeredJsonFiles: [...report.contract.registeredJsonFiles].sort(),
      },
      null,
      2,
    ),
  );
} else {
  printTextReport(report);
}

process.exit(report.blockingFindings.length ? 1 : 0);

function printTextReport(report) {
  console.log(
    `Persistence path lint: scanned ${report.scannedFiles} files, ` +
      `${report.blockingFindings.length} blocking, ${report.allowedFindings.length} allowlisted.`,
  );

  if (report.blockingFindings.length) {
    console.log("\nBlocking findings:");
    for (const finding of report.blockingFindings) {
      printFinding(finding);
    }
  }

  if (report.allowedFindings.length) {
    console.log("\nAllowlisted legacy findings:");
    for (const finding of report.allowedFindings) {
      printFinding(finding, true);
    }
  }
}

function printFinding(finding, allowed = false) {
  const prefix = allowed ? "  - ALLOW" : "  - FAIL ";
  console.log(`${prefix} ${finding.ruleId} ${finding.file}:${finding.line}:${finding.column}`);
  console.log(`         ${finding.message}`);
  console.log(`         ${finding.excerpt}`);
  if (finding.allowlistReason) {
    console.log(`         reason: ${finding.allowlistReason}`);
  }
}

function printHelp() {
  console.log(`Usage: bun scripts/lint-persistence-paths.mjs [options] [includeDirs...]

Options:
  --root <dir>       Repository root. Defaults to cwd.
  --agents <file>    AGENTS.md path. Defaults to <root>/AGENTS.md.
  --allowlist <file> Allowlist JSON path. Defaults to tools/persistence-path-lint-allowlist.json.
  --format <text|json>

Examples:
  bun scripts/lint-persistence-paths.mjs
  bun scripts/lint-persistence-paths.mjs src tools --format json
`);
}
