/**
 * RPC Client for programmatic access to the coding agent.
 *
 * Spawns the agent in RPC mode and provides a typed API for all operations.
 */
import type { AgentEvent, AgentMessage, ThinkingLevel } from "@dyyz1993/pi-agent-core";
import type { ImageContent } from "@dyyz1993/pi-ai";
import type { SessionStats } from "../../core/agent-session.ts";
import type { AgentConfig } from "../../core/agent-types.ts";
import type { BashResult } from "../../core/bash-executor.ts";
import type { CompactionResult } from "../../core/compaction/index.ts";
import type { Channel } from "../../core/extensions/channel-types.ts";
import type { Settings } from "../../core/settings-manager.ts";
import type { RpcAgentMessage, RpcAgentSummary, RpcAllTool, RpcContextUsage, RpcExtension, RpcExtensionFlag, RpcMcpServer, RpcSessionState, RpcSkill, RpcSlashCommand, RpcTool, TreeEntry } from "./rpc-types.ts";
export interface RpcClientOptions {
    /** Path to the CLI entry point (default: searches for dist/cli.js) */
    cliPath?: string;
    /** Working directory for the agent */
    cwd?: string;
    /** Environment variables */
    env?: Record<string, string>;
    /** Provider to use */
    provider?: string;
    /** Model ID to use */
    model?: string;
    /** Additional CLI arguments */
    args?: string[];
}
export interface ModelInfo {
    provider: string;
    id: string;
    contextWindow: number;
    reasoning: boolean;
}
export type RpcEventListener = (event: AgentEvent) => void;
export interface TreeWithLeaf {
    entries: TreeEntry[];
    leafId: string | null;
}
export interface RollbackPreviewResult {
    restored: string[];
    deleted: string[];
    skipped: string[];
    dirty: string[];
    forceRestored: string[];
}
export interface ModifiedFilesResult {
    files: Array<{
        path: string;
        status: "added" | "modified" | "deleted";
        turnIndex: number;
        entryId: string;
    }>;
    resolvedFromEntryId: string | null;
}
export interface FileDiffResult {
    path: string;
    oldContent: string | null;
    newContent: string | null;
    unifiedDiff: string;
}
export interface BatchDiffResult {
    files: Array<{
        path: string;
        status: "added" | "modified" | "deleted";
        diff: FileDiffResult | null;
    }>;
    summary: {
        totalFiles: number;
        added: number;
        modified: number;
        deleted: number;
    };
}
export interface FileHistoryResult {
    history: Array<{
        entryId: string;
        turnIndex: number;
        timestamp: string;
        status: "added" | "modified" | "deleted";
        snapshotHash: string;
        previousHash: string | null;
    }>;
}
export declare class RpcClient {
    private process;
    private stopReadingStdout;
    private eventListeners;
    private pendingRequests;
    private channelHandlers;
    private readyResolve;
    private readyReject;
    private requestId;
    private stderr;
    private exitError;
    private options;
    constructor(options?: RpcClientOptions);
    /**
     * Start the RPC agent process.
     */
    start(): Promise<void>;
    /**
     * Stop the RPC agent process.
     */
    stop(): Promise<void>;
    /**
     * Subscribe to agent events.
     */
    onEvent(listener: RpcEventListener): () => void;
    /**
     * Get collected stderr output (useful for debugging).
     */
    getStderr(): string;
    /**
     * Send a prompt to the agent.
     * Returns immediately after sending; use onEvent() to receive streaming events.
     * Use waitForIdle() to wait for completion.
     */
    prompt(message: string, images?: ImageContent[]): Promise<void>;
    /**
     * Queue a steering message to interrupt the agent mid-run.
     */
    steer(message: string, images?: ImageContent[]): Promise<void>;
    /**
     * Queue a follow-up message to be processed after the agent finishes.
     */
    followUp(message: string, images?: ImageContent[]): Promise<void>;
    /**
     * Abort current operation.
     */
    abort(): Promise<void>;
    /**
     * Start a new session, optionally with parent tracking.
     * @param parentSession - Optional parent session path for lineage tracking
     * @returns Object with `cancelled: true` if an extension cancelled the new session
     */
    newSession(parentSession?: string): Promise<{
        cancelled: boolean;
    }>;
    /**
     * Get current session state.
     */
    getState(): Promise<RpcSessionState>;
    /**
     * Set model by provider and ID.
     */
    setModel(provider: string, modelId: string): Promise<{
        provider: string;
        id: string;
    }>;
    /**
     * Cycle to next model.
     */
    cycleModel(): Promise<{
        model: {
            provider: string;
            id: string;
        };
        thinkingLevel: ThinkingLevel;
        isScoped: boolean;
    } | null>;
    /**
     * Get list of available models.
     */
    getAvailableModels(): Promise<ModelInfo[]>;
    getTierModels(): Promise<Record<string, string>>;
    setTierModels(models: {
        fast?: string;
        pro?: string;
        max?: string;
    }): Promise<void>;
    /**
     * Set thinking level.
     */
    setThinkingLevel(level: ThinkingLevel): Promise<void>;
    /**
     * Cycle thinking level.
     */
    cycleThinkingLevel(): Promise<{
        level: ThinkingLevel;
    } | null>;
    /**
     * Set steering mode.
     */
    setSteeringMode(mode: "all" | "one-at-a-time"): Promise<void>;
    /**
     * Set follow-up mode.
     */
    setFollowUpMode(mode: "all" | "one-at-a-time"): Promise<void>;
    /**
     * Compact session context.
     */
    compact(customInstructions?: string): Promise<CompactionResult>;
    /**
     * Set auto-compaction enabled/disabled.
     */
    setAutoCompaction(enabled: boolean): Promise<void>;
    /**
     * Set auto-retry enabled/disabled.
     */
    setAutoRetry(enabled: boolean): Promise<void>;
    /**
     * Abort in-progress retry.
     */
    abortRetry(): Promise<void>;
    /**
     * Execute a bash command.
     */
    bash(command: string): Promise<BashResult>;
    /**
     * Abort running bash command.
     */
    abortBash(): Promise<void>;
    /**
     * Get session statistics.
     */
    getSessionStats(): Promise<SessionStats>;
    /**
     * Export session to HTML.
     */
    exportHtml(outputPath?: string): Promise<{
        path: string;
    }>;
    /**
     * Switch to a different session file.
     * @returns Object with `cancelled: true` if an extension cancelled the switch
     */
    switchSession(sessionPath: string): Promise<{
        cancelled: boolean;
    }>;
    /**
     * Fork from a specific message.
     * @returns Object with `text` (the message text) and `cancelled` (if extension cancelled)
     */
    fork(entryId: string, options?: {
        position?: "before" | "at";
    }): Promise<{
        text: string;
        cancelled: boolean;
    }>;
    navigateTree(targetId: string, options?: {
        summarize?: boolean;
        customInstructions?: string;
        replaceInstructions?: boolean;
        label?: string;
        skipFiles?: boolean;
    }): Promise<{
        cancelled: boolean;
        editorText?: string;
        newLeafId: string | null;
        reason?: string;
    }>;
    previewRollback(targetId: string): Promise<RollbackPreviewResult>;
    deleteEntries(targetIds: string[]): Promise<{
        entryId: string;
    }>;
    summarizeEntries(targetIds: string[], options?: {
        summary?: string;
        model?: string;
    }): Promise<{
        entryId: string;
    }>;
    /**
     * Clone the current active branch into a new session.
     * @returns Object with `cancelled: true` if an extension cancelled the clone
     */
    clone(): Promise<{
        cancelled: boolean;
    }>;
    /**
     * Get messages available for forking.
     */
    getForkMessages(): Promise<Array<{
        entryId: string;
        text: string;
    }>>;
    /**
     * Get text of last assistant message.
     */
    getLastAssistantText(): Promise<string | null>;
    /**
     * Set the session display name.
     */
    setSessionName(name: string): Promise<void>;
    /**
     * Get all messages in the session.
     */
    getMessages(): Promise<AgentMessage[]>;
    getFullMessages(options?: {
        afterEntryId?: string;
        limit?: number;
    }): Promise<{
        messages: RpcAgentMessage[];
        hasMore: boolean;
        totalCount: number;
        nextCursor: string | null;
        tree: {
            entries: TreeEntry[];
            leafId: string | null;
        };
        customEntries: Array<{
            id: string;
            customType: string;
            data: unknown;
            timestamp: number;
        }>;
        compactionEntries: Array<{
            id: string;
            summary: string;
            tokensBefore: number | undefined;
            timestamp: number;
        }>;
    }>;
    getTree(): Promise<{
        entries: TreeEntry[];
    }>;
    getTreeWithLeaf(): Promise<TreeWithLeaf>;
    getModifiedFiles(options?: {
        fromEntryId?: string;
        toEntryId?: string;
        toTurnIndex?: number;
        fromTurnIndex?: number;
        toUserMsgEntryId?: string;
    }): Promise<ModifiedFilesResult>;
    getFileDiff(options: {
        filePath: string;
        fromEntryId?: string;
        toEntryId?: string;
        useBaselineHash?: boolean;
    }): Promise<FileDiffResult | null>;
    getBatchDiffs(options?: {
        fromEntryId?: string;
        toEntryId?: string;
    }): Promise<BatchDiffResult>;
    getFileHistory(options: {
        filePath: string;
    }): Promise<FileHistoryResult>;
    /**
     * Get available commands (extension commands, prompt templates, skills).
     */
    getCommands(): Promise<RpcSlashCommand[]>;
    getSkills(): Promise<RpcSkill[]>;
    getExtensions(): Promise<RpcExtension[]>;
    getTools(): Promise<RpcTool[]>;
    getSettings(scope?: "global" | "project"): Promise<Settings>;
    setSettings(settings: Partial<Settings>, scope?: "global" | "project"): Promise<void>;
    getContextUsage(): Promise<RpcContextUsage>;
    getSystemPrompt(): Promise<{
        systemPrompt: string;
        appendSystemPrompt: string[];
    }>;
    getActiveTools(): Promise<string[]>;
    setActiveTools(toolNames: string[]): Promise<void>;
    getQueue(): Promise<{
        steering: string[];
        followUp: string[];
    }>;
    clearQueue(): Promise<{
        steering: string[];
        followUp: string[];
    }>;
    getFlags(): Promise<RpcExtensionFlag[]>;
    getFlagValues(): Promise<Record<string, boolean | string>>;
    setFlag(name: string, value: boolean | string): Promise<void>;
    reload(): Promise<void>;
    setCwd(cwd: string): Promise<{
        cancelled: boolean;
    }>;
    getAgentsFiles(): Promise<Array<{
        path: string;
        content: string;
    }>>;
    getAgents(): Promise<RpcAgentSummary[]>;
    switchAgent(agentName: string): Promise<{
        agentName: string;
        tools: string[];
        tier?: string;
        thinkingLevel?: string;
    }>;
    getCurrentAgent(): Promise<{
        agentName: string;
    }>;
    getLatestAgentChange(): Promise<{
        agentName: string;
        agentConfig?: unknown;
        timestamp: string;
    } | null>;
    getAgentDetail(agentName: string): Promise<AgentConfig>;
    getAllTools(): Promise<RpcAllTool[]>;
    setPermissionMode(mode: "auto" | "acceptEdits" | "dontAsk" | "always-allow" | "always-deny"): Promise<{
        mode: "auto" | "acceptEdits" | "dontAsk" | "always-allow" | "always-deny";
    }>;
    /**
     * Wait for agent to become idle (no streaming).
     * Resolves when agent_end event is received.
     */
    waitForIdle(timeout?: number): Promise<void>;
    /**
     * Collect events until agent becomes idle.
     */
    collectEvents(timeout?: number): Promise<AgentEvent[]>;
    /**
     * Send prompt and wait for completion, returning all events.
     */
    promptAndWait(message: string, images?: ImageContent[], timeout?: number): Promise<AgentEvent[]>;
    channel(name: string): Pick<Channel, "name" | "send" | "onReceive" | "invoke" | "call">;
    private handleLine;
    private createProcessExitError;
    private waitForReady;
    private resolveReady;
    private rejectReady;
    private rejectPendingRequests;
    private send;
    private writeLine;
    private getData;
    /**
     * Respond to a pending extension UI request.
     * Sends an extension_ui_response message to the CLI process.
     * First response wins; subsequent calls are silently ignored by the agent.
     */
    respondUI(requestId: string, response: Record<string, unknown>): void;
    getMcpServers(): Promise<RpcMcpServer[]>;
    toggleMcpServer(name: string, enabled: boolean): Promise<void>;
    restartMcpServer(name: string): Promise<void>;
    onRemoteToolCall(handler: (call: {
        toolCallId: string;
        toolName: string;
        args: Record<string, unknown>;
    }) => void): () => void;
    sendRemoteToolResult(toolCallId: string, result: {
        content: Array<{
            type: string;
            text: string;
        }>;
        isError: boolean;
    }): void;
}
//# sourceMappingURL=rpc-client.d.ts.map