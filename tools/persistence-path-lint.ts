import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";

export type PersistenceRuleId =
  | "hardcoded-pi-agent-root"
  | "hardcoded-pi-chat-root"
  | "hardcoded-agents-dir"
  | "hardcoded-project-pi-dir"
  | "undocumented-json-path";

export interface PersistenceFinding {
  ruleId: PersistenceRuleId;
  file: string;
  line: number;
  column: number;
  message: string;
  excerpt: string;
  allowed?: boolean;
  allowlistReason?: string;
}

export interface PersistenceAllowlistEntry {
  ruleId: PersistenceRuleId;
  file: string;
  excerptIncludes?: string;
  reason: string;
}

export interface PersistenceContract {
  pathVariables: Set<string>;
  registeredJsonFiles: Set<string>;
}

export interface PersistenceLintOptions {
  root: string;
  agentsPath?: string;
  allowlistPath?: string;
  includeDirs?: string[];
}

export interface PersistenceLintReport {
  contract: PersistenceContract;
  findings: PersistenceFinding[];
  blockingFindings: PersistenceFinding[];
  allowedFindings: PersistenceFinding[];
  scannedFiles: number;
}

const DEFAULT_INCLUDE_DIRS = ["src"];
const SCANNED_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const EXCLUDED_SEGMENTS = new Set(["node_modules", ".yalc", ".git", "dist", "build", "coverage"]);

const SCANNER_SELF_PATHS = new Set([
  "tools/persistence-path-lint.ts",
  "scripts/lint-persistence-paths.mjs",
]);

const CANONICAL_HELPER_FILES = new Set(["src/shared/lib/pi-agent-paths.ts"]);

const NON_PERSISTENCE_JSON_FILES = new Set(["package.json", "tsconfig.json"]);

export function extractPersistenceContract(agentsMarkdown: string): PersistenceContract {
  const persistenceSection = sliceBetween(
    agentsMarkdown,
    "### 持久化路径变量",
    "### Extension 存储 API 现状",
  );
  const registrySection = sliceBetween(agentsMarkdown, "### 写入路径注册表", "写入规则：");
  const relevantText = `${persistenceSection}\n${registrySection}`;

  const pathVariables = new Set<string>();
  for (const match of relevantText.matchAll(/<([A-Z][A-Z0-9_]+)>/g)) {
    pathVariables.add(match[1]);
  }

  const registeredJsonFiles = new Set<string>();
  for (const match of relevantText.matchAll(/`([^`]*?\.json[^`]*)`/g)) {
    for (const fileName of extractJsonFileNames(match[1])) {
      registeredJsonFiles.add(fileName);
    }
  }

  return { pathVariables, registeredJsonFiles };
}

export function loadAllowlist(path: string): PersistenceAllowlistEntry[] {
  if (!existsSync(path)) return [];
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    entries?: PersistenceAllowlistEntry[];
  };
  return parsed.entries ?? [];
}

export function lintPersistencePaths(options: PersistenceLintOptions): PersistenceLintReport {
  const root = resolve(options.root);
  const agentsPath = options.agentsPath ?? join(root, "AGENTS.md");
  const allowlistPath =
    options.allowlistPath ?? join(root, "tools", "persistence-path-lint-allowlist.json");
  const contract = extractPersistenceContract(readFileSync(agentsPath, "utf8"));
  const allowlist = loadAllowlist(allowlistPath);
  const files = collectFiles(root, options.includeDirs ?? DEFAULT_INCLUDE_DIRS);
  const findings = files.flatMap((file) => scanFile(root, file, contract));

  for (const finding of findings) {
    const allowed = allowlist.find((entry) => matchesAllowlist(entry, finding));
    if (allowed) {
      finding.allowed = true;
      finding.allowlistReason = allowed.reason;
    }
  }

  return {
    contract,
    findings,
    blockingFindings: findings.filter((finding) => !finding.allowed),
    allowedFindings: findings.filter((finding) => finding.allowed),
    scannedFiles: files.length,
  };
}

function sliceBetween(content: string, startMarker: string, endMarker: string): string {
  const start = content.indexOf(startMarker);
  if (start < 0) return "";
  const end = content.indexOf(endMarker, start + startMarker.length);
  return content.slice(start, end < 0 ? undefined : end);
}

function extractJsonFileNames(text: string): string[] {
  const results: string[] = [];
  for (const match of text.matchAll(/([A-Za-z0-9._-]+\.json)/g)) {
    results.push(match[1]);
  }
  return results;
}

function collectFiles(root: string, includeDirs: string[]): string[] {
  const files: string[] = [];
  for (const includeDir of includeDirs) {
    const absolute = resolve(root, includeDir);
    if (!existsSync(absolute)) continue;
    walk(root, absolute, files);
  }
  return files.sort();
}

function walk(root: string, current: string, files: string[]): void {
  const stat = statSync(current);
  const rel = toPosix(relative(root, current));
  if (rel.split("/").some((segment) => EXCLUDED_SEGMENTS.has(segment))) return;
  if (stat.isDirectory()) {
    for (const entry of readdirSync(current)) {
      walk(root, join(current, entry), files);
    }
    return;
  }
  if (!stat.isFile()) return;
  if (SCANNER_SELF_PATHS.has(rel)) return;
  if (!SCANNED_EXTENSIONS.has(extname(current))) return;
  files.push(current);
}

function scanFile(root: string, file: string, contract: PersistenceContract): PersistenceFinding[] {
  const rel = toPosix(relative(root, file));
  const findings: PersistenceFinding[] = [];
  const lines = readFileSync(file, "utf8").split(/\r?\n/);

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trim();
    if (
      !trimmed ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("*") ||
      trimmed.startsWith("/**")
    ) {
      return;
    }

    if (!CANONICAL_HELPER_FILES.has(rel)) {
      addPatternFinding({
        findings,
        ruleId: "hardcoded-pi-agent-root",
        file: rel,
        line: lineNumber,
        lineText: line,
        pattern:
          /(?:~\/\.pi\/agent|\/root\/\.pi\/agent|\.pi\/agent|["'`]\.pi["'`]\s*,\s*["'`]agent["'`])/,
        message:
          "Hardcoded pi agent root detected. Use <PI_AGENT_DIR> helpers such as getPiAgentDir().",
      });
    }

    addPatternFinding({
      findings,
      ruleId: "hardcoded-pi-chat-root",
      file: rel,
      line: lineNumber,
      lineText: line,
      pattern: /(?:~\/\.pi\/chat|\.pi\/chat|["'`]\.pi["'`]\s*,\s*["'`]chat["'`])/,
      message:
        "Hardcoded pi chat config root detected. Use <PI_APP_CONFIG_DIR> / project-config helpers.",
    });

    addPatternFinding({
      findings,
      ruleId: "hardcoded-agents-dir",
      file: rel,
      line: lineNumber,
      lineText: line,
      pattern: /(?:~\/\.agents|["'`]\.agents["'`]|\/\.agents(?=[/\\}"'`]|$))/,
      message:
        "Hardcoded ~/.agents path detected. Register the path contract or route through a helper.",
    });

    if (
      /\b(?:join|resolve)\s*\(/.test(line) &&
      /\bprojectRoot\b/.test(line) &&
      /["'`]\.pi["'`]/.test(line)
    ) {
      findings.push({
        ruleId: "hardcoded-project-pi-dir",
        file: rel,
        line: lineNumber,
        column: Math.max(1, line.indexOf(".pi") + 1),
        message:
          "Hardcoded project .pi directory detected. Use <PROJECT_SHARED_DIR> helper/contract.",
        excerpt: trimmed,
      });
    }

    for (const jsonName of findJsonStringLiterals(line)) {
      if (NON_PERSISTENCE_JSON_FILES.has(jsonName)) continue;
      if (contract.registeredJsonFiles.has(jsonName)) continue;
      if (!looksLikePathOrPersistenceLine(trimmed)) continue;
      findings.push({
        ruleId: "undocumented-json-path",
        file: rel,
        line: lineNumber,
        column: Math.max(1, line.indexOf(jsonName) + 1),
        message: `JSON persistence path "${jsonName}" is not registered in AGENTS.md.`,
        excerpt: trimmed,
      });
    }
  });

  return findings;
}

function addPatternFinding(args: {
  findings: PersistenceFinding[];
  ruleId: PersistenceRuleId;
  file: string;
  line: number;
  lineText: string;
  pattern: RegExp;
  message: string;
}): void {
  const match = args.pattern.exec(args.lineText);
  if (!match) return;
  args.findings.push({
    ruleId: args.ruleId,
    file: args.file,
    line: args.line,
    column: match.index + 1,
    message: args.message,
    excerpt: args.lineText.trim(),
  });
}

function findJsonStringLiterals(line: string): string[] {
  if (/^\s*import\s/.test(line)) return [];
  const results: string[] = [];
  const pattern = /["'`]([^"'`]*?([A-Za-z0-9._-]+\.json)[^"'`]*)["'`]/g;
  for (const match of line.matchAll(pattern)) {
    const fileNames = extractJsonFileNames(match[1]);
    results.push(...fileNames);
  }
  return results;
}

function looksLikePathOrPersistenceLine(trimmed: string): boolean {
  return /\b(join|resolve|safeJoin|readJson|writeJson|readFile|writeFile|existsSync|mkdir|CONFIG_FILENAME|configFilePath|Path)\b/.test(
    trimmed,
  );
}

function matchesAllowlist(entry: PersistenceAllowlistEntry, finding: PersistenceFinding): boolean {
  if (entry.ruleId !== finding.ruleId) return false;
  if (toPosix(entry.file) !== finding.file) return false;
  if (entry.excerptIncludes && !finding.excerpt.includes(entry.excerptIncludes)) return false;
  return true;
}

function toPosix(path: string): string {
  return path.replace(/\\/g, "/");
}
