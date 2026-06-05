import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti/static";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extBase = path.resolve(__dirname, "extensions/claude-hooks-compat");
async function loadModules() {
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    const configLoader = (await jiti.import(path.join(extBase, "config-loader.ts")));
    const matcher = (await jiti.import(path.join(extBase, "matcher.ts")));
    const ifParser = (await jiti.import(path.join(extBase, "if-parser.ts")));
    return {
        loadConfigs: configLoader.loadConfigs,
        loadConfigSources: configLoader.loadConfigSources,
        matchesMatcher: matcher.matchesMatcher,
        matchesIfClause: ifParser.matchesIfClause,
    };
}
export async function handleHooksCommand(args) {
    if (args[0] !== "hooks")
        return false;
    const subcommand = args[1] ?? "list";
    const projectDir = process.cwd();
    if (!fs.existsSync(path.join(extBase, "config-loader.ts"))) {
        console.error("Error: hooks extension not found.");
        return true;
    }
    const mods = await loadModules();
    switch (subcommand) {
        case "list":
            return cmdList(projectDir, mods);
        case "test":
            return cmdTest(projectDir, args, mods);
        case "sources":
            return cmdSources(projectDir, mods);
        case "help":
        case "--help":
        case "-h":
            printHooksHelp();
            return true;
        default:
            console.error(`Unknown subcommand: ${subcommand}`);
            console.error("Run 'pi hooks help' for usage.");
            return true;
    }
}
function cmdList(projectDir, mods) {
    const configs = mods.loadConfigs(projectDir);
    const sources = mods.loadConfigSources(projectDir);
    if (configs.size === 0) {
        console.log("No hooks configured.");
        return true;
    }
    console.log(`\nHooks configuration (project: ${projectDir})\n`);
    console.log("Sources:");
    for (const src of sources) {
        const status = src.disabled ? "⛔ disabled" : src.exists ? "✅ loaded" : "⚪ not found";
        console.log(`  ${status}  ${src.scope.padEnd(8)} ${src.path}`);
    }
    console.log();
    for (const [event, groups] of configs) {
        console.log(`── ${event} ──`);
        for (const group of groups) {
            const matcherLabel = group.matcher ?? "*";
            const sourceLabel = group.__source__ ?? "unknown";
            console.log(`  [${sourceLabel}] matcher: ${matcherLabel}`);
            for (const hook of group.hooks) {
                const ifLabel = hook.if ? ` if="${hook.if}"` : "";
                const cmd = hook.command ?? hook.url ?? hook.prompt ?? "(no command)";
                const truncated = cmd.length > 80 ? `${cmd.slice(0, 77)}...` : cmd;
                console.log(`    → ${hook.type}${ifLabel}: ${truncated}`);
            }
        }
        console.log();
    }
    return true;
}
function cmdTest(projectDir, args, mods) {
    let toolName = "";
    let toolInput = {};
    for (let i = 2; i < args.length; i++) {
        if (args[i] === "--tool" && args[i + 1]) {
            toolName = args[i + 1];
            i++;
        }
        else if (args[i] === "--input" && args[i + 1]) {
            try {
                toolInput = JSON.parse(args[i + 1]);
            }
            catch {
                console.error(`Error: Invalid JSON in --input: ${args[i + 1]}`);
                return true;
            }
            i++;
        }
        else if (args[i] === "--command" && args[i + 1]) {
            toolName = "Bash";
            toolInput = { command: args[i + 1] };
            i++;
        }
    }
    if (!toolName) {
        console.error("Error: --tool is required. Usage: pi hooks test --tool Bash --command 'rm -rf /'");
        return true;
    }
    const configs = mods.loadConfigs(projectDir);
    console.log(`\nTesting: tool=${toolName} input=${JSON.stringify(toolInput)}\n`);
    let anyMatch = false;
    for (const [event, groups] of configs) {
        for (const group of groups) {
            if (!mods.matchesMatcher(group.matcher, toolName))
                continue;
            for (const hook of group.hooks) {
                const ifMatches = mods.matchesIfClause(hook.if, toolName, toolInput);
                if (ifMatches) {
                    anyMatch = true;
                    const sourceLabel = group.__source__ ?? "unknown";
                    const ifLabel = hook.if ? ` (if: ${hook.if})` : "";
                    console.log(`  ✅ MATCH  [${event}] matcher="${group.matcher ?? "*"}"${ifLabel}`);
                    console.log(`           → ${hook.type}: ${(hook.command ?? hook.url ?? hook.prompt ?? "").slice(0, 100)}`);
                    if (hook.if) {
                        console.log(`           if clause: ${hook.if} → matches tool input`);
                    }
                    console.log();
                }
            }
        }
    }
    if (!anyMatch) {
        console.log("  ❌ No hooks match this tool call.");
    }
    return true;
}
function cmdSources(projectDir, mods) {
    const sources = mods.loadConfigSources(projectDir);
    console.log(`\nHook config sources (project: ${projectDir})\n`);
    console.log("  Scope     Status       Path");
    console.log("  ────────  ───────────  ─────────────────────────────────────");
    for (const src of sources) {
        const status = src.disabled ? "disabled  ⛔" : src.exists ? "loaded    ✅" : "not found ⚪";
        console.log(`  ${src.scope.padEnd(10)}${status.padEnd(14)}${src.path}`);
    }
    return true;
}
function printHooksHelp() {
    console.log(`
Usage: pi hooks <subcommand> [options]

Subcommands:
  list                      Show all active hook rules and their sources
  sources                   Show config file status (loaded/disabled/missing)
  test                      Test which hooks match a given tool call

Test options:
  --tool <name>             Tool name to test (e.g., Bash, Edit, Write)
  --input '<json>'          Tool input as JSON (e.g., '{"command":"rm -rf /"}')
  --command '<cmd>'         Shortcut for --tool Bash --input '{"command":"<cmd>"}'

Examples:
  pi hooks list
  pi hooks sources
  pi hooks test --tool Bash --command 'rm -rf node_modules'
  pi hooks test --tool Bash --command 'git push --force'
  pi hooks test --tool Edit --input '{"file_path":"/etc/hosts"}'
  pi hooks test --tool Write --input '{"file_path":"./.env","content":"SECRET=xxx"}'
`);
}
//# sourceMappingURL=hooks-cli.js.map