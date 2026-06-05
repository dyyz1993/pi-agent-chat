/**
 * Shared agent types and discovery logic.
 */
export type AgentScope = "user" | "project" | "both";
export type AgentColor = "red" | "blue" | "green" | "yellow" | "purple" | "orange";
export type MemoryScope = "user" | "project" | "local";
export type IsolationMode = "worktree" | "remote";
export interface AgentHookCommand {
    type: "command";
    command: string;
    if?: string;
    async?: boolean;
    once?: boolean;
    timeout?: number;
}
export interface AgentHookPrompt {
    type: "prompt";
    prompt: string;
    if?: string;
    once?: boolean;
}
export interface AgentHookHttp {
    type: "http";
    url: string;
    headers?: Record<string, string>;
    allowedEnvVars?: string[];
    if?: string;
    once?: boolean;
    timeout?: number;
}
export type AgentHook = AgentHookCommand | AgentHookPrompt | AgentHookHttp;
export interface AgentHookGroup {
    matcher?: string;
    hooks: AgentHook[];
}
export type AgentHookEntry = AgentHook | AgentHookGroup;
export type AgentHooks = Partial<Record<string, AgentHookEntry[]>>;
export interface PathConfig {
    write?: string[];
    read?: string[];
    bash?: string[];
}
export interface AgentConfig {
    name: string;
    description: string;
    tools?: string[];
    disallowedTools?: string[];
    model?: string;
    systemPrompt: string;
    source: AgentSource;
    filePath: string;
    permissionMode?: "auto" | "acceptEdits" | "dontAsk" | "always-allow" | "always-deny";
    maxTurns?: number;
    effort?: string;
    color?: AgentColor;
    background?: boolean;
    memory?: MemoryScope;
    isolation?: IsolationMode;
    initialPrompt?: string;
    skills?: string[];
    hooks?: AgentHooks;
    variables?: Record<string, string>;
    tier?: AgentTier;
    thinkingLevel?: string;
    mode?: AgentMode;
    hidden?: boolean;
    paths?: PathConfig;
}
export type AgentSource = "builtin" | "plugin" | "user" | "project" | "flag" | "policy";
export type AgentTier = "fast" | "pro" | "max";
export type AgentMode = "primary" | "subagent" | "all";
export interface AgentDiscoveryResult {
    agents: AgentConfig[];
    projectAgentsDir: string | null;
}
export declare function loadAgentsFromDir(dir: string, source: AgentSource): AgentConfig[];
export declare function mergeAgentsByPriority(...groups: AgentConfig[][]): AgentConfig[];
export declare function getBuiltinAgents(): AgentConfig[];
export declare function discoverAgents(cwd: string, scope: AgentScope, overrideAgents?: AgentConfig[]): AgentDiscoveryResult;
export declare function formatAgentList(agents: AgentConfig[], maxItems: number): {
    text: string;
    remaining: number;
};
//# sourceMappingURL=agent-types.d.ts.map