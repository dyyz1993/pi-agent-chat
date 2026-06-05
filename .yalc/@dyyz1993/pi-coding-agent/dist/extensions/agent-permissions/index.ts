/**
 * Agent Permissions Extension
 *
 * Implements Claude Code-style permissionMode for sub-agents.
 * Works with AgentConfig.permissionMode to control tool access.
 *
 * Modes:
 *   auto         — default behavior, all tools allowed
 *   acceptEdits  — auto-allow edit/write, block dangerous bash
 *   dontAsk      — auto-allow everything (no blocking)
 *   always-allow — same as dontAsk
 *   always-deny  — block everything
 */

import type { AgentConfig, ExtensionContext, ToolCallEvent, ExtensionFactory } from "@dyyz1993/pi-coding-agent";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createPathPermissionHandler, type PathConfig } from "./path-checker.js";

const DANGEROUS_BASH_PATTERNS = [
  /\brm\s+-rf\b/,
  /\bgit\s+push\s+.*--force\b/,
  /--no-verify/,
  /\bsudo\b/,
  /\bchmod\s+777\b/,
  /\.env/,
  /credentials/i,
];

interface PermissionRule {
  mode: string;
  allowedTools: Set<string> | null;
  blockedTools: Set<string> | null;
  blockBashPatterns: RegExp[] | null;
}

const RULES: Record<string, PermissionRule> = {
  auto: {
    mode: "auto",
    allowedTools: null,
    blockedTools: null,
    blockBashPatterns: DANGEROUS_BASH_PATTERNS,
  },
  acceptEdits: {
    mode: "acceptEdits",
    allowedTools: null,
    blockedTools: null,
    blockBashPatterns: DANGEROUS_BASH_PATTERNS,
  },
  dontAsk: {
    mode: "dontAsk",
    allowedTools: null,
    blockedTools: null,
    blockBashPatterns: null,
  },
  "always-allow": {
    mode: "always-allow",
    allowedTools: null,
    blockedTools: null,
    blockBashPatterns: null,
  },
  "always-deny": {
    mode: "always-deny",
    allowedTools: new Set(),
    blockedTools: null,
    blockBashPatterns: null,
  },
};

interface AllowedRule {
  toolName: string;
  pattern?: string;
}

interface PermissionRulesFile {
  allowed: AllowedRule[];
}

function matchesToolPattern(toolName: string, input: Record<string, unknown>, pattern: string): boolean {
  const parenIdx = pattern.indexOf("(");
  if (parenIdx === -1) {
    if (pattern === "*") return true;
    if (pattern.startsWith("*") && pattern.endsWith("*")) {
      const middle = pattern.slice(1, -1);
      return toolName.includes(middle);
    }
    if (pattern.startsWith("*")) {
      const suffix = pattern.slice(1);
      return toolName.endsWith(suffix);
    }
    if (pattern.endsWith("*")) {
      const prefix = pattern.slice(0, -1);
      return toolName.startsWith(prefix);
    }
    return pattern === toolName;
  }

  const baseTool = pattern.substring(0, parenIdx).trim();
  if (baseTool !== toolName) return false;

  const globPattern = pattern.substring(parenIdx + 1, pattern.lastIndexOf(")")).trim();
  if (!globPattern || globPattern === "*") return true;

  const parts = globPattern.split("|");
  const inputStr = JSON.stringify(input);
  const command = typeof input.command === "string" ? input.command : "";
  const filePath = typeof input.filePath === "string" ? input.filePath : "";

  const targets = [command, filePath, inputStr].filter(Boolean);

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const startsWithWildcard = trimmed.startsWith("*");
    const endsWithWildcard = trimmed.endsWith("*");

    let regexStr = trimmed.replace(/[.+?^$()|\\]/g, "\\$&");
    regexStr = regexStr.replace(/\*/g, ".*");

    if (!startsWithWildcard) regexStr = "^" + regexStr;
    if (!endsWithWildcard) regexStr = regexStr + "$";

    const regex = new RegExp(regexStr);
    for (const target of targets) {
      if (regex.test(target)) return true;
    }
  }
  return false;
}

function matchesDisallowedTool(
  toolName: string,
  input: Record<string, unknown>,
  patterns: string[],
): boolean {
  for (const pattern of patterns) {
    if (matchesToolPattern(toolName, input, pattern)) {
      return true;
    }
  }
  return false;
}

function loadAlwaysAllowedRules(projectDataDir: string): AllowedRule[] {
  const filePath = join(projectDataDir, "permission-rules.json");
  try {
    const data = readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(data) as PermissionRulesFile;
    return Array.isArray(parsed.allowed) ? parsed.allowed : [];
  } catch {
    return [];
  }
}

function saveAlwaysAllowedRules(projectDataDir: string, rules: AllowedRule[]): void {
  const filePath = join(projectDataDir, "permission-rules.json");
  const data: PermissionRulesFile = { allowed: rules };
  writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

function isAlwaysAllowed(
  rules: AllowedRule[],
  toolName: string,
  input: Record<string, unknown>,
): boolean {
  for (const rule of rules) {
    if (rule.toolName === toolName) {
      if (!rule.pattern) return true;
      if (matchesToolPattern(toolName, input, rule.pattern)) return true;
    }
  }
  return false;
}

function addAlwaysAllowedRule(
  projectDataDir: string,
  rules: AllowedRule[],
  toolName: string,
  input: Record<string, unknown>,
  reason: string,
): void {
  const command = typeof input.command === "string" ? input.command : undefined;
  const filePath = typeof input.filePath === "string" ? input.filePath : undefined;

  let pattern: string | undefined;
  if (toolName === "bash" && command) {
    pattern = `bash(${command})`;
  } else if (filePath) {
    pattern = `${toolName}(${filePath})`;
  } else {
    pattern = undefined;
  }

  const existing = rules.find((r) => r.toolName === toolName && r.pattern === pattern);
  if (existing) return;

  rules.push({ toolName, pattern });
  saveAlwaysAllowedRules(projectDataDir, rules);
}

export function createPermissionHandler(agentConfig: AgentConfig) {
  const mode = agentConfig.permissionMode ?? "auto";
  const rule = RULES[mode];
  if (!rule) return null;

  const disallowedTools = agentConfig.disallowedTools ?? [];
  const allowedToolList = agentConfig.tools;

  return (event: { toolName: string; input: Record<string, unknown> }): { block: boolean; reason?: string } | null => {
    if (allowedToolList && allowedToolList.length > 0) {
      const isAllowed = allowedToolList.some((pattern) => matchesToolPattern(event.toolName, event.input, pattern));
      if (!isAllowed) {
        return {
          block: true,
          reason: `[agent:${agentConfig.name}] Tool "${event.toolName}" not in agent's tool whitelist. Allowed: ${allowedToolList.join(", ")}`,
        };
      }
    }

    if (rule.allowedTools !== null && !rule.allowedTools.has(event.toolName)) {
      const allowed = Array.from(rule.allowedTools).join(", ");
      return {
        block: true,
        reason: `[${mode} mode] Tool "${event.toolName}" not allowed. Allowed: ${allowed}`,
      };
    }

    if (rule.blockedTools !== null && rule.blockedTools.has(event.toolName)) {
      return {
        block: true,
        reason: `[${mode} mode] Tool "${event.toolName}" is blocked (read-only mode).`,
      };
    }

    if (event.toolName === "bash" && rule.blockBashPatterns) {
      const command = event.input?.command;
      if (typeof command === "string") {
        for (const pat of rule.blockBashPatterns) {
          if (pat.test(command)) {
            return {
              block: true,
              reason: `[${mode} mode] Blocked dangerous bash command: ${command}`,
            };
          }
        }
      }
    }

    if (disallowedTools.length > 0 && matchesDisallowedTool(event.toolName, event.input, disallowedTools)) {
      return {
        block: true,
        reason: `[agent:${agentConfig.name}] Tool "${event.toolName}" is explicitly disallowed.`,
      };
    }

    return null;
  };
}

async function askPermission(
  ctx: ExtensionContext,
  toolName: string,
  input: Record<string, unknown>,
  reason: string,
): Promise<{ allow: boolean; alwaysAllow: boolean }> {
  const command = typeof input.command === "string" ? input.command : undefined;
  const detail = command
    ? `Command: ${command}`
    : typeof input.filePath === "string"
      ? `File: ${input.filePath}`
      : "";

  const message = detail ? `${reason}\n\n${detail}` : reason;

  const choice = await ctx.ui.select(
    "Permission Request",
    ["Allow Once", "Always Allow"],
    {
      hookMeta: {
        toolName,
        matcher: toolName,
        command,
        reason,
      },
    },
  );

  if (choice === "Allow Once") return { allow: true, alwaysAllow: false };
  if (choice === "Always Allow") return { allow: true, alwaysAllow: true };
  return { allow: false, alwaysAllow: false };
}

const factory: ExtensionFactory = (pi) => {
  pi.on("tool_call", async (event: ToolCallEvent, ctx: ExtensionContext) => {
    const vars = (event as { variables?: Record<string, string> }).variables;
    const mode = vars?.["permissionMode"];
    const agentName = vars?.["agentName"] ?? "unknown";
    const allowedTools = vars?.["allowedTools"]?.split(",").filter(Boolean);
    const disallowedTools = vars?.["allowedTools"] !== undefined
      ? vars?.["disallowedTools"]?.split(",").filter(Boolean) ?? []
      : vars?.["disallowedTools"]?.split(",").filter(Boolean);

    const alwaysAllowed = loadAlwaysAllowedRules(ctx.projectDataDir);
    if (isAlwaysAllowed(alwaysAllowed, event.toolName, event.input)) {
      return undefined;
    }

    const pathsJson = vars?.["paths"];
    if (pathsJson) {
      try {
        const paths = JSON.parse(pathsJson) as PathConfig;
        const pathHandler = createPathPermissionHandler(paths);
        if (pathHandler) {
          const pathResult = pathHandler({ toolName: event.toolName, input: event.input });
          if (pathResult?.block) {
            if (!ctx.hasUI) return { block: true, reason: pathResult.reason };
            const decision = await askPermission(ctx, event.toolName, event.input, pathResult.reason);
            if (decision.allow) {
              if (decision.alwaysAllow) {
                addAlwaysAllowedRule(ctx.projectDataDir, alwaysAllowed, event.toolName, event.input, pathResult.reason);
              }
              return undefined;
            }
            return { block: true, reason: pathResult.reason };
          }
        }
      } catch {
        // If path parsing fails, continue with normal permission checks
      }
    }

    if (mode === "dontAsk" || mode === "always-allow") {
      return undefined;
    }

    if (!mode || mode === "auto") {
      if (event.toolName === "bash") {
        const command = event.input?.command;
        if (typeof command === "string") {
          for (const pat of DANGEROUS_BASH_PATTERNS) {
            if (pat.test(command)) {
              const reason = `[auto mode] Blocked dangerous bash command: ${command}`;
              if (!ctx.hasUI) return { block: true, reason };
              const decision = await askPermission(ctx, event.toolName, event.input, reason);
              if (decision.allow) {
                if (decision.alwaysAllow) {
                  addAlwaysAllowedRule(ctx.projectDataDir, alwaysAllowed, event.toolName, event.input, reason);
                }
                return undefined;
              }
              return { block: true, reason };
            }
          }
        }
      }
      if (allowedTools && allowedTools.length > 0) {
        const isAllowed = allowedTools.some((p) => matchesToolPattern(event.toolName, event.input, p));
        if (!isAllowed) {
          const reason = `[agent:${agentName}] Tool "${event.toolName}" not in agent's tool whitelist. Allowed: ${allowedTools.join(", ")}`;
          if (!ctx.hasUI) return { block: true, reason };
          const decision = await askPermission(ctx, event.toolName, event.input, reason);
          if (decision.allow) {
            if (decision.alwaysAllow) {
              addAlwaysAllowedRule(ctx.projectDataDir, alwaysAllowed, event.toolName, event.input, reason);
            }
            return undefined;
          }
          return { block: true, reason };
        }
      }
      if (disallowedTools && disallowedTools.length > 0 && matchesDisallowedTool(event.toolName, event.input, disallowedTools)) {
        const reason = `[agent:${agentName}] Tool "${event.toolName}" is explicitly disallowed.`;
        if (!ctx.hasUI) return { block: true, reason };
        const decision = await askPermission(ctx, event.toolName, event.input, reason);
        if (decision.allow) {
          if (decision.alwaysAllow) {
            addAlwaysAllowedRule(ctx.projectDataDir, alwaysAllowed, event.toolName, event.input, reason);
          }
          return undefined;
        }
        return { block: true, reason };
      }
      return undefined;
    }

    const handler = createPermissionHandler({
      name: agentName,
      description: "",
      permissionMode: mode as AgentConfig["permissionMode"],
      disallowedTools,
      tools: allowedTools,
    } as AgentConfig);

    if (!handler) return undefined;
    const result = handler({ toolName: event.toolName, input: event.input });
    if (result?.block) {
      if (!ctx.hasUI) return { block: true, reason: result.reason };
      const decision = await askPermission(ctx, event.toolName, event.input, result.reason ?? "Permission required");
      if (decision.allow) {
        if (decision.alwaysAllow) {
          addAlwaysAllowedRule(ctx.projectDataDir, alwaysAllowed, event.toolName, event.input, result.reason ?? "Permission required");
        }
        return undefined;
      }
      return { block: true, reason: result.reason };
    }
    return undefined;
  });
};
export default factory;
