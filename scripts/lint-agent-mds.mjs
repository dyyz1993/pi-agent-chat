#!/usr/bin/env bun
/**
 * lint-agent-mds.mjs — Validate .md agent definition files against AgentConfig schema.
 *
 * Scans configured directories for *.md files, parses YAML frontmatter,
 * validates field names/types/enum values against the canonical AgentConfig
 * interface from pi-coding-agent/src/core/agent-types.ts.
 *
 * Usage:
 *   bun scripts/lint-agent-mds.mjs              # default: scan .opencode/agent/
 *   bun scripts/lint-agent-mds.mjs --fix         # dry-run info only (no fix mode yet)
 *   bun scripts/lint-agent-mds.mjs ./custom/path  # scan custom directory
 *
 * Exit codes:
 *   0 — all files valid (or only warnings)
 *   1 — one or more errors found
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve, relative } from "node:path";

// ─── Canonical schema (mirrors AgentConfig in agent-types.ts L62-87) ───

const STRING_FIELDS = new Set([
  "description", "model", "permissionMode", "effort", "color",
  "memory", "isolation", "initialPrompt", "tier", "thinkingLevel", "mode",
]);

const STRING_ARRAY_FIELDS = new Set(["tools", "disallowedTools", "skills"]);

const BOOLEAN_FIELDS = new Set(["background", "hidden"]);

const NUMBER_FIELDS = new Set(["maxTurns"]);

const OBJECT_FIELDS = new Set(["hooks", "variables", "paths", "permission"]); // permission is deprecated

/** Fields that exist in AgentConfig (union of all above + structural fields) */
const VALID_FIELDS = new Set([
  ...STRING_FIELDS,
  ...STRING_ARRAY_FIELDS,
  ...BOOLEAN_FIELDS,
  ...NUMBER_FIELDS,
  ...OBJECT_FIELDS,
  // Structural / always-present
  "name",
  "description",
]);

/** Enum constraints */
const ENUMS = {
  tier: ["fast", "pro", "max"],
  mode: ["primary", "subagent", "all"],
  permissionMode: [
    "normal", "yolo", "auto", "acceptEdits", "dontAsk",
    "always-allow", "always-deny",
  ],
  memory: ["user", "project", "local"],
};

/** Fields that are recommended but not required */
const RECOMMENDED_FIELDS = ["tier", "thinkingLevel", "effort", "tools"];

// ─── Frontmatter parser (regex-based, no deps) ───

function parseFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { frontmatter: {}, body: content };
  const raw = match[1];
  const fm = {};
  let currentKey = null;
  let currentVal = null;
  let inList = false;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    // Top-level key: value
    const kvMatch = trimmed.match(/^(\w[\w.-]*)\s*:\s*(.*)$/);
    if (kvMatch && !trimmed.startsWith(" ") && !trimmed.startsWith("-")) {
      // Flush previous key
      if (currentKey !== null) {
        fm[currentKey] = inList ? currentVal : currentVal;
      }
      currentKey = kvMatch[1];
      const v = kvMatch[2].trim();
      if (v === "" || v === "|" || v === ">") {
        // multiline scalar (not common in agent defs, skip for now)
        currentVal = "";
        inList = false;
      } else {
        currentVal = parseScalar(v);
        inList = false;
      }
      continue;
    }

    // List item under current key
    if (trimmed.startsWith("- ") && currentKey !== null) {
      if (!inList) {
        currentVal = [];
        inList = true;
      }
      currentVal.push(parseScalar(trimmed.slice(2)));
      continue;
    }

    // Nested object under current key (e.g., permission: \n  "*": allow)
    if ((trimmed.startsWith("*:") || /^[a-z]/i.test(trimmed)) && trimmed.includes(":") && currentKey !== null) {
      if (typeof currentVal !== "object" || Array.isArray(currentVal)) {
        currentVal = {};
      }
      const [nk, nv] = trimmed.split(":").map((s) => s.trim());
      currentVal[nk] = parseScalar(nv);
      inList = false; // switched to object mode
      continue;
    }
  }

  // Flush last key
  if (currentKey !== null) {
    fm[currentKey] = inList ? currentVal : currentVal;
  }

  return { frontmatter: fm };
}

function parseScalar(s) {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null" || s === "~" || s === "") return null;
  const n = Number(s);
  if (!Number.isNaN(n) && s !== "") return n;
  // Strip quotes
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// ─── Validator ───

let errorCount = 0;
let warnCount = 0;

function error(file, msg) {
  console.error(`  ❌ ERROR   ${msg}`);
  errorCount++;
}

function warn(file, msg) {
  console.warn(`  ⚠️  WARN    ${msg}`);
  warnCount++;
}

function info(msg) {
  console.log(`  ℹ️  ${msg}`);
}

function validateFile(filePath) {
  const rel = relative(process.cwd(), filePath);
  const issues = [];

  let content;
  try {
    content = readFileSync(filePath, "utf-8");
  } catch {
    error(rel, "Cannot read file");
    return issues;
  }

  const { frontmatter } = parseFrontmatter(content);
  const keys = Object.keys(frontmatter);

  // 1. Must have name + description
  if (!frontmatter.name) {
    error(rel, 'Missing required field "name"');
  }
  if (!frontmatter.description) {
    error(rel, 'Missing required field "description"');
  }

  // 2. Unknown fields
  for (const k of keys) {
    if (!VALID_FIELDS.has(k)) {
      warn(
        rel,
        `Unrecognized field "${k}". Valid fields: ${[...VALID_FIELDS].join(", ")}`,
      );
    }
  }

  // 3. Deprecated: permission map → permissionMode
  if (frontmatter.permission && !frontmatter.permissionMode) {
    error(
      rel,
      'Deprecated "permission" map format detected. Use "permissionMode" with a single string value (e.g. "always-allow")',
    );
  }

  // 4. Enum validation
  for (const [field, allowed] of Object.entries(ENUMS)) {
    const val = frontmatter[field];
    if (val !== undefined && val !== null && !allowed.includes(String(val))) {
      error(
        rel,
        `Invalid "${field}" value: "${val}". Expected one of: ${allowed.join(", ")}`,
      );
    }
  }

  // 5. Type validation
  for (const k of keys) {
    const val = frontmatter[k];
    if (val === undefined || val === null) continue;

    if (STRING_FIELDS.has(k) && typeof val !== "string") {
      error(rel, `Field "${k}" must be a string, got ${typeof val}`);
    }
    if (BOOLEAN_FIELDS.has(k) && typeof val !== "boolean") {
      error(rel, `Field "${k}" must be boolean (true/false), got ${JSON.stringify(val)}`);
    }
    if (NUMBER_FIELDS.has(k) && typeof val !== "number") {
      error(rel, `Field "${k}" must be a number, got ${typeof val} (${val})`);
    }
    if (STRING_ARRAY_FIELDS.has(k)) {
      if (!Array.isArray(val)) {
        error(rel, `Field "${k}" must be an array of strings, got ${typeof val}`);
      } else if (!val.every((item) => typeof item === "string")) {
        error(rel, `Field "${k}" array items must be strings`);
      }
    }
  }

  // 6. Recommended fields hint
  const missingRecommended = RECOMMENDED_FIELDS.filter((f) => !(f in frontmatter));
  if (missingRecommended.length > 0) {
    warn(
      rel,
      `Missing recommended field(s): ${missingRecommended.join(", ")}. These affect Agent panel display.`,
    );
  }

  return issues;
}

// ─── Scanner ───

function scanDir(dir) {
  const results = [];
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.name.endsWith(".md")) continue;
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      results.push(join(dir, entry.name));
    }
  } catch {
    // dir doesn't exist, skip silently
  }
  return results;
}

// ─── Main ───

const args = process.argv.slice(2);

// Default directories to scan
const DEFAULT_DIRS = [
  ".opencode/agent",
  // Add more paths here if agents are defined elsewhere, e.g.:
  // join(homedir(), ".pi/chat", "agents"),
];

const dirsToScan = args.length > 0 && !args[0].startsWith("--")
  ? args.map((d) => resolve(d))
  : DEFAULT_DIRS.map((d) => resolve(d));

console.log("\n🔍 Agent MD Frontmatter Validator\n");

let totalFiles = 0;
let validFiles = 0;

for (const dir of dirsToScan) {
  const files = scanDir(dir);
  if (files.length === 0) continue;

  console.log(`📁 ${relative(process.cwd(), dir)} (${files.length} file${files.length > 1 ? "s" : ""})\n`);

  for (const file of files) {
    totalFiles++;
    const fileName = file.split("/").pop();
    console.log(`  📄 ${fileName}`);

    const preErrors = errorCount;
    const preWarns = warnCount;
    validateFile(file);

    if (errorCount === preErrors && warnCount === preWarns) {
      validFiles++;
      info("All checks passed ✅");
    }
    console.log("");
  }
}

// ─── Summary ───

console.log("─".repeat(50));
console.log(
  `Results: ${totalFiles} file${totalFiles > 1 ? "s" : ""} scanned, ` +
  `${validFiles} valid, ${errorCount} error(s), ${warnCount} warning(s)\n`,
);

if (warnCount > 0) {
  console.log("💡 Tips:");
  console.log('   - Use "permissionMode" instead of "permission"');
  console.log('   - Add "tier" (fast|pro|max), "thinkingLevel", "effort", "tools" for full Agent panel display');
  console.log('   - Remove non-standard fields like "temperature"\n');
}

process.exit(errorCount > 0 ? 1 : 0);
