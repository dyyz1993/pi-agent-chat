/**
 * Shared agent types and discovery logic.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { getAgentDir } from "../config.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
const STRING_FIELDS = new Set([
    "description",
    "model",
    "permissionMode",
    "effort",
    "color",
    "memory",
    "isolation",
    "initialPrompt",
    "tier",
    "thinkingLevel",
    "mode",
]);
const STRING_ARRAY_FIELDS = new Set(["tools", "disallowedTools", "skills"]);
const BOOLEAN_FIELDS = new Set(["background", "hidden"]);
const NUMBER_FIELDS = new Set(["maxTurns"]);
function coerceField(key, raw) {
    if (raw === undefined || raw === null)
        return undefined;
    if (STRING_FIELDS.has(key))
        return typeof raw === "string" ? raw : String(raw);
    if (STRING_ARRAY_FIELDS.has(key)) {
        if (Array.isArray(raw))
            return raw.map(String);
        if (typeof raw === "string") {
            return raw
                .split(",")
                .map((entry) => entry.trim())
                .filter(Boolean);
        }
        return undefined;
    }
    if (BOOLEAN_FIELDS.has(key)) {
        if (typeof raw === "boolean")
            return raw;
        if (typeof raw === "string")
            return raw === "true" || raw === "yes";
        return undefined;
    }
    if (NUMBER_FIELDS.has(key)) {
        if (typeof raw === "number")
            return raw;
        if (typeof raw === "string") {
            const value = Number.parseInt(raw, 10);
            return Number.isFinite(value) ? value : undefined;
        }
        return undefined;
    }
    return raw;
}
function parseHookEntry(raw) {
    if (raw.type === "command" && typeof raw.command === "string") {
        return {
            type: "command",
            command: raw.command,
            if: typeof raw.if === "string" ? raw.if : undefined,
            async: raw.async === true,
            once: raw.once === true,
            timeout: typeof raw.timeout === "number" ? raw.timeout : undefined,
        };
    }
    if (raw.type === "prompt" && typeof raw.prompt === "string") {
        return {
            type: "prompt",
            prompt: raw.prompt,
            if: typeof raw.if === "string" ? raw.if : undefined,
            once: raw.once === true,
        };
    }
    if (raw.type === "http" && typeof raw.url === "string") {
        return {
            type: "http",
            url: raw.url,
            headers: isStringRecord(raw.headers) ? raw.headers : undefined,
            allowedEnvVars: Array.isArray(raw.allowedEnvVars) ? raw.allowedEnvVars.map(String) : undefined,
            if: typeof raw.if === "string" ? raw.if : undefined,
            once: raw.once === true,
            timeout: typeof raw.timeout === "number" ? raw.timeout : undefined,
        };
    }
    return undefined;
}
function isStringRecord(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return false;
    return Object.values(raw).every((value) => typeof value === "string");
}
function parseHooks(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return undefined;
    const hooks = {};
    for (const [event, handlers] of Object.entries(raw)) {
        if (!Array.isArray(handlers))
            continue;
        const parsed = [];
        for (const handler of handlers) {
            if (!handler || typeof handler !== "object" || Array.isArray(handler))
                continue;
            const obj = handler;
            if (Array.isArray(obj.hooks)) {
                const groupHooks = obj.hooks
                    .filter((entry) => Boolean(entry) && typeof entry === "object")
                    .map(parseHookEntry)
                    .filter((entry) => entry !== undefined && "type" in entry);
                if (groupHooks.length > 0) {
                    parsed.push({
                        matcher: typeof obj.matcher === "string" ? obj.matcher : undefined,
                        hooks: groupHooks,
                    });
                }
                continue;
            }
            const entry = parseHookEntry(obj);
            if (entry)
                parsed.push(entry);
        }
        if (parsed.length > 0)
            hooks[event] = parsed;
    }
    return Object.keys(hooks).length > 0 ? hooks : undefined;
}
function sanitizePatternArray(raw) {
    if (!Array.isArray(raw))
        return undefined;
    const patterns = raw.filter((value) => value != null && String(value).trim() !== "").map(String);
    return patterns.length > 0 ? patterns : undefined;
}
function parsePathConfig(raw) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return undefined;
    const obj = raw;
    const paths = {
        write: sanitizePatternArray(obj.write),
        read: sanitizePatternArray(obj.read),
        bash: sanitizePatternArray(obj.bash),
    };
    return paths.write || paths.read || paths.bash ? paths : undefined;
}
export function loadAgentsFromDir(dir, source) {
    if (!fs.existsSync(dir))
        return [];
    let entries;
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    }
    catch {
        return [];
    }
    const agents = [];
    for (const entry of entries) {
        if (!entry.name.endsWith(".md"))
            continue;
        if (!entry.isFile() && !entry.isSymbolicLink())
            continue;
        const filePath = path.join(dir, entry.name);
        let content;
        try {
            content = fs.readFileSync(filePath, "utf-8");
        }
        catch {
            continue;
        }
        const { frontmatter, body } = parseFrontmatter(content);
        if (!frontmatter.name || !frontmatter.description)
            continue;
        const tools = coerceField("tools", frontmatter.tools);
        const disallowedTools = coerceField("disallowedTools", frontmatter.disallowedTools);
        const skills = coerceField("skills", frontmatter.skills);
        const variables = isStringRecord(frontmatter.variables) ? frontmatter.variables : undefined;
        agents.push({
            name: coerceField("name", frontmatter.name),
            description: coerceField("description", frontmatter.description),
            tools: tools && tools.length > 0 ? tools : undefined,
            disallowedTools: disallowedTools && disallowedTools.length > 0 ? disallowedTools : undefined,
            model: coerceField("model", frontmatter.model),
            systemPrompt: body,
            source,
            filePath,
            permissionMode: coerceField("permissionMode", frontmatter.permissionMode),
            maxTurns: coerceField("maxTurns", frontmatter.maxTurns),
            effort: coerceField("effort", frontmatter.effort),
            color: coerceField("color", frontmatter.color),
            background: coerceField("background", frontmatter.background),
            memory: coerceField("memory", frontmatter.memory),
            isolation: coerceField("isolation", frontmatter.isolation),
            initialPrompt: coerceField("initialPrompt", frontmatter.initialPrompt),
            skills: skills && skills.length > 0 ? skills : undefined,
            hooks: parseHooks(frontmatter.hooks),
            variables,
            tier: coerceField("tier", frontmatter.tier),
            thinkingLevel: coerceField("thinkingLevel", frontmatter.thinkingLevel),
            mode: coerceField("mode", frontmatter.mode),
            hidden: coerceField("hidden", frontmatter.hidden),
            paths: parsePathConfig(frontmatter.paths),
        });
    }
    return agents;
}
function isDirectory(dir) {
    try {
        return fs.statSync(dir).isDirectory();
    }
    catch {
        return false;
    }
}
function findNearestProjectAgentsDir(cwd) {
    let currentDir = cwd;
    while (true) {
        const candidate = path.join(currentDir, ".pi", "agents");
        if (isDirectory(candidate))
            return candidate;
        const parentDir = path.dirname(currentDir);
        if (parentDir === currentDir)
            return null;
        currentDir = parentDir;
    }
}
export function mergeAgentsByPriority(...groups) {
    const agentMap = new Map();
    for (const group of groups) {
        for (const agent of group) {
            agentMap.set(agent.name, agent);
        }
    }
    return Array.from(agentMap.values());
}
export function getBuiltinAgents() {
    return [
        {
            name: "build",
            description: "Full-stack development with read, write, edit and execution capabilities",
            tools: ["read", "bash", "edit", "write"],
            systemPrompt: "",
            source: "builtin",
            filePath: "",
            mode: "primary",
        },
        {
            name: "explore",
            description: "Read-only exploration, search and read code",
            tools: ["read", "grep", "find", "ls", "bash"],
            disallowedTools: ["edit", "write"],
            systemPrompt: "You are a code exploration specialist. You can only read and search code, never modify any files.\n\nYour capabilities:\n- Use grep to search code content\n- Use find to discover files\n- Use read to read files\n- Use bash for read-only commands\n\nStrictly forbidden:\n- Do not modify any files\n- Do not run commands that change system state\n\nIf the user asks to modify code, refuse and suggest switching to the Build agent.",
            source: "builtin",
            filePath: "",
            mode: "primary",
            tier: "fast",
            color: "blue",
        },
        {
            name: "plan",
            description: "Planning mode, output analysis and specs only",
            tools: ["read", "grep", "find", "ls"],
            disallowedTools: ["edit", "write", "bash"],
            systemPrompt: "You are a planning specialist. You only output analysis reports and implementation plans. You cannot edit files.\n\nOutput format:\n### Requirements Analysis\n### Technical Solution\n### Implementation Steps\n### File Change List\n### Risks and Considerations",
            source: "builtin",
            filePath: "",
            mode: "primary",
            tier: "max",
            thinkingLevel: "high",
            color: "purple",
        },
    ];
}
export function discoverAgents(cwd, scope, overrideAgents) {
    const userDir = path.join(getAgentDir(), "agents");
    const projectAgentsDir = findNearestProjectAgentsDir(cwd);
    const userAgents = scope === "project" ? [] : loadAgentsFromDir(userDir, "user");
    const projectAgents = scope === "user" || !projectAgentsDir ? [] : loadAgentsFromDir(projectAgentsDir, "project");
    const flagAgents = overrideAgents ?? [];
    return {
        agents: mergeAgentsByPriority(getBuiltinAgents(), userAgents, projectAgents, flagAgents),
        projectAgentsDir,
    };
}
export function formatAgentList(agents, maxItems) {
    if (agents.length === 0)
        return { text: "none", remaining: 0 };
    const listed = agents.slice(0, maxItems);
    return {
        text: listed.map((agent) => `${agent.name} (${agent.source}): ${agent.description}`).join("; "),
        remaining: agents.length - listed.length,
    };
}
//# sourceMappingURL=agent-types.js.map