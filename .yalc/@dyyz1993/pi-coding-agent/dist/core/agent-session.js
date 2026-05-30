/**
 * AgentSession - Core abstraction for agent lifecycle and session management.
 *
 * This class is shared between all run modes (interactive, print, rpc).
 * It encapsulates:
 * - Agent state access
 * - Event subscription with automatic session persistence
 * - Model and thinking level management
 * - Compaction (manual and auto)
 * - Bash execution
 * - Session switching and branching
 *
 * Modes use this class and add their own I/O layer on top.
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { Agent, } from "@dyyz1993/pi-agent-core";
import { clampThinkingLevel, cleanupSessionResources, complete, getSupportedThinkingLevels, isContextOverflow, modelsAreEqual, resetApiProviders, } from "@dyyz1993/pi-ai";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import { getAgentDir } from "../config.js";
import { theme } from "../modes/interactive/theme/theme.js";
import { stripFrontmatter } from "../utils/frontmatter.js";
import { sleep } from "../utils/sleep.js";
import { isRetryableError, withRetry } from "../utils/with-retry.js";
import { formatNoApiKeyFoundMessage, formatNoModelSelectedMessage } from "./auth-guidance.js";
import { executeBashWithOperations } from "./bash-executor.js";
import { calculateContextTokens, collectEntriesForBranchSummary, compact, estimateContextTokens, generateBranchSummary, prepareCompaction, shouldCompact, } from "./compaction/index.js";
import { DEFAULT_THINKING_LEVEL } from "./defaults.js";
import { exportSessionToHtml } from "./export-html/index.js";
import { createToolHtmlRenderer } from "./export-html/tool-renderer.js";
import { ExtensionRunner, wrapRegisteredTools, } from "./extensions/index.js";
import { emitSessionShutdownEvent } from "./extensions/runner.js";
import { FileSnapshotManager } from "./file-store/file-snapshot-manager.js";
import { InternalGit } from "./file-store/internal-git.js";
import { McpManager } from "./mcp/mcp-manager.js";
import { createMcpToolDefinition } from "./mcp/tool-converter.js";
import { resolveModelAlias } from "./model-resolver.js";
import { expandPromptTemplate } from "./prompt-templates.js";
import { CURRENT_SESSION_VERSION, getLatestCompactionEntry } from "./session-manager.js";
import { createSyntheticSourceInfo } from "./source-info.js";
import { getCwdDataDir, getGlobalDataDir, getProjectDataDir, getSessionDataDir, resolveProjectIdentity, } from "./storage.js";
import { buildSystemPrompt } from "./system-prompt.js";
import { createLocalBashOperations } from "./tools/bash.js";
import { createAllToolDefinitions, createTool, toolsOptionsFromProvider } from "./tools/index.js";
import { stripMarkdownCodeBlock } from "./tools/strip-markdown.js";
import { createToolDefinitionFromAgentTool } from "./tools/tool-definition-wrapper.js";
/**
 * Parse a skill block from message text.
 * Returns null if the text doesn't contain a skill block.
 */
export function parseSkillBlock(text) {
    const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n([\s\S]*?)\n<\/skill>(?:\n\n([\s\S]+))?$/);
    if (!match)
        return null;
    return {
        name: match[1],
        location: match[2],
        content: match[3],
        userMessage: match[4]?.trim() || undefined,
    };
}
// ============================================================================
// Constants
// ============================================================================
/** Standard thinking levels */
const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high"];
// Helper function to wrap tools with path checking for forkAgent
async function wrapToolWithPathChecking(tool, paths) {
    const { minimatch } = await import("minimatch");
    const normalizeFilePath = (filePath) => {
        let normalized = filePath;
        if (normalized.startsWith("file://")) {
            normalized = normalized.slice("file://".length);
        }
        const parts = normalized.split("/");
        const resolved = [];
        for (const part of parts) {
            if (part === "..") {
                if (resolved.length > 0 && resolved[resolved.length - 1] !== "") {
                    resolved.pop();
                }
            }
            else if (part !== "." && part !== "") {
                resolved.push(part);
            }
            else if (part === "" && resolved.length === 0) {
                resolved.push("");
            }
        }
        if (normalized.startsWith("/")) {
            return `/${resolved.filter((p) => p !== "").join("/")}`;
        }
        return resolved.join("/") || ".";
    };
    const matchPathGlob = (filePath, pattern) => {
        if (pattern === "**")
            return true;
        const normalized = normalizeFilePath(filePath);
        const parts = normalized.split("/");
        for (let i = 0; i < parts.length; i++) {
            const subpath = parts.slice(i).join("/");
            if (minimatch(subpath, pattern, { dot: true })) {
                return true;
            }
        }
        return false;
    };
    const matchesAnyPattern = (filePath, patterns) => {
        if (!patterns)
            return false;
        for (const pattern of patterns) {
            if (matchPathGlob(filePath, pattern)) {
                return true;
            }
        }
        return false;
    };
    return {
        ...tool,
        async execute(args, signal) {
            const toolName = tool.name;
            // Check write paths
            if (paths.write &&
                (toolName === "edit" || toolName === "write" || toolName === "multiedit" || toolName === "patch")) {
                const rawPath = args.file_path ?? args.filePath ?? args.path;
                if (rawPath) {
                    const normalized = normalizeFilePath(rawPath);
                    if (!matchesAnyPattern(normalized, paths.write)) {
                        throw new Error(`Path ${normalized} is not in the allowed write paths: ${paths.write.join(", ")}`);
                    }
                }
            }
            // Check read paths
            if (paths.read && toolName === "read") {
                const rawPath = args.file_path ?? args.filePath ?? args.path;
                if (rawPath) {
                    const normalized = normalizeFilePath(rawPath);
                    if (!matchesAnyPattern(normalized, paths.read)) {
                        throw new Error(`Path ${normalized} is not in the allowed read paths: ${paths.read.join(", ")}`);
                    }
                }
            }
            // Execute original tool
            return tool.execute(args, signal);
        },
    };
}
// ============================================================================
// AgentSession Class
// ============================================================================
export class AgentSession {
    agent;
    sessionManager;
    settingsManager;
    _scopedModels;
    // Event subscription state
    _unsubscribeAgent;
    _eventListeners = [];
    _agentEventQueue = Promise.resolve();
    /** Tracks pending steering messages for UI display. Removed when delivered. */
    _steeringMessages = [];
    /** Tracks pending follow-up messages for UI display. Removed when delivered. */
    _followUpMessages = [];
    /** Messages queued to be included with the next user prompt as context ("asides"). */
    _pendingNextTurnMessages = [];
    // Compaction state
    _compactionAbortController = undefined;
    _autoCompactionAbortController = undefined;
    _overflowRecoveryAttempted = false;
    _overflowRecoveryLevel = 0;
    // Branch summarization state
    _branchSummaryAbortController = undefined;
    // Retry state
    _retryAbortController = undefined;
    _retryAttempt = 0;
    _retryPromise = undefined;
    _retryResolve = undefined;
    // Bash execution state
    _bashAbortController = undefined;
    _pendingBashMessages = [];
    // Extension system
    _extensionRunner;
    _turnIndex = 0;
    _maxTurns = undefined;
    _effort = undefined;
    _activeSkillNames = undefined;
    _resourceLoader;
    _customTools;
    _baseToolDefinitions = new Map();
    _cwd;
    _extensionRunnerRef;
    _initialActiveToolNames;
    _allowedToolNames;
    _baseToolsOverride;
    _sessionStartEvent;
    _extensionUIContext;
    _extensionCommandContextActions;
    _extensionShutdownHandler;
    _extensionErrorListener;
    _extensionErrorUnsubscriber;
    _registerChannel;
    _sessionAbortController = new AbortController();
    _backgroundTasks = new Set();
    // Model registry for API key resolution
    _modelRegistry;
    _fileSnapshotManager = null;
    _mcpManager;
    _mcpToolDefinitions = new Map();
    _mcpServerScopes = new Map();
    _noMcp;
    _toolOperationsProvider;
    _currentAgentName = "build";
    _currentAgentVariables = {};
    _toolCallVariablesOverride;
    /** Read-only access to current agent variables (for session lifecycle events). */
    get currentAgentVariables() {
        return this._currentAgentVariables;
    }
    /** Set variables for tool_call event propagation (used by tests) */
    set toolCallVariables(vars) {
        this._toolCallVariablesOverride = vars;
    }
    /** Get the effective variables to emit on tool_call/tool_result events */
    get _effectiveToolCallVariables() {
        return this._toolCallVariablesOverride ?? (Object.keys(this._currentAgentVariables).length > 0 ? this._currentAgentVariables : undefined);
    }
    _tierModels = {};
    // Tool registry for extension getTools/setTools
    _toolRegistry = new Map();
    _toolDefinitions = new Map();
    _toolPromptSnippets = new Map();
    _toolPromptGuidelines = new Map();
    // Base system prompt (without extension appends) - used to apply fresh appends each turn
    _baseSystemPrompt = "";
    _baseSystemPromptOptions;
    constructor(config) {
        this.agent = config.agent;
        this.sessionManager = config.sessionManager;
        this.settingsManager = config.settingsManager;
        this._tierModels = this.settingsManager.getTierModels();
        this._scopedModels = config.scopedModels ?? [];
        this._resourceLoader = config.resourceLoader;
        this._customTools = config.customTools ?? [];
        this._cwd = config.cwd;
        this._modelRegistry = config.modelRegistry;
        this._extensionRunnerRef = config.extensionRunnerRef;
        this._initialActiveToolNames = config.initialActiveToolNames;
        this._allowedToolNames = config.allowedToolNames ? new Set(config.allowedToolNames) : undefined;
        this._baseToolsOverride = config.baseToolsOverride;
        this._sessionStartEvent = config.sessionStartEvent ?? { type: "session_start", reason: "startup" };
        this._noMcp = config.noMcp ?? false;
        this._toolOperationsProvider = config.toolOperationsProvider;
        // Always subscribe to agent events for internal handling
        // (session persistence, extensions, auto-compaction, retry logic)
        this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
        this._installAgentToolHooks();
        this._buildRuntime({
            activeToolNames: this._initialActiveToolNames,
            includeAllExtensionTools: true,
        });
    }
    /** Model registry for API key resolution and model discovery */
    get modelRegistry() {
        return this._modelRegistry;
    }
    get fileSnapshotManager() {
        return this._fileSnapshotManager;
    }
    set toolOperationsProvider(provider) {
        this._toolOperationsProvider = provider;
        this._rebuildBaseToolDefinitions();
        this._refreshToolRegistry();
    }
    get toolOperationsProvider() {
        return this._toolOperationsProvider;
    }
    _rebuildBaseToolDefinitions() {
        const autoResizeImages = this.settingsManager.getImageAutoResize();
        const shellCommandPrefix = this.settingsManager.getShellCommandPrefix();
        const shellPath = this.settingsManager.getShellPath();
        const providerOptions = this._toolOperationsProvider
            ? toolsOptionsFromProvider(this._toolOperationsProvider)
            : {};
        const baseToolDefinitions = createAllToolDefinitions(this._cwd, {
            read: { autoResizeImages, ...providerOptions.read },
            bash: { commandPrefix: shellCommandPrefix, shellPath, ...providerOptions.bash },
            write: providerOptions.write,
            edit: providerOptions.edit,
            grep: providerOptions.grep,
            find: providerOptions.find,
            ls: providerOptions.ls,
        });
        this._baseToolDefinitions = new Map(Object.entries(baseToolDefinitions).map(([name, tool]) => [name, tool]));
    }
    _initFileSnapshotManager() {
        try {
            const storeRoot = join(getAgentDir(), "file-store");
            const cwd = this._cwd;
            const git = InternalGit.createForProject(storeRoot, cwd);
            this._fileSnapshotManager = new FileSnapshotManager(git);
            // Rebuild snapshot index from current branch entries so getModifiedFiles
            // can filter by turn even for historical turns. Only snapshots on the path
            // from leafId to root are kept — rolled-back branch snapshots are excluded.
            const entries = this.sessionManager.getEntries();
            const leafId = this.sessionManager.getLeafId();
            this._fileSnapshotManager.rebuildIndex(entries, leafId);
            this._extensionRunner.setFileSnapshotManager(this._fileSnapshotManager);
        }
        catch (err) {
            console.warn("[initFileSnapshotManager] failed, file snapshots disabled:", err instanceof Error ? err.message : String(err));
            this._fileSnapshotManager = null;
            this._extensionRunner.setFileSnapshotManager(null);
        }
    }
    _initMcpServers() {
        if (this._noMcp)
            return;
        if (this._mcpManager) {
            this._mcpManager.dispose().catch(() => { });
            this._mcpManager = undefined;
        }
        this._mcpServerScopes.clear();
        const globalServers = this.settingsManager.getMcpServers("global");
        const projectServers = this.settingsManager.getMcpServers("project");
        const settings = this.settingsManager.getMergedSettings();
        const servers = settings?.mcp?.servers;
        if (!servers || Object.keys(servers).length === 0)
            return;
        for (const name of Object.keys(servers)) {
            this._mcpServerScopes.set(name, projectServers[name] ? "project" : "global");
        }
        this._mcpManager = new McpManager({
            onConnectionChange: (conn) => {
                this._emit({
                    type: "mcp_connection_change",
                    name: conn.name,
                    status: conn.status,
                    error: conn.error,
                    tools: conn.tools.map((t) => ({
                        originalName: t.originalName,
                        fullName: t.fullName,
                        description: t.description,
                    })),
                });
                if (conn.status === "connected" && this._mcpManager) {
                    this._mcpToolDefinitions.clear();
                    const allTools = this._mcpManager.getAllTools();
                    for (const tool of allTools) {
                        this._mcpToolDefinitions.set(tool.fullName, createMcpToolDefinition(tool, this._mcpManager));
                    }
                    this._refreshToolRegistry();
                }
                else if (conn.status === "error" || conn.status === "disconnected") {
                    const staleKeys = [...this._mcpToolDefinitions.keys()].filter((key) => key.startsWith(`mcp__${conn.name}__`));
                    for (const key of staleKeys) {
                        this._mcpToolDefinitions.delete(key);
                    }
                    this._refreshToolRegistry();
                }
            },
        });
        this._mcpManager.connectAll(servers).catch(() => { });
    }
    async _getRequiredRequestAuth(model) {
        const result = await this._modelRegistry.getApiKeyAndHeaders(model);
        if (!result.ok) {
            if (result.error.startsWith("No API key found")) {
                throw new Error(formatNoApiKeyFoundMessage(model.provider));
            }
            throw new Error(result.error);
        }
        if (result.apiKey) {
            return { apiKey: result.apiKey, headers: result.headers };
        }
        const isOAuth = this._modelRegistry.isUsingOAuth(model);
        if (isOAuth) {
            throw new Error(`Authentication failed for "${model.provider}". ` +
                `Credentials may have expired or network is unavailable. ` +
                `Run '/login ${model.provider}' to re-authenticate.`);
        }
        throw new Error(formatNoApiKeyFoundMessage(model.provider));
    }
    /**
     * Install tool hooks once on the Agent instance.
     *
     * The callbacks read `this._extensionRunner` at execution time, so extension reload swaps in the
     * new runner without reinstalling hooks. Extension-specific tool wrappers are still used to adapt
     * registered tool execution to the extension context. Tool call and tool result interception now
     * happens here instead of in wrappers.
     */
    _installAgentToolHooks() {
        this.agent.beforeToolCall = async ({ toolCall, args }) => {
            const runner = this._extensionRunner;
            if (!runner.hasHandlers("tool_call")) {
                return undefined;
            }
            await this._agentEventQueue;
            try {
                return await runner.emitToolCall({
                    type: "tool_call",
                    toolName: toolCall.name,
                    toolCallId: toolCall.id,
                    input: args,
                    variables: this._effectiveToolCallVariables,
                });
            }
            catch (err) {
                if (err instanceof Error) {
                    throw err;
                }
                throw new Error(`Extension failed, blocking execution: ${String(err)}`);
            }
        };
        this.agent.afterToolCall = async ({ toolCall, args, result, isError }) => {
            const runner = this._extensionRunner;
            if (!runner.hasHandlers("tool_result")) {
                return undefined;
            }
            const hookResult = await runner.emitToolResult({
                type: "tool_result",
                toolName: toolCall.name,
                toolCallId: toolCall.id,
                input: args,
                content: result.content,
                details: result.details,
                isError,
                variables: this._effectiveToolCallVariables,
            });
            if (!hookResult) {
                return undefined;
            }
            return {
                content: hookResult.content,
                details: hookResult.details,
                isError: hookResult.isError ?? isError,
            };
        };
    }
    // =========================================================================
    // Event Subscription
    // =========================================================================
    /** Emit an event to all listeners */
    _emit(event) {
        for (const l of this._eventListeners) {
            l(event);
        }
    }
    _emitQueueUpdate() {
        this._emit({
            type: "queue_update",
            steering: [...this._steeringMessages],
            followUp: [...this._followUpMessages],
        });
    }
    /** Emit entries_invalidated event to extensions when entries are removed from LLM context.
     *  This is a notification-only event; it does not block or collect results. */
    _emitEntriesInvalidated(invalidatedEntryIds, reason, operationEntryId) {
        if (!this._extensionRunner || invalidatedEntryIds.length === 0)
            return;
        // Extract toolCallIds from invalidated tool result entries
        const invalidatedToolCallIds = [];
        for (const id of invalidatedEntryIds) {
            const entry = this.sessionManager.getEntry(id);
            if (entry && entry.type === "message" && entry.message.role === "toolResult") {
                const toolCallId = entry.message.toolCallId;
                if (toolCallId) {
                    invalidatedToolCallIds.push(toolCallId);
                }
            }
        }
        // Fire-and-forget: don't await to avoid blocking SessionManager's synchronous _appendEntry
        this._extensionRunner
            .emit({
            type: "entries_invalidated",
            invalidatedEntryIds,
            reason,
            operationEntryId,
            invalidatedToolCallIds,
        })
            .catch(() => {
            // Silently swallow errors — this is a notification, not a critical path
        });
    }
    // Track last assistant message for auto-compaction check
    _lastAssistantMessage = undefined;
    /** Internal handler for agent events - shared by subscribe and reconnect */
    _handleAgentEvent = (event) => {
        // Create retry promise synchronously before queueing async processing.
        // Agent.emit() calls this handler synchronously, and prompt() calls waitForRetry()
        // as soon as agent.prompt() resolves. If _retryPromise is created only inside
        // _processAgentEvent, slow earlier queued events can delay agent_end processing
        // and waitForRetry() can miss the in-flight retry.
        this._createRetryPromiseForAgentEnd(event);
        this._agentEventQueue = this._agentEventQueue.then(() => this._processAgentEvent(event), () => this._processAgentEvent(event));
        // Keep queue alive if an event handler fails
        this._agentEventQueue.catch(() => { });
    };
    _createRetryPromiseForAgentEnd(event) {
        if (event.type !== "agent_end" || this._retryPromise) {
            return;
        }
        const settings = this.settingsManager.getRetrySettings();
        if (!settings.enabled) {
            return;
        }
        const lastAssistant = this._findLastAssistantInMessages(event.messages);
        if (!lastAssistant || !this._isRetryableError(lastAssistant)) {
            return;
        }
        this._retryPromise = new Promise((resolve) => {
            this._retryResolve = resolve;
        });
    }
    _findLastAssistantInMessages(messages) {
        for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i];
            if (message.role === "assistant") {
                return message;
            }
        }
        return undefined;
    }
    async _processAgentEvent(event) {
        // When a user message starts, check if it's from either queue and remove it BEFORE emitting
        // This ensures the UI sees the updated queue state
        if (event.type === "message_start" && event.message.role === "user") {
            this._overflowRecoveryAttempted = false;
            const messageText = this._getUserMessageText(event.message);
            if (messageText) {
                // Check steering queue first
                const steeringIndex = this._steeringMessages.indexOf(messageText);
                if (steeringIndex !== -1) {
                    this._steeringMessages.splice(steeringIndex, 1);
                    this._emitQueueUpdate();
                }
                else {
                    // Check follow-up queue
                    const followUpIndex = this._followUpMessages.indexOf(messageText);
                    if (followUpIndex !== -1) {
                        this._followUpMessages.splice(followUpIndex, 1);
                        this._emitQueueUpdate();
                    }
                }
            }
        }
        // Emit to extensions first
        await this._emitExtensionEvent(event);
        // Notify all listeners
        this._emit(event);
        // Handle session persistence
        if (event.type === "message_end") {
            // Check if this is a custom message from extensions
            if (event.message.role === "custom") {
                // Persist as CustomMessageEntry
                this.sessionManager.appendCustomMessageEntry(event.message.customType, event.message.content, event.message.display, event.message.details);
            }
            else if (event.message.role === "user" ||
                event.message.role === "assistant" ||
                event.message.role === "toolResult") {
                // Regular LLM message - persist as SessionMessageEntry
                this.sessionManager.appendMessage(event.message);
            }
            // Other message types (bashExecution, compactionSummary, branchSummary) are persisted elsewhere
            // Track assistant message for auto-compaction (checked on agent_end)
            if (event.message.role === "assistant") {
                this._lastAssistantMessage = event.message;
                const assistantMsg = event.message;
                if (assistantMsg.stopReason !== "error") {
                    this._overflowRecoveryAttempted = false;
                }
                // Reset retry counter immediately on successful assistant response
                // This prevents accumulation across multiple LLM calls within a turn
                if (assistantMsg.stopReason !== "error" && this._retryAttempt > 0) {
                    this._emit({
                        type: "auto_retry_end",
                        success: true,
                        attempt: this._retryAttempt,
                    });
                    this._retryAttempt = 0;
                }
            }
        }
        // Check auto-retry and auto-compaction after agent completes
        if (event.type === "agent_end" && this._lastAssistantMessage) {
            const msg = this._lastAssistantMessage;
            this._lastAssistantMessage = undefined;
            // Check for retryable errors first (overloaded, rate limit, server errors)
            if (this._isRetryableError(msg)) {
                const didRetry = await this._handleRetryableError(msg);
                if (didRetry)
                    return; // Retry was initiated, don't proceed to compaction
            }
            this._resolveRetry();
            await this._checkCompaction(msg);
        }
    }
    /** Resolve the pending retry promise */
    _resolveRetry() {
        if (this._retryResolve) {
            this._retryResolve();
            this._retryResolve = undefined;
            this._retryPromise = undefined;
        }
    }
    /** Extract text content from a message */
    _getUserMessageText(message) {
        if (message.role !== "user")
            return "";
        const content = message.content;
        if (typeof content === "string")
            return content;
        const textBlocks = content.filter((c) => c.type === "text");
        return textBlocks.map((c) => c.text).join("");
    }
    /** Find the last assistant message in agent state (including aborted ones) */
    _findLastAssistantMessage() {
        const messages = this.agent.state.messages;
        for (let i = messages.length - 1; i >= 0; i--) {
            const msg = messages[i];
            if (msg.role === "assistant") {
                return msg;
            }
        }
        return undefined;
    }
    _replaceMessageInPlace(target, replacement) {
        // Agent-core stores the finalized message object in its state before emitting message_end.
        // SessionManager persistence happens later in _processAgentEvent() with event.message.
        // Mutating this object in place keeps agent state, later turn/agent events, listeners,
        // and the eventual SessionManager.appendMessage(event.message) persistence in sync.
        if (target === replacement) {
            return;
        }
        const targetRecord = target;
        for (const key of Object.keys(targetRecord)) {
            delete targetRecord[key];
        }
        Object.assign(targetRecord, replacement);
    }
    /** Emit extension events based on agent events */
    async _emitExtensionEvent(event) {
        if (event.type === "agent_start") {
            await this._extensionRunner.emit({ type: "agent_start", variables: this._currentAgentVariables });
        }
        else if (event.type === "agent_end") {
            await this._extensionRunner.emit({
                type: "agent_end",
                messages: event.messages,
                variables: this._currentAgentVariables,
            });
        }
        else if (event.type === "turn_start") {
            const extensionEvent = {
                type: "turn_start",
                turnIndex: this._turnIndex,
                timestamp: Date.now(),
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "turn_end") {
            const extensionEvent = {
                type: "turn_end",
                turnIndex: this._turnIndex,
                message: event.message,
                toolResults: event.toolResults,
            };
            await this._extensionRunner.emit(extensionEvent);
            this._turnIndex++;
            // Enforce maxTurns limit for main session loop
            if (this._maxTurns !== undefined && this._turnIndex >= this._maxTurns) {
                this.agent.abort();
            }
        }
        else if (event.type === "message_start") {
            const extensionEvent = {
                type: "message_start",
                message: event.message,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "message_update") {
            const extensionEvent = {
                type: "message_update",
                message: event.message,
                assistantMessageEvent: event.assistantMessageEvent,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "message_end") {
            const extensionEvent = {
                type: "message_end",
                message: event.message,
            };
            const replacement = await this._extensionRunner.emitMessageEnd(extensionEvent);
            if (replacement) {
                this._replaceMessageInPlace(event.message, replacement);
            }
        }
        else if (event.type === "tool_execution_start") {
            const extensionEvent = {
                type: "tool_execution_start",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
                timestamp: event.timestamp,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "tool_execution_update") {
            const extensionEvent = {
                type: "tool_execution_update",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                args: event.args,
                partialResult: event.partialResult,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
        else if (event.type === "tool_execution_end") {
            const extensionEvent = {
                type: "tool_execution_end",
                toolCallId: event.toolCallId,
                toolName: event.toolName,
                result: event.result,
                isError: event.isError,
                timestamp: event.timestamp,
                durationMs: event.durationMs,
            };
            await this._extensionRunner.emit(extensionEvent);
        }
    }
    /**
     * Subscribe to agent events.
     * Session persistence is handled internally (saves messages on message_end).
     * Multiple listeners can be added. Returns unsubscribe function for this listener.
     */
    subscribe(listener) {
        this._eventListeners.push(listener);
        // Return unsubscribe function for this specific listener
        return () => {
            const index = this._eventListeners.indexOf(listener);
            if (index !== -1) {
                this._eventListeners.splice(index, 1);
            }
        };
    }
    /**
     * Temporarily disconnect from agent events.
     * User listeners are preserved and will receive events again after resubscribe().
     * Used internally during operations that need to pause event processing.
     */
    _disconnectFromAgent() {
        if (this._unsubscribeAgent) {
            this._unsubscribeAgent();
            this._unsubscribeAgent = undefined;
        }
    }
    /**
     * Reconnect to agent events after _disconnectFromAgent().
     * Preserves all existing listeners.
     */
    _reconnectToAgent() {
        if (this._unsubscribeAgent)
            return; // Already connected
        this._unsubscribeAgent = this.agent.subscribe(this._handleAgentEvent);
    }
    /**
     * Remove all listeners and disconnect from agent.
     * Call this when completely done with the session.
     */
    dispose() {
        this._extensionRunner.invalidate("This extension ctx is stale after session replacement or reload. Do not use a captured pi or command ctx after ctx.newSession(), ctx.fork(), ctx.switchSession(), or ctx.reload(). For newSession, fork, and switchSession, move post-replacement work into withSession and use the ctx passed to withSession. For reload, do not use the old ctx after await ctx.reload().");
        this.cleanupResources();
    }
    /**
     * Cleanup non-extension resources (MCP, agent listeners, event listeners).
     * Used during session replacement where the old runner is retargeted
     * instead of invalidated.
     */
    cleanupResources() {
        this._mcpManager?.dispose().catch(() => { });
        this._disconnectFromAgent();
        this._eventListeners = [];
        cleanupSessionResources(this.sessionId);
    }
    getMcpConnections() {
        if (!this._mcpManager)
            return [];
        return this._mcpManager.getConnections().map((c) => ({
            name: c.name,
            status: c.status,
            error: c.error,
            tools: c.tools.map((t) => ({
                originalName: t.originalName,
                fullName: t.fullName,
                description: t.description,
            })),
            scope: this._mcpServerScopes.get(c.name) ?? "global",
            disabled: c.config.disabled,
        }));
    }
    async toggleMcpServer(name, enabled) {
        if (!this._mcpManager)
            throw new Error("MCP is not initialized");
        const scope = this._mcpServerScopes.get(name);
        if (!scope)
            throw new Error(`MCP server "${name}" not found`);
        await this._mcpManager.setServerEnabled(name, enabled);
        this.settingsManager.setMcpServerDisabled(name, !enabled, scope);
    }
    async restartMcpServer(name) {
        if (!this._mcpManager)
            throw new Error("MCP is not initialized");
        await this._mcpManager.restartServer(name);
    }
    // =========================================================================
    // Read-only State Access
    // =========================================================================
    /** Full agent state */
    get state() {
        return this.agent.state;
    }
    /** Current model (may be undefined if not yet selected) */
    get model() {
        return this.agent.state.model;
    }
    getTierModels() {
        return this._tierModels;
    }
    setTierModels(mapping) {
        this._tierModels = { ...mapping };
        this.sessionManager.appendTierModelsChange(mapping);
        this.settingsManager.setTierModels(mapping);
    }
    /** Current thinking level */
    get thinkingLevel() {
        return this.agent.state.thinkingLevel;
    }
    /** Whether agent is currently streaming a response */
    get isStreaming() {
        return this.agent.state.isStreaming;
    }
    /** Current effective system prompt (includes any per-turn extension modifications) */
    get systemPrompt() {
        return this.agent.state.systemPrompt;
    }
    /** Current retry attempt (0 if not retrying) */
    get retryAttempt() {
        return this._retryAttempt;
    }
    /**
     * Get the names of currently active tools.
     * Returns the names of tools currently set on the agent.
     */
    getActiveToolNames() {
        return this.agent.state.tools.map((t) => t.name);
    }
    /**
     * Get all configured tools with name, description, parameter schema, and source metadata.
     */
    getAllTools() {
        return Array.from(this._toolDefinitions.values()).map(({ definition, sourceInfo }) => ({
            name: definition.name,
            description: definition.description,
            parameters: definition.parameters,
            sourceInfo,
        }));
    }
    getToolDefinition(name) {
        return this._toolDefinitions.get(name)?.definition;
    }
    /**
     * Set active tools by name.
     * Only tools in the registry can be enabled. Unknown tool names are ignored.
     * Also rebuilds the system prompt to reflect the new tool set.
     * Changes take effect on the next agent turn.
     */
    setActiveToolsByName(toolNames) {
        const tools = [];
        const validToolNames = [];
        for (const name of toolNames) {
            const tool = this._toolRegistry.get(name);
            if (tool) {
                tools.push(tool);
                validToolNames.push(name);
            }
        }
        this.agent.state.tools = tools;
        // Rebuild base system prompt with new tool set
        this._baseSystemPrompt = this._rebuildSystemPrompt(validToolNames);
        this.agent.state.systemPrompt = this._baseSystemPrompt;
    }
    async applyAgentConfig(agent) {
        this._currentAgentName = agent.name;
        this._currentAgentVariables = {
            ...(agent.variables ?? {}),
        };
        if (agent.permissionMode) {
            this._currentAgentVariables["permissionMode"] = agent.permissionMode;
        }
        if (agent.name) {
            this._currentAgentVariables["agentName"] = agent.name;
        }
        if (agent.disallowedTools && agent.disallowedTools.length > 0) {
            this._currentAgentVariables["disallowedTools"] = agent.disallowedTools.join(",");
        }
        if (agent.tools && agent.tools.length > 0) {
            this._currentAgentVariables["allowedTools"] = agent.tools.join(",");
        }
        if (agent.hooks && Object.keys(agent.hooks).length > 0) {
            this._currentAgentVariables["agentHooks"] = JSON.stringify(agent.hooks);
        }
        if (agent.paths && (agent.paths.write || agent.paths.read || agent.paths.bash)) {
            this._currentAgentVariables["paths"] = JSON.stringify(agent.paths);
        }
        if (agent.thinkingLevel) {
            this.setThinkingLevel(agent.thinkingLevel);
        }
        // Apply maxTurns limit for main session loop
        if (agent.maxTurns !== undefined && agent.maxTurns > 0) {
            this._maxTurns = agent.maxTurns;
            this._currentAgentVariables["maxTurns"] = String(agent.maxTurns);
        }
        else {
            this._maxTurns = undefined;
        }
        // Apply effort level (injected into system prompt as guidance)
        if (agent.effort) {
            this._effort = agent.effort;
            this._currentAgentVariables["effort"] = agent.effort;
        }
        else {
            this._effort = undefined;
        }
        // Apply skills filter (restricts which skills appear in system prompt)
        if (agent.skills && agent.skills.length > 0) {
            this._activeSkillNames = new Set(agent.skills);
            this._currentAgentVariables["skills"] = agent.skills.join(",");
        }
        else {
            this._activeSkillNames = undefined;
        }
        if (agent.tools && agent.tools.length > 0) {
            this.setActiveToolsByName(agent.tools);
        }
        else {
            // No tool restriction — restore ALL tools from registry (e.g. Build agent)
            this.setActiveToolsByName([...this._toolRegistry.keys()]);
        }
        // Remove explicitly disallowed tools from the active set
        if (agent.disallowedTools && agent.disallowedTools.length > 0) {
            const disallowed = new Set(agent.disallowedTools);
            const filtered = this.getActiveToolNames().filter((n) => !disallowed.has(n));
            this.setActiveToolsByName(filtered);
        }
        if (agent.systemPrompt) {
            // Inject path restriction notice into system prompt
            let enhancedPrompt = agent.systemPrompt;
            if (agent.paths) {
                const pathNotice = AgentSession.buildPathRestrictionNotice(agent.paths);
                if (pathNotice) {
                    enhancedPrompt = `${pathNotice}\n\n${enhancedPrompt}`;
                }
            }
            // Inject effort guidance
            if (this._effort) {
                enhancedPrompt = `${enhancedPrompt}\n\n${AgentSession.buildEffortNotice(this._effort)}`;
            }
            // Rebuild prompt with agent system prompt inserted between base and tools
            this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames(), enhancedPrompt);
            this.agent.state.systemPrompt = this._baseSystemPrompt;
        }
        else {
            // No custom system prompt — rebuild with default (no agent section)
            let effortSuffix = "";
            if (this._effort) {
                effortSuffix = AgentSession.buildEffortNotice(this._effort);
            }
            this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames(), effortSuffix || undefined);
            this.agent.state.systemPrompt = this._baseSystemPrompt;
        }
        // Persist agent change to session
        this.sessionManager.appendAgentChange(agent.name, {
            description: agent.description,
            tools: agent.tools,
            permissionMode: agent.permissionMode,
            tier: agent.tier,
            thinkingLevel: agent.thinkingLevel,
            model: agent.model,
            paths: agent.paths,
            maxTurns: agent.maxTurns,
            effort: agent.effort,
        });
    }
    getCurrentAgent() {
        return this._currentAgentName;
    }
    /** Whether compaction or branch summarization is currently running */
    get isCompacting() {
        return (this._autoCompactionAbortController !== undefined ||
            this._compactionAbortController !== undefined ||
            this._branchSummaryAbortController !== undefined);
    }
    /** All messages including custom types like BashExecutionMessage */
    get messages() {
        return this.agent.state.messages;
    }
    /** Current steering mode */
    get steeringMode() {
        return this.agent.steeringMode;
    }
    /** Current follow-up mode */
    get followUpMode() {
        return this.agent.followUpMode;
    }
    /** Current session file path, or undefined if sessions are disabled */
    get sessionFile() {
        return this.sessionManager.getSessionFile();
    }
    /** Current session ID */
    get sessionId() {
        return this.sessionManager.getSessionId();
    }
    /** Current session display name, if set */
    get sessionName() {
        return this.sessionManager.getSessionName();
    }
    /** Scoped models for cycling (from --models flag) */
    get scopedModels() {
        return this._scopedModels;
    }
    /** Update scoped models for cycling */
    setScopedModels(scopedModels) {
        this._scopedModels = scopedModels;
    }
    /** File-based prompt templates */
    get promptTemplates() {
        return this._resourceLoader.getPrompts().prompts;
    }
    _normalizePromptSnippet(text) {
        if (!text)
            return undefined;
        const oneLine = text
            .replace(/[\r\n]+/g, " ")
            .replace(/\s+/g, " ")
            .trim();
        return oneLine.length > 0 ? oneLine : undefined;
    }
    _normalizePromptGuidelines(guidelines) {
        if (!guidelines || guidelines.length === 0) {
            return [];
        }
        const unique = new Set();
        for (const guideline of guidelines) {
            const normalized = guideline.trim();
            if (normalized.length > 0) {
                unique.add(normalized);
            }
        }
        return Array.from(unique);
    }
    static buildPathRestrictionNotice(paths) {
        const lines = ["## Path Restrictions", "", "You are operating under path-level restrictions. You MUST only access files within the allowed paths:"];
        if (paths.write && paths.write.length > 0) {
            lines.push(`- **Write paths** (edit, write, patch): ${paths.write.join(", ")}`);
        }
        if (paths.read && paths.read.length > 0) {
            lines.push(`- **Read paths** (read): ${paths.read.join(", ")}`);
        }
        if (paths.bash && paths.bash.length > 0) {
            lines.push(`- **Bash paths**: ${paths.bash.join(", ")}`);
        }
        lines.push("");
        lines.push("Do NOT attempt to access files outside these paths. If you need to access a restricted path, explain why and ask the user.");
        return lines.join("\n");
    }
    static EFFORT_NOTICES = {
        low: "## Effort Level: Low\n\nProvide brief, concise answers. Focus on the most essential information. Skip detailed explanations. Use short code snippets over long blocks. Limit yourself to 1-2 paragraphs unless more is absolutely necessary.",
        medium: "## Effort Level: Medium\n\nProvide balanced answers with enough detail to be useful. Include relevant context and examples where appropriate. Be thorough but avoid unnecessary verbosity.",
        high: "## Effort Level: High\n\nProvide comprehensive, detailed analysis. Consider multiple approaches. Include edge cases and error handling. Write thorough code with complete implementations. Document your reasoning. When in doubt, explain more rather than less.",
    };
    static buildEffortNotice(effort) {
        const normalized = effort.toLowerCase().trim();
        return AgentSession.EFFORT_NOTICES[normalized] ?? `## Effort Level: ${effort}\n\nAdjust your response effort level accordingly.`;
    }
    _rebuildSystemPrompt(toolNames, agentSystemPrompt) {
        const validToolNames = toolNames.filter((name) => this._toolRegistry.has(name));
        const toolSnippets = {};
        const promptGuidelines = [];
        for (const name of validToolNames) {
            const snippet = this._toolPromptSnippets.get(name);
            if (snippet) {
                toolSnippets[name] = snippet;
            }
            const toolGuidelines = this._toolPromptGuidelines.get(name);
            if (toolGuidelines) {
                promptGuidelines.push(...toolGuidelines);
            }
        }
        const loaderSystemPrompt = this._resourceLoader.getSystemPrompt();
        const loaderAppendSystemPrompt = this._resourceLoader.getAppendSystemPrompt();
        const appendSystemPrompt = loaderAppendSystemPrompt.length > 0 ? loaderAppendSystemPrompt.join("\n\n") : undefined;
        const loadedSkills = this._resourceLoader.getSkills().skills;
        const activeSkills = this._activeSkillNames
            ? loadedSkills.filter((s) => this._activeSkillNames.has(s.name))
            : loadedSkills;
        const loadedContextFiles = this._resourceLoader.getAgentsFiles().agentsFiles;
        this._baseSystemPromptOptions = {
            cwd: this._cwd,
            skills: activeSkills,
            contextFiles: loadedContextFiles,
            customPrompt: loaderSystemPrompt,
            appendSystemPrompt,
            agentSystemPrompt,
            selectedTools: validToolNames,
            toolSnippets,
            promptGuidelines,
        };
        return buildSystemPrompt(this._baseSystemPromptOptions);
    }
    // =========================================================================
    // Prompting
    // =========================================================================
    /**
     * Send a prompt to the agent.
     * - Handles extension commands (registered via pi.registerCommand) immediately, even during streaming
     * - Expands file-based prompt templates by default
     * - During streaming, queues via steer() or followUp() based on streamingBehavior option
     * - Validates model and API key before sending (when not streaming)
     * @throws Error if streaming and no streamingBehavior specified
     * @throws Error if no model selected or no API key available (when not streaming)
     */
    async prompt(text, options) {
        const expandPromptTemplates = options?.expandPromptTemplates ?? true;
        const preflightResult = options?.preflightResult;
        let messages;
        try {
            // Handle extension commands first (execute immediately, even during streaming)
            // Extension commands manage their own LLM interaction via pi.sendMessage()
            if (expandPromptTemplates && text.startsWith("/")) {
                const handled = await this._tryExecuteExtensionCommand(text);
                if (handled) {
                    // Extension command executed, no prompt to send
                    preflightResult?.(true);
                    return;
                }
            }
            // Emit input event for extension interception (before skill/template expansion)
            let currentText = text;
            let currentImages = options?.images;
            if (this._extensionRunner.hasHandlers("input")) {
                const inputResult = await this._extensionRunner.emitInput(currentText, currentImages, options?.source ?? "interactive");
                if (inputResult.action === "handled") {
                    preflightResult?.(true);
                    return;
                }
                if (inputResult.action === "transform") {
                    currentText = inputResult.text;
                    currentImages = inputResult.images ?? currentImages;
                }
            }
            // Expand skill commands (/skill:name args) and prompt templates (/template args)
            let expandedText = currentText;
            if (expandPromptTemplates) {
                expandedText = this._expandSkillCommand(expandedText);
                expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
            }
            // If streaming, queue via steer() or followUp() based on option
            if (this.isStreaming) {
                if (!options?.streamingBehavior) {
                    throw new Error("Agent is already processing. Specify streamingBehavior ('steer' or 'followUp') to queue the message.");
                }
                if (options.streamingBehavior === "followUp") {
                    await this._queueFollowUp(expandedText, currentImages);
                }
                else {
                    await this._queueSteer(expandedText, currentImages);
                }
                preflightResult?.(true);
                return;
            }
            // Flush any pending bash messages before the new prompt
            this._flushPendingBashMessages();
            // Validate model
            if (!this.model) {
                throw new Error(formatNoModelSelectedMessage());
            }
            if (!this._modelRegistry.hasConfiguredAuth(this.model)) {
                const isOAuth = this._modelRegistry.isUsingOAuth(this.model);
                if (isOAuth) {
                    throw new Error(`Authentication failed for "${this.model.provider}". ` +
                        `Credentials may have expired or network is unavailable. ` +
                        `Run '/login ${this.model.provider}' to re-authenticate.`);
                }
                throw new Error(formatNoApiKeyFoundMessage(this.model.provider));
            }
            // Check if we need to compact before sending (catches aborted responses)
            const lastAssistant = this._findLastAssistantMessage();
            if (lastAssistant) {
                await this._checkCompaction(lastAssistant, false);
            }
            // Build messages array (custom message if any, then user message)
            messages = [];
            // Add user message
            const userContent = [{ type: "text", text: expandedText }];
            if (currentImages) {
                userContent.push(...currentImages);
            }
            messages.push({
                role: "user",
                content: userContent,
                timestamp: Date.now(),
            });
            // Inject any pending "nextTurn" messages as context alongside the user message
            for (const msg of this._pendingNextTurnMessages) {
                messages.push(msg);
            }
            this._pendingNextTurnMessages = [];
            // Emit before_agent_start extension event
            const result = await this._extensionRunner.emitBeforeAgentStart(expandedText, currentImages, this._baseSystemPrompt, this._baseSystemPromptOptions);
            // Add all custom messages from extensions
            if (result?.messages) {
                for (const msg of result.messages) {
                    messages.push({
                        role: "custom",
                        customType: msg.customType,
                        content: msg.content,
                        display: msg.display,
                        details: msg.details,
                        timestamp: Date.now(),
                    });
                }
            }
            // Apply extension-modified system prompt, or reset to base
            if (result?.systemPrompt) {
                this.agent.state.systemPrompt = result.systemPrompt;
            }
            else {
                // Ensure we're using the base prompt (in case previous turn had modifications)
                this.agent.state.systemPrompt = this._baseSystemPrompt;
            }
        }
        catch (error) {
            preflightResult?.(false);
            throw error;
        }
        if (!messages) {
            return;
        }
        preflightResult?.(true);
        await this.agent.prompt(messages);
        await this.waitForRetry();
    }
    /**
     * Try to execute an extension command. Returns true if command was found and executed.
     */
    async _tryExecuteExtensionCommand(text) {
        // Parse command name and args
        const spaceIndex = text.indexOf(" ");
        const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
        const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1);
        const command = this._extensionRunner.getCommand(commandName);
        if (!command)
            return false;
        // Get command context from extension runner (includes session control methods)
        const ctx = this._extensionRunner.createCommandContext();
        try {
            await command.handler(args, ctx);
            return true;
        }
        catch (err) {
            // Emit error via extension runner
            this._extensionRunner.emitError({
                extensionPath: `command:${commandName}`,
                event: "command",
                error: err instanceof Error ? err.message : String(err),
            });
            return true;
        }
    }
    /**
     * Expand skill commands (/skill:name args) to their full content.
     * Returns the expanded text, or the original text if not a skill command or skill not found.
     * Emits errors via extension runner if file read fails.
     */
    _expandSkillCommand(text) {
        if (!text.startsWith("/skill:"))
            return text;
        const spaceIndex = text.indexOf(" ");
        const skillName = spaceIndex === -1 ? text.slice(7) : text.slice(7, spaceIndex);
        const args = spaceIndex === -1 ? "" : text.slice(spaceIndex + 1).trim();
        const skill = this.resourceLoader.getSkills().skills.find((s) => s.name === skillName);
        if (!skill)
            return text; // Unknown skill, pass through
        try {
            const content = readFileSync(skill.filePath, "utf-8");
            const body = stripFrontmatter(content).trim();
            const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
            return args ? `${skillBlock}\n\n${args}` : skillBlock;
        }
        catch (err) {
            // Emit error like extension commands do
            this._extensionRunner.emitError({
                extensionPath: skill.filePath,
                event: "skill_expansion",
                error: err instanceof Error ? err.message : String(err),
            });
            return text; // Return original on error
        }
    }
    /**
     * Queue a steering message while the agent is running.
     * Delivered after the current assistant turn finishes executing its tool calls,
     * before the next LLM call.
     * Expands skill commands and prompt templates. Errors on extension commands.
     * @param images Optional image attachments to include with the message
     * @throws Error if text is an extension command
     */
    async steer(text, images) {
        // Check for extension commands (cannot be queued)
        if (text.startsWith("/")) {
            this._throwIfExtensionCommand(text);
        }
        // Expand skill commands and prompt templates
        let expandedText = this._expandSkillCommand(text);
        expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
        await this._queueSteer(expandedText, images);
    }
    /**
     * Queue a follow-up message to be processed after the agent finishes.
     * Delivered only when agent has no more tool calls or steering messages.
     * Expands skill commands and prompt templates. Errors on extension commands.
     * @param images Optional image attachments to include with the message
     * @throws Error if text is an extension command
     */
    async followUp(text, images) {
        // Check for extension commands (cannot be queued)
        if (text.startsWith("/")) {
            this._throwIfExtensionCommand(text);
        }
        // Expand skill commands and prompt templates
        let expandedText = this._expandSkillCommand(text);
        expandedText = expandPromptTemplate(expandedText, [...this.promptTemplates]);
        await this._queueFollowUp(expandedText, images);
    }
    /**
     * Internal: Queue a steering message (already expanded, no extension command check).
     */
    async _queueSteer(text, images) {
        this._steeringMessages.push(text);
        this._emitQueueUpdate();
        const content = [{ type: "text", text }];
        if (images) {
            content.push(...images);
        }
        this.agent.steer({
            role: "user",
            content,
            timestamp: Date.now(),
        });
    }
    /**
     * Internal: Queue a follow-up message (already expanded, no extension command check).
     */
    async _queueFollowUp(text, images) {
        this._followUpMessages.push(text);
        this._emitQueueUpdate();
        const content = [{ type: "text", text }];
        if (images) {
            content.push(...images);
        }
        this.agent.followUp({
            role: "user",
            content,
            timestamp: Date.now(),
        });
    }
    /**
     * Throw an error if the text is an extension command.
     */
    _throwIfExtensionCommand(text) {
        const spaceIndex = text.indexOf(" ");
        const commandName = spaceIndex === -1 ? text.slice(1) : text.slice(1, spaceIndex);
        const command = this._extensionRunner.getCommand(commandName);
        if (command) {
            throw new Error(`Extension command "/${commandName}" cannot be queued. Use prompt() or execute the command when not streaming.`);
        }
    }
    /**
     * Send a custom message to the session. Creates a CustomMessageEntry.
     *
     * Handles three cases:
     * - Streaming: queues message, processed when loop pulls from queue
     * - Not streaming + triggerTurn: appends to state/session, starts new turn
     * - Not streaming + no trigger: appends to state/session, no turn
     *
     * @param message Custom message with customType, content, display, details
     * @param options.triggerTurn If true and not streaming, triggers a new LLM turn
     * @param options.deliverAs Delivery mode: "steer", "followUp", or "nextTurn"
     */
    async sendCustomMessage(message, options) {
        const appMessage = {
            role: "custom",
            customType: message.customType,
            content: message.content,
            display: message.display,
            details: message.details,
            timestamp: Date.now(),
        };
        if (options?.deliverAs === "nextTurn") {
            this._pendingNextTurnMessages.push(appMessage);
        }
        else if (this.isStreaming) {
            if (options?.deliverAs === "followUp") {
                this.agent.followUp(appMessage);
            }
            else {
                this.agent.steer(appMessage);
            }
        }
        else if (options?.triggerTurn) {
            await this.agent.prompt(appMessage);
        }
        else {
            this.agent.state.messages.push(appMessage);
            this.sessionManager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details);
            this._emit({ type: "message_start", message: appMessage });
            this._emit({ type: "message_end", message: appMessage });
        }
    }
    /**
     * Send a user message to the agent. Always triggers a turn.
     * When the agent is streaming, use deliverAs to specify how to queue the message.
     *
     * @param content User message content (string or content array)
     * @param options.deliverAs Delivery mode when streaming: "steer" or "followUp"
     */
    async sendUserMessage(content, options) {
        // Normalize content to text string + optional images
        let text;
        let images;
        if (typeof content === "string") {
            text = content;
        }
        else {
            const textParts = [];
            images = [];
            for (const part of content) {
                if (part.type === "text") {
                    textParts.push(part.text);
                }
                else {
                    images.push(part);
                }
            }
            text = textParts.join("\n");
            if (images.length === 0)
                images = undefined;
        }
        // Use prompt() with expandPromptTemplates: false to skip command handling and template expansion
        await this.prompt(text, {
            expandPromptTemplates: false,
            streamingBehavior: options?.deliverAs,
            images,
            source: "extension",
        });
    }
    /**
     * Clear all queued messages and return them.
     * Useful for restoring to editor when user aborts.
     * @returns Object with steering and followUp arrays
     */
    clearQueue() {
        const steering = [...this._steeringMessages];
        const followUp = [...this._followUpMessages];
        this._steeringMessages = [];
        this._followUpMessages = [];
        this.agent.clearAllQueues();
        this._emitQueueUpdate();
        return { steering, followUp };
    }
    /** Number of pending messages (includes both steering and follow-up) */
    get pendingMessageCount() {
        return this._steeringMessages.length + this._followUpMessages.length;
    }
    /** Get pending steering messages (read-only) */
    getSteeringMessages() {
        return this._steeringMessages;
    }
    /** Get pending follow-up messages (read-only) */
    getFollowUpMessages() {
        return this._followUpMessages;
    }
    get resourceLoader() {
        return this._resourceLoader;
    }
    /** Update the working directory for the session. */
    async setCwd(newCwd) {
        this._cwd = newCwd;
    }
    /**
     * Abort current operation and wait for agent to become idle.
     * If the agent does not settle within the timeout, returns anyway
     * to avoid blocking the caller (e.g. RPC abort command).
     */
    async abort() {
        this.abortRetry();
        this.agent.abort();
        // Wait for idle with a timeout so we don't block forever
        // when a tool execution or stream doesn't respect the abort signal.
        const ABORT_IDLE_TIMEOUT_MS = 2_000;
        await Promise.race([
            this.agent.waitForIdle(),
            new Promise((resolve) => setTimeout(resolve, ABORT_IDLE_TIMEOUT_MS)),
        ]);
    }
    // =========================================================================
    // Model Management
    // =========================================================================
    async _emitModelSelect(nextModel, previousModel, source) {
        if (modelsAreEqual(previousModel, nextModel))
            return;
        await this._extensionRunner.emit({
            type: "model_select",
            model: nextModel,
            previousModel,
            source,
        });
    }
    /**
     * Set model directly.
     * Validates that auth is configured, saves to session and settings.
     * @throws Error if no auth is configured for the model
     */
    async setModel(model) {
        if (!this._modelRegistry.hasConfiguredAuth(model)) {
            throw new Error(`No API key for ${model.provider}/${model.id}`);
        }
        const previousModel = this.model;
        const thinkingLevel = this._getThinkingLevelForModelSwitch();
        this.agent.state.model = model;
        this.sessionManager.appendModelChange(model.provider, model.id);
        this.settingsManager.setDefaultModelAndProvider(model.provider, model.id);
        // Re-clamp thinking level for new model's capabilities
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(model, previousModel, "set");
    }
    /**
     * Cycle to next/previous model.
     * Uses scoped models (from --models flag) if available, otherwise all available models.
     * @param direction - "forward" (default) or "backward"
     * @returns The new model info, or undefined if only one model available
     */
    async cycleModel(direction = "forward") {
        if (this._scopedModels.length > 0) {
            return this._cycleScopedModel(direction);
        }
        return this._cycleAvailableModel(direction);
    }
    async _cycleScopedModel(direction) {
        const scopedModels = this._scopedModels.filter((scoped) => this._modelRegistry.hasConfiguredAuth(scoped.model));
        if (scopedModels.length <= 1)
            return undefined;
        const currentModel = this.model;
        let currentIndex = scopedModels.findIndex((sm) => modelsAreEqual(sm.model, currentModel));
        if (currentIndex === -1)
            currentIndex = 0;
        const len = scopedModels.length;
        const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
        const next = scopedModels[nextIndex];
        const thinkingLevel = this._getThinkingLevelForModelSwitch(next.thinkingLevel);
        // Apply model
        this.agent.state.model = next.model;
        this.sessionManager.appendModelChange(next.model.provider, next.model.id);
        this.settingsManager.setDefaultModelAndProvider(next.model.provider, next.model.id);
        // Apply thinking level.
        // - Explicit scoped model thinking level overrides current session level
        // - Undefined scoped model thinking level inherits the current session preference
        // setThinkingLevel clamps to model capabilities.
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(next.model, currentModel, "cycle");
        return { model: next.model, thinkingLevel: this.thinkingLevel, isScoped: true };
    }
    async _cycleAvailableModel(direction) {
        const availableModels = await this._modelRegistry.getAvailable();
        if (availableModels.length <= 1)
            return undefined;
        const currentModel = this.model;
        let currentIndex = availableModels.findIndex((m) => modelsAreEqual(m, currentModel));
        if (currentIndex === -1)
            currentIndex = 0;
        const len = availableModels.length;
        const nextIndex = direction === "forward" ? (currentIndex + 1) % len : (currentIndex - 1 + len) % len;
        const nextModel = availableModels[nextIndex];
        const thinkingLevel = this._getThinkingLevelForModelSwitch();
        this.agent.state.model = nextModel;
        this.sessionManager.appendModelChange(nextModel.provider, nextModel.id);
        this.settingsManager.setDefaultModelAndProvider(nextModel.provider, nextModel.id);
        // Re-clamp thinking level for new model's capabilities
        this.setThinkingLevel(thinkingLevel);
        await this._emitModelSelect(nextModel, currentModel, "cycle");
        return { model: nextModel, thinkingLevel: this.thinkingLevel, isScoped: false };
    }
    // =========================================================================
    // Thinking Level Management
    // =========================================================================
    /**
     * Set thinking level.
     * Clamps to model capabilities based on available thinking levels.
     * Saves to session and settings only if the level actually changes.
     */
    setThinkingLevel(level) {
        const availableLevels = this.getAvailableThinkingLevels();
        const effectiveLevel = availableLevels.includes(level) ? level : this._clampThinkingLevel(level, availableLevels);
        // Only persist if actually changing
        const previousLevel = this.agent.state.thinkingLevel;
        const isChanging = effectiveLevel !== previousLevel;
        this.agent.state.thinkingLevel = effectiveLevel;
        if (isChanging) {
            this.sessionManager.appendThinkingLevelChange(effectiveLevel);
            if (this.supportsThinking() || effectiveLevel !== "off") {
                this.settingsManager.setDefaultThinkingLevel(effectiveLevel);
            }
            this._emit({ type: "thinking_level_changed", level: effectiveLevel });
            void this._extensionRunner.emit({
                type: "thinking_level_select",
                level: effectiveLevel,
                previousLevel,
            });
        }
    }
    /**
     * Cycle to next thinking level.
     * @returns New level, or undefined if model doesn't support thinking
     */
    cycleThinkingLevel() {
        if (!this.supportsThinking())
            return undefined;
        const levels = this.getAvailableThinkingLevels();
        const currentIndex = levels.indexOf(this.thinkingLevel);
        const nextIndex = (currentIndex + 1) % levels.length;
        const nextLevel = levels[nextIndex];
        this.setThinkingLevel(nextLevel);
        return nextLevel;
    }
    /**
     * Get available thinking levels for current model.
     * The provider will clamp to what the specific model supports internally.
     */
    getAvailableThinkingLevels() {
        if (!this.model)
            return THINKING_LEVELS;
        return getSupportedThinkingLevels(this.model);
    }
    /**
     * Check if current model supports thinking/reasoning.
     */
    supportsThinking() {
        return !!this.model?.reasoning;
    }
    _getThinkingLevelForModelSwitch(explicitLevel) {
        if (explicitLevel !== undefined) {
            return explicitLevel;
        }
        if (!this.supportsThinking()) {
            return this.settingsManager.getDefaultThinkingLevel() ?? DEFAULT_THINKING_LEVEL;
        }
        return this.thinkingLevel;
    }
    _clampThinkingLevel(level, _availableLevels) {
        return this.model ? clampThinkingLevel(this.model, level) : "off";
    }
    // =========================================================================
    // Queue Mode Management
    // =========================================================================
    /**
     * Set steering message mode.
     * Saves to settings.
     */
    setSteeringMode(mode) {
        this.agent.steeringMode = mode;
        this.settingsManager.setSteeringMode(mode);
    }
    /**
     * Set follow-up message mode.
     * Saves to settings.
     */
    setFollowUpMode(mode) {
        this.agent.followUpMode = mode;
        this.settingsManager.setFollowUpMode(mode);
    }
    // =========================================================================
    // Compaction
    // =========================================================================
    /**
     * Manually compact the session context.
     * Aborts current agent operation first.
     * @param customInstructions Optional instructions for the compaction summary
     */
    async compact(customInstructions) {
        this._disconnectFromAgent();
        await this.abort();
        this._compactionAbortController = new AbortController();
        this._emit({ type: "compaction_start", reason: "manual" });
        try {
            if (!this.model) {
                throw new Error(formatNoModelSelectedMessage());
            }
            const { apiKey, headers } = await this._getRequiredRequestAuth(this.model);
            const pathEntries = this.sessionManager.getBranch();
            const settings = this.settingsManager.getCompactionSettings();
            const preparation = prepareCompaction(pathEntries, settings);
            if (!preparation) {
                // Check why we can't compact
                const lastEntry = pathEntries[pathEntries.length - 1];
                if (lastEntry?.type === "compaction") {
                    throw new Error("Already compacted");
                }
                throw new Error("Nothing to compact (session too small)");
            }
            let extensionCompaction;
            let fromExtension = false;
            if (this._extensionRunner.hasHandlers("session_before_compact")) {
                const result = (await this._extensionRunner.emit({
                    type: "session_before_compact",
                    preparation,
                    branchEntries: pathEntries,
                    customInstructions,
                    signal: this._compactionAbortController.signal,
                }));
                if (result?.cancel) {
                    throw new Error("Compaction cancelled");
                }
                if (result?.compaction) {
                    extensionCompaction = result.compaction;
                    fromExtension = true;
                }
            }
            let summary;
            let firstKeptEntryId;
            let tokensBefore;
            let details;
            if (extensionCompaction) {
                // Extension provided compaction content
                summary = extensionCompaction.summary;
                firstKeptEntryId = extensionCompaction.firstKeptEntryId;
                tokensBefore = extensionCompaction.tokensBefore;
                details = extensionCompaction.details;
            }
            else {
                // Generate compaction result
                const result = await compact(preparation, this.model, apiKey, headers, customInstructions, this._compactionAbortController.signal, this.thinkingLevel);
                summary = result.summary;
                firstKeptEntryId = result.firstKeptEntryId;
                tokensBefore = result.tokensBefore;
                details = result.details;
            }
            if (this._compactionAbortController.signal.aborted) {
                throw new Error("Compaction cancelled");
            }
            this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension);
            const newEntries = this.sessionManager.getEntries();
            const sessionContext = this.sessionManager.buildSessionContext();
            this.agent.state.messages = sessionContext.messages;
            // Get the saved compaction entry for the extension event
            const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary);
            if (this._extensionRunner && savedCompactionEntry) {
                await this._extensionRunner.emit({
                    type: "session_compact",
                    compactionEntry: savedCompactionEntry,
                    fromExtension,
                });
            }
            const compactionResult = {
                summary,
                firstKeptEntryId,
                tokensBefore,
                details,
            };
            this._emit({
                type: "compaction_end",
                reason: "manual",
                result: compactionResult,
                aborted: false,
                willRetry: false,
            });
            return compactionResult;
        }
        catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const aborted = message === "Compaction cancelled" || (error instanceof Error && error.name === "AbortError");
            this._emit({
                type: "compaction_end",
                reason: "manual",
                result: undefined,
                aborted,
                willRetry: false,
                errorMessage: aborted ? undefined : `Compaction failed: ${message}`,
            });
            throw error;
        }
        finally {
            this._compactionAbortController = undefined;
            this._reconnectToAgent();
        }
    }
    /**
     * Cancel in-progress compaction (manual or auto).
     */
    abortCompaction() {
        this._compactionAbortController?.abort();
        this._autoCompactionAbortController?.abort();
    }
    /**
     * Cancel in-progress branch summarization.
     */
    abortBranchSummary() {
        this._branchSummaryAbortController?.abort();
    }
    /**
     * Check if compaction is needed and run it.
     * Called after agent_end and before prompt submission.
     *
     * Two cases:
     * 1. Overflow: LLM returned context overflow error, remove error message from agent state, compact, auto-retry
     * 2. Threshold: Context over threshold, compact, NO auto-retry (user continues manually)
     *
     * @param assistantMessage The assistant message to check
     * @param skipAbortedCheck If false, include aborted messages (for pre-prompt check). Default: true
     */
    async _checkCompaction(assistantMessage, skipAbortedCheck = true) {
        const settings = this.settingsManager.getCompactionSettings();
        if (!settings.enabled)
            return;
        // Skip if message was aborted (user cancelled) - unless skipAbortedCheck is false
        if (skipAbortedCheck && assistantMessage.stopReason === "aborted")
            return;
        const contextWindow = this.model?.contextWindow ?? 0;
        // Skip overflow check if the message came from a different model.
        // This handles the case where user switched from a smaller-context model (e.g. opus)
        // to a larger-context model (e.g. codex) - the overflow error from the old model
        // shouldn't trigger compaction for the new model.
        const sameModel = this.model && assistantMessage.provider === this.model.provider && assistantMessage.model === this.model.id;
        // Skip compaction checks if this assistant message is older than the latest
        // compaction boundary. This prevents a stale pre-compaction usage/error
        // from retriggering compaction on the first prompt after compaction.
        const compactionEntry = getLatestCompactionEntry(this.sessionManager.getBranch());
        const assistantIsFromBeforeCompaction = compactionEntry !== null && assistantMessage.timestamp <= new Date(compactionEntry.timestamp).getTime();
        if (assistantIsFromBeforeCompaction) {
            return;
        }
        // Case 1: Overflow - LLM returned context overflow error
        if (sameModel && isContextOverflow(assistantMessage, contextWindow)) {
            const MAX_OVERFLOW_RETRIES = 3;
            if (this._overflowRecoveryLevel >= MAX_OVERFLOW_RETRIES) {
                this._emit({
                    type: "compaction_end",
                    reason: "overflow",
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                    errorMessage: `Context overflow recovery failed after ${MAX_OVERFLOW_RETRIES} progressive compact-and-retry attempts. Try reducing context or switching to a larger-context model.`,
                });
                return;
            }
            this._overflowRecoveryLevel++;
            const messages = this.agent.state.messages;
            if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
                this.agent.state.messages = messages.slice(0, -1);
            }
            await this._runAutoCompaction("overflow", true);
            return;
        }
        // Case 2: Threshold - context is getting large
        // For error messages (no usage data), estimate from last successful response.
        // This ensures sessions that hit persistent API errors (e.g. 529) can still compact.
        let contextTokens;
        if (assistantMessage.stopReason === "error") {
            const messages = this.agent.state.messages;
            const estimate = estimateContextTokens(messages);
            if (estimate.lastUsageIndex === null)
                return; // No usage data at all
            // Verify the usage source is post-compaction. Kept pre-compaction messages
            // have stale usage reflecting the old (larger) context and would falsely
            // trigger compaction right after one just finished.
            const usageMsg = messages[estimate.lastUsageIndex];
            if (compactionEntry &&
                usageMsg.role === "assistant" &&
                usageMsg.timestamp <= new Date(compactionEntry.timestamp).getTime()) {
                return;
            }
            contextTokens = estimate.tokens;
        }
        else {
            contextTokens = calculateContextTokens(assistantMessage.usage);
        }
        if (shouldCompact(contextTokens, contextWindow, settings)) {
            await this._runAutoCompaction("threshold", false);
        }
    }
    /**
     * Internal: Run auto-compaction with events.
     */
    async _runAutoCompaction(reason, willRetry) {
        const settings = this.settingsManager.getCompactionSettings();
        let overrideKeepRecentTokens;
        if (reason === "overflow" && this._overflowRecoveryLevel > 0) {
            const { PROGRESSIVE_COMPACT_LEVELS } = await import("./compaction/index.js");
            const levelIndex = Math.min(this._overflowRecoveryLevel - 1, PROGRESSIVE_COMPACT_LEVELS.length - 1);
            overrideKeepRecentTokens = PROGRESSIVE_COMPACT_LEVELS[levelIndex];
        }
        this._emit({ type: "compaction_start", reason });
        this._autoCompactionAbortController = new AbortController();
        try {
            if (!this.model) {
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                });
                return;
            }
            const authResult = await this._modelRegistry.getApiKeyAndHeaders(this.model);
            if (!authResult.ok || !authResult.apiKey) {
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                });
                return;
            }
            const { apiKey, headers } = authResult;
            const pathEntries = this.sessionManager.getBranch();
            const preparation = prepareCompaction(pathEntries, settings, overrideKeepRecentTokens);
            if (!preparation) {
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted: false,
                    willRetry: false,
                });
                return;
            }
            let extensionCompaction;
            let fromExtension = false;
            if (this._extensionRunner.hasHandlers("session_before_compact")) {
                const extensionResult = (await this._extensionRunner.emit({
                    type: "session_before_compact",
                    preparation,
                    branchEntries: pathEntries,
                    customInstructions: undefined,
                    signal: this._autoCompactionAbortController.signal,
                }));
                if (extensionResult?.cancel) {
                    this._emit({
                        type: "compaction_end",
                        reason,
                        result: undefined,
                        aborted: true,
                        willRetry: false,
                    });
                    return;
                }
                if (extensionResult?.compaction) {
                    extensionCompaction = extensionResult.compaction;
                    fromExtension = true;
                }
            }
            let summary;
            let firstKeptEntryId;
            let tokensBefore;
            let details;
            if (extensionCompaction) {
                // Extension provided compaction content
                summary = extensionCompaction.summary;
                firstKeptEntryId = extensionCompaction.firstKeptEntryId;
                tokensBefore = extensionCompaction.tokensBefore;
                details = extensionCompaction.details;
            }
            else {
                // Generate compaction result
                const compactResult = await compact(preparation, this.model, apiKey, headers, undefined, this._autoCompactionAbortController.signal, this.thinkingLevel);
                summary = compactResult.summary;
                firstKeptEntryId = compactResult.firstKeptEntryId;
                tokensBefore = compactResult.tokensBefore;
                details = compactResult.details;
            }
            if (this._autoCompactionAbortController.signal.aborted) {
                this._emit({
                    type: "compaction_end",
                    reason,
                    result: undefined,
                    aborted: true,
                    willRetry: false,
                });
                return;
            }
            this.sessionManager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details, fromExtension);
            const newEntries = this.sessionManager.getEntries();
            const sessionContext = this.sessionManager.buildSessionContext();
            this.agent.state.messages = sessionContext.messages;
            // Get the saved compaction entry for the extension event
            const savedCompactionEntry = newEntries.find((e) => e.type === "compaction" && e.summary === summary);
            if (this._extensionRunner && savedCompactionEntry) {
                await this._extensionRunner.emit({
                    type: "session_compact",
                    compactionEntry: savedCompactionEntry,
                    fromExtension,
                });
            }
            const result = {
                summary,
                firstKeptEntryId,
                tokensBefore,
                details,
            };
            this._emit({ type: "compaction_end", reason, result, aborted: false, willRetry });
            if (willRetry) {
                const messages = this.agent.state.messages;
                const lastMsg = messages[messages.length - 1];
                if (lastMsg?.role === "assistant" && lastMsg.stopReason === "error") {
                    this.agent.state.messages = messages.slice(0, -1);
                }
                setTimeout(() => {
                    this.agent.continue().catch(() => { });
                }, 100);
            }
            else if (this.agent.hasQueuedMessages()) {
                setTimeout(() => {
                    this.agent.continue().catch(() => { });
                }, 100);
            }
            // Reset overflow level on successful non-overflow compaction
            if (reason !== "overflow") {
                this._overflowRecoveryLevel = 0;
            }
        }
        catch (error) {
            const errorMessage = error instanceof Error ? error.message : "compaction failed";
            this._emit({
                type: "compaction_end",
                reason,
                result: undefined,
                aborted: false,
                willRetry: false,
                errorMessage: reason === "overflow"
                    ? `Context overflow recovery failed: ${errorMessage}`
                    : `Auto-compaction failed: ${errorMessage}`,
            });
        }
        finally {
            this._autoCompactionAbortController = undefined;
        }
    }
    /**
     * Toggle auto-compaction setting.
     */
    setAutoCompactionEnabled(enabled) {
        this.settingsManager.setCompactionEnabled(enabled);
    }
    /** Whether auto-compaction is enabled */
    get autoCompactionEnabled() {
        return this.settingsManager.getCompactionEnabled();
    }
    async bindExtensions(bindings) {
        if (bindings.uiContext !== undefined) {
            this._extensionUIContext = bindings.uiContext;
        }
        if (bindings.commandContextActions !== undefined) {
            this._extensionCommandContextActions = bindings.commandContextActions;
        }
        if (bindings.shutdownHandler !== undefined) {
            this._extensionShutdownHandler = bindings.shutdownHandler;
        }
        if (bindings.onError !== undefined) {
            this._extensionErrorListener = bindings.onError;
        }
        if (bindings.registerChannel !== undefined) {
            this._registerChannel = bindings.registerChannel;
            this._extensionRunner.flushPendingChannels(bindings.registerChannel);
            this._extensionRunner.updateRegisterChannel(bindings.registerChannel);
        }
        this._applyExtensionBindings(this._extensionRunner);
        await this._extensionRunner.emit({ ...this._sessionStartEvent, variables: this._currentAgentVariables });
        await this.extendResourcesFromExtensions(this._sessionStartEvent.reason === "reload" ? "reload" : "startup");
    }
    async extendResourcesFromExtensions(reason) {
        if (!this._extensionRunner.hasHandlers("resources_discover")) {
            return;
        }
        const { skillPaths, promptPaths, themePaths } = await this._extensionRunner.emitResourcesDiscover(this._cwd, reason);
        if (skillPaths.length === 0 && promptPaths.length === 0 && themePaths.length === 0) {
            return;
        }
        const extensionPaths = {
            skillPaths: this.buildExtensionResourcePaths(skillPaths),
            promptPaths: this.buildExtensionResourcePaths(promptPaths),
            themePaths: this.buildExtensionResourcePaths(themePaths),
        };
        this._resourceLoader.extendResources(extensionPaths);
        this._baseSystemPrompt = this._rebuildSystemPrompt(this.getActiveToolNames());
        this.agent.state.systemPrompt = this._baseSystemPrompt;
    }
    buildExtensionResourcePaths(entries) {
        return entries.map((entry) => {
            const source = this.getExtensionSourceLabel(entry.extensionPath);
            const baseDir = entry.extensionPath.startsWith("<") ? undefined : dirname(entry.extensionPath);
            return {
                path: entry.path,
                metadata: {
                    source,
                    scope: "temporary",
                    origin: "top-level",
                    baseDir,
                },
            };
        });
    }
    getExtensionSourceLabel(extensionPath) {
        if (extensionPath.startsWith("<")) {
            return `extension:${extensionPath.replace(/[<>]/g, "")}`;
        }
        const base = basename(extensionPath);
        const name = base.replace(/\.(ts|js)$/, "");
        return `extension:${name}`;
    }
    _applyExtensionBindings(runner) {
        runner.setUIContext(this._extensionUIContext);
        runner.bindCommandContext(this._extensionCommandContextActions);
        this._extensionErrorUnsubscriber?.();
        this._extensionErrorUnsubscriber = this._extensionErrorListener
            ? runner.onError(this._extensionErrorListener)
            : undefined;
    }
    _refreshCurrentModelFromRegistry() {
        const currentModel = this.model;
        if (!currentModel) {
            return;
        }
        const refreshedModel = this._modelRegistry.find(currentModel.provider, currentModel.id);
        if (!refreshedModel || refreshedModel === currentModel) {
            return;
        }
        this.agent.state.model = refreshedModel;
    }
    _bindExtensionCore(runner) {
        const getCommands = () => {
            const extensionCommands = runner.getRegisteredCommands().map((command) => ({
                name: command.invocationName,
                description: command.description,
                source: "extension",
                sourceInfo: command.sourceInfo,
            }));
            const templates = this.promptTemplates.map((template) => ({
                name: template.name,
                description: template.description,
                source: "prompt",
                sourceInfo: template.sourceInfo,
            }));
            const skills = this._resourceLoader.getSkills().skills.map((skill) => ({
                name: `skill:${skill.name}`,
                description: skill.description,
                source: "skill",
                sourceInfo: skill.sourceInfo,
            }));
            return [...extensionCommands, ...templates, ...skills];
        };
        runner.bindCore({
            sendMessage: (message, options) => {
                this.sendCustomMessage(message, options).catch((err) => {
                    runner.emitError({
                        extensionPath: "<runtime>",
                        event: "send_message",
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
            },
            sendUserMessage: (content, options) => {
                this.sendUserMessage(content, options).catch((err) => {
                    runner.emitError({
                        extensionPath: "<runtime>",
                        event: "send_user_message",
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
            },
            appendEntry: (customType, data, options) => {
                const id = this.sessionManager.appendCustomEntry(customType, data, options);
                this._emit({ type: "custom_entry", customType, data, id, display: options?.display });
                return id;
            },
            foldEntry: (entryId, summary, originalTokens) => {
                this.sessionManager.appendFold(entryId, summary, originalTokens);
            },
            deleteEntries: (targetIds) => {
                this.sessionManager.appendDeletion(targetIds);
            },
            summarizeEntries: (targetIds, summary) => {
                this.sessionManager.appendSegmentSummary(targetIds, summary);
            },
            setSessionName: (name) => {
                const oldName = this.sessionManager.getSessionName();
                const trimmed = name.trim();
                if (oldName === trimmed)
                    return;
                this.sessionManager.appendSessionInfo(name);
                this._emit({ type: "session_info_changed", name: trimmed });
                runner.emit({ type: "session_rename", oldName, newName: trimmed }).catch((err) => {
                    runner.emitError({
                        extensionPath: "<runtime>",
                        event: "session_rename",
                        error: err instanceof Error ? err.message : String(err),
                    });
                });
            },
            getSessionName: () => {
                return this.sessionManager.getSessionName();
            },
            setLabel: (entryId, label) => {
                this.sessionManager.appendLabelChange(entryId, label);
            },
            getActiveTools: () => this.getActiveToolNames(),
            getAllTools: () => this.getAllTools(),
            setActiveTools: (toolNames) => this.setActiveToolsByName(toolNames),
            refreshTools: () => this._refreshToolRegistry(),
            setToolOperationsProvider: (provider) => {
                this.toolOperationsProvider = provider;
            },
            getToolOperationsProvider: () => this.toolOperationsProvider,
            getCommands,
            setModel: async (model) => {
                if (!this.modelRegistry.hasConfiguredAuth(model))
                    return false;
                await this.setModel(model);
                return true;
            },
            getThinkingLevel: () => this.thinkingLevel,
            setThinkingLevel: (level) => this.setThinkingLevel(level),
            registerChannel: this._registerChannel ??
                ((name) => {
                    throw new Error(`registerChannel("${name}") is only available in RPC mode`);
                }),
            callLLM: (options) => this.callLLM(options),
            callLLMStructured: (opts) => this.callLLMStructured(opts),
            forkAgent: (prompt, opts) => this.forkAgent(prompt, opts),
            background: (fn) => this.background(fn),
        }, {
            getModel: () => this.model,
            isIdle: () => !this.isStreaming,
            getSignal: () => this.agent.signal,
            getSessionSignal: () => this._sessionAbortController.signal,
            abort: () => this.abort(),
            hasPendingMessages: () => this.pendingMessageCount > 0,
            shutdown: () => {
                this._extensionShutdownHandler?.();
            },
            getContextUsage: () => this.getContextUsage(),
            compact: (options) => {
                void (async () => {
                    try {
                        const result = await this.compact(options?.customInstructions);
                        options?.onComplete?.(result);
                    }
                    catch (error) {
                        const err = error instanceof Error ? error : new Error(String(error));
                        options?.onError?.(err);
                    }
                })();
            },
            getSystemPrompt: () => this.systemPrompt,
        }, {
            registerProvider: (name, config) => {
                this._modelRegistry.registerProvider(name, config);
                this._refreshCurrentModelFromRegistry();
            },
            unregisterProvider: (name) => {
                this._modelRegistry.unregisterProvider(name);
                this._refreshCurrentModelFromRegistry();
            },
        });
    }
    _refreshToolRegistry(options) {
        const previousRegistryNames = new Set(this._toolRegistry.keys());
        const previousActiveToolNames = this.getActiveToolNames();
        const allowedToolNames = this._allowedToolNames;
        const isAllowedTool = (name) => !allowedToolNames || allowedToolNames.has(name);
        const registeredTools = this._extensionRunner.getAllRegisteredTools();
        const mcpTools = [...this._mcpToolDefinitions.values()]
            .filter((def) => isAllowedTool(def.name))
            .map((definition) => ({
            definition,
            sourceInfo: createSyntheticSourceInfo(`<mcp:${definition.name}>`, { source: "mcp" }),
        }));
        const allCustomTools = [
            ...registeredTools,
            ...this._customTools.map((definition) => ({
                definition,
                sourceInfo: createSyntheticSourceInfo(`<sdk:${definition.name}>`, { source: "sdk" }),
            })),
            ...mcpTools,
        ].filter((tool) => isAllowedTool(tool.definition.name));
        const definitionRegistry = new Map(Array.from(this._baseToolDefinitions.entries())
            .filter(([name]) => isAllowedTool(name))
            .map(([name, definition]) => [
            name,
            {
                definition,
                sourceInfo: createSyntheticSourceInfo(`<builtin:${name}>`, { source: "builtin" }),
            },
        ]));
        for (const tool of allCustomTools) {
            definitionRegistry.set(tool.definition.name, {
                definition: tool.definition,
                sourceInfo: tool.sourceInfo,
            });
        }
        this._toolDefinitions = definitionRegistry;
        this._toolPromptSnippets = new Map(Array.from(definitionRegistry.values())
            .map(({ definition }) => {
            const snippet = this._normalizePromptSnippet(definition.promptSnippet);
            return snippet ? [definition.name, snippet] : undefined;
        })
            .filter((entry) => entry !== undefined));
        this._toolPromptGuidelines = new Map(Array.from(definitionRegistry.values())
            .map(({ definition }) => {
            const guidelines = this._normalizePromptGuidelines(definition.promptGuidelines);
            return guidelines.length > 0 ? [definition.name, guidelines] : undefined;
        })
            .filter((entry) => entry !== undefined));
        const runner = this._extensionRunner;
        const wrappedExtensionTools = wrapRegisteredTools(allCustomTools, runner);
        const wrappedBuiltInTools = wrapRegisteredTools(Array.from(this._baseToolDefinitions.values())
            .filter((definition) => isAllowedTool(definition.name))
            .map((definition) => ({
            definition,
            sourceInfo: createSyntheticSourceInfo(`<builtin:${definition.name}>`, { source: "builtin" }),
        })), runner);
        const toolRegistry = new Map(wrappedBuiltInTools.map((tool) => [tool.name, tool]));
        for (const tool of wrappedExtensionTools) {
            toolRegistry.set(tool.name, tool);
        }
        this._toolRegistry = toolRegistry;
        const nextActiveToolNames = (options?.activeToolNames ? [...options.activeToolNames] : [...previousActiveToolNames]).filter((name) => isAllowedTool(name));
        if (allowedToolNames) {
            for (const toolName of this._toolRegistry.keys()) {
                if (allowedToolNames.has(toolName)) {
                    nextActiveToolNames.push(toolName);
                }
            }
        }
        else if (options?.includeAllExtensionTools) {
            for (const tool of wrappedExtensionTools) {
                nextActiveToolNames.push(tool.name);
            }
        }
        else if (!options?.activeToolNames) {
            for (const toolName of this._toolRegistry.keys()) {
                if (!previousRegistryNames.has(toolName)) {
                    nextActiveToolNames.push(toolName);
                }
            }
        }
        this.setActiveToolsByName([...new Set(nextActiveToolNames)]);
    }
    _buildRuntime(options) {
        const autoResizeImages = this.settingsManager.getImageAutoResize();
        const shellCommandPrefix = this.settingsManager.getShellCommandPrefix();
        const shellPath = this.settingsManager.getShellPath();
        const providerOptions = this._toolOperationsProvider
            ? toolsOptionsFromProvider(this._toolOperationsProvider)
            : {};
        const baseToolDefinitions = this._baseToolsOverride
            ? Object.fromEntries(Object.entries(this._baseToolsOverride).map(([name, tool]) => [
                name,
                createToolDefinitionFromAgentTool(tool),
            ]))
            : createAllToolDefinitions(this._cwd, {
                read: { autoResizeImages, ...providerOptions.read },
                bash: { commandPrefix: shellCommandPrefix, shellPath, ...providerOptions.bash },
                write: providerOptions.write,
                edit: providerOptions.edit,
                grep: providerOptions.grep,
                find: providerOptions.find,
                ls: providerOptions.ls,
            });
        this._baseToolDefinitions = new Map(Object.entries(baseToolDefinitions).map(([name, tool]) => [name, tool]));
        const extensionsResult = this._resourceLoader.getExtensions();
        if (options.flagValues) {
            for (const [name, value] of options.flagValues) {
                extensionsResult.runtime.flagValues.set(name, value);
            }
        }
        this._extensionRunner = new ExtensionRunner(extensionsResult.extensions, extensionsResult.runtime, this._cwd, this.sessionManager, this._modelRegistry);
        // Register SessionManager callback to detect entry lifecycle changes
        // and emit entries_invalidated events to extensions.
        this.sessionManager.setOnEntryAppended((entry) => {
            if (entry.type === "deletion") {
                const e = entry;
                this._emitEntriesInvalidated(e.targetIds, "deletion", e.id);
            }
            else if (entry.type === "fold") {
                const e = entry;
                this._emitEntriesInvalidated([e.targetId], "fold", e.id);
            }
            else if (entry.type === "segment_summary") {
                const e = entry;
                this._emitEntriesInvalidated(e.targetIds, "segment_summary", e.id);
            }
        });
        const projectRoot = resolveProjectIdentity(this._cwd);
        this._extensionRunner.setContextDirFns({
            getProjectRoot: () => projectRoot,
            getSessionDataDir: (extName) => getSessionDataDir(this.sessionManager.getSessionDir(), this.sessionManager.getSessionId(), extName),
            getProjectDataDir: (extName) => getProjectDataDir(projectRoot, extName),
            getCwdDataDir: (extName) => getCwdDataDir(this._cwd, extName),
            getGlobalDataDir: (extName) => getGlobalDataDir(extName),
        });
        if (this._extensionRunnerRef) {
            this._extensionRunnerRef.current = this._extensionRunner;
        }
        this._bindExtensionCore(this._extensionRunner);
        this._applyExtensionBindings(this._extensionRunner);
        this._initFileSnapshotManager();
        const defaultActiveToolNames = this._baseToolsOverride
            ? Object.keys(this._baseToolsOverride)
            : ["read", "bash", "edit", "write"];
        const baseActiveToolNames = options.activeToolNames ?? defaultActiveToolNames;
        this._refreshToolRegistry({
            activeToolNames: baseActiveToolNames,
            includeAllExtensionTools: options.includeAllExtensionTools,
        });
        this._initMcpServers();
    }
    async reload() {
        const previousFlagValues = this._extensionRunner.getFlagValues();
        await emitSessionShutdownEvent(this._extensionRunner, {
            type: "session_shutdown",
            reason: "reload",
            variables: this._currentAgentVariables,
        });
        await this.settingsManager.reload();
        resetApiProviders();
        await this._resourceLoader.reload();
        // Capture the old runner before _buildRuntime replaces it.
        const oldRunner = this._extensionRunner;
        this._buildRuntime({
            activeToolNames: this.getActiveToolNames(),
            flagValues: previousFlagValues,
            includeAllExtensionTools: true,
        });
        // Instead of invalidating the old runner (which would throw stale errors
        // for any captured pi/ctx from the old session), retarget it to the new
        // runner's state. This way, old async operations (timeouts, background
        // tasks, channel handlers) transparently delegate to the new runtime.
        oldRunner.retarget(this._extensionRunner);
        // Flush pending channel registrations on the new runner so that extensions
        // (e.g. coordinator) can communicate immediately after reload without
        // requiring an explicit rebindSession() call from the host mode.
        if (this._registerChannel) {
            this._extensionRunner.flushPendingChannels(this._registerChannel);
            this._extensionRunner.updateRegisterChannel(this._registerChannel);
        }
        const hasBindings = this._extensionUIContext ||
            this._extensionCommandContextActions ||
            this._extensionShutdownHandler ||
            this._extensionErrorListener;
        if (hasBindings) {
            await this._extensionRunner.emit({
                type: "session_start",
                reason: "reload",
                variables: this._currentAgentVariables,
            });
            await this.extendResourcesFromExtensions("reload");
        }
    }
    // =========================================================================
    // Auto-Retry
    // =========================================================================
    /**
     * Check if an error is retryable (overloaded, rate limit, server errors).
     * Context overflow errors are NOT retryable (handled by compaction instead).
     */
    _isRetryableError(message) {
        if (message.stopReason !== "error" || !message.errorMessage)
            return false;
        // Context overflow is handled by compaction, not retry
        const contextWindow = this.model?.contextWindow ?? 0;
        if (isContextOverflow(message, contextWindow))
            return false;
        return isRetryableError(message.errorMessage);
    }
    /**
     * Handle retryable errors with exponential backoff.
     * @returns true if retry was initiated, false if max retries exceeded or disabled
     */
    async _handleRetryableError(message) {
        const settings = this.settingsManager.getRetrySettings();
        if (!settings.enabled) {
            this._resolveRetry();
            return false;
        }
        // Retry promise is created synchronously in _handleAgentEvent for agent_end.
        // Keep a defensive fallback here in case a future refactor bypasses that path.
        if (!this._retryPromise) {
            this._retryPromise = new Promise((resolve) => {
                this._retryResolve = resolve;
            });
        }
        this._retryAttempt++;
        if (this._retryAttempt > settings.maxRetries) {
            // Max retries exceeded, emit final failure and reset
            this._emit({
                type: "auto_retry_end",
                success: false,
                attempt: this._retryAttempt - 1,
                finalError: message.errorMessage,
            });
            this._retryAttempt = 0;
            this._resolveRetry(); // Resolve so waitForRetry() completes
            return false;
        }
        const delayMs = settings.baseDelayMs * 2 ** (this._retryAttempt - 1);
        this._emit({
            type: "auto_retry_start",
            attempt: this._retryAttempt,
            maxAttempts: settings.maxRetries,
            delayMs,
            errorMessage: message.errorMessage || "Unknown error",
        });
        // Remove error message from agent state (keep in session for history)
        const messages = this.agent.state.messages;
        if (messages.length > 0 && messages[messages.length - 1].role === "assistant") {
            this.agent.state.messages = messages.slice(0, -1);
        }
        // Wait with exponential backoff (abortable)
        this._retryAbortController = new AbortController();
        try {
            await sleep(delayMs, this._retryAbortController.signal);
        }
        catch {
            // Aborted during sleep - emit end event so UI can clean up
            const attempt = this._retryAttempt;
            this._retryAttempt = 0;
            this._retryAbortController = undefined;
            this._emit({
                type: "auto_retry_end",
                success: false,
                attempt,
                finalError: "Retry cancelled",
            });
            this._resolveRetry();
            return false;
        }
        this._retryAbortController = undefined;
        // Retry via continue() - use setTimeout to break out of event handler chain
        setTimeout(() => {
            this.agent.continue().catch(() => {
                // Retry failed - will be caught by next agent_end
            });
        }, 0);
        return true;
    }
    /**
     * Cancel in-progress retry.
     */
    abortRetry() {
        this._retryAbortController?.abort();
        // Note: _retryAttempt is reset in the catch block of _autoRetry
        this._resolveRetry();
    }
    /**
     * Wait for any in-progress retry to complete.
     * Returns immediately if no retry is in progress.
     */
    async waitForRetry() {
        if (!this._retryPromise) {
            return;
        }
        await this._retryPromise;
        await this.agent.waitForIdle();
    }
    /** Whether auto-retry is currently in progress */
    get isRetrying() {
        return this._retryPromise !== undefined;
    }
    /** Whether auto-retry is enabled */
    get autoRetryEnabled() {
        return this.settingsManager.getRetryEnabled();
    }
    /**
     * Toggle auto-retry setting.
     */
    setAutoRetryEnabled(enabled) {
        this.settingsManager.setRetryEnabled(enabled);
    }
    // =========================================================================
    // Bash Execution
    // =========================================================================
    /**
     * Execute a bash command.
     * Adds result to agent context and session.
     * @param command The bash command to execute
     * @param onChunk Optional streaming callback for output
     * @param options.excludeFromContext If true, command output won't be sent to LLM (!! prefix)
     * @param options.operations Custom BashOperations for remote execution
     */
    async executeBash(command, onChunk, options) {
        this._bashAbortController = new AbortController();
        // Apply command prefix if configured (e.g., "shopt -s expand_aliases" for alias support)
        const prefix = this.settingsManager.getShellCommandPrefix();
        const shellPath = this.settingsManager.getShellPath();
        const resolvedCommand = prefix ? `${prefix}\n${command}` : command;
        try {
            const result = await executeBashWithOperations(resolvedCommand, this.sessionManager.getCwd(), options?.operations ?? createLocalBashOperations({ shellPath }), {
                onChunk,
                signal: this._bashAbortController.signal,
            });
            this.recordBashResult(command, result, options);
            return result;
        }
        finally {
            this._bashAbortController = undefined;
        }
    }
    /**
     * Record a bash execution result in session history.
     * Used by executeBash and by extensions that handle bash execution themselves.
     */
    recordBashResult(command, result, options) {
        const bashMessage = {
            role: "bashExecution",
            command,
            output: result.output,
            exitCode: result.exitCode,
            cancelled: result.cancelled,
            truncated: result.truncated,
            fullOutputPath: result.fullOutputPath,
            timestamp: Date.now(),
            excludeFromContext: options?.excludeFromContext,
        };
        // If agent is streaming, defer adding to avoid breaking tool_use/tool_result ordering
        if (this.isStreaming) {
            // Queue for later - will be flushed on agent_end
            this._pendingBashMessages.push(bashMessage);
        }
        else {
            // Add to agent state immediately
            this.agent.state.messages.push(bashMessage);
            // Save to session
            this.sessionManager.appendMessage(bashMessage);
        }
    }
    /**
     * Cancel running bash command.
     */
    abortBash() {
        this._bashAbortController?.abort();
    }
    /** Whether a bash command is currently running */
    get isBashRunning() {
        return this._bashAbortController !== undefined;
    }
    /** Whether there are pending bash messages waiting to be flushed */
    get hasPendingBashMessages() {
        return this._pendingBashMessages.length > 0;
    }
    /**
     * Flush pending bash messages to agent state and session.
     * Called after agent turn completes to maintain proper message ordering.
     */
    _flushPendingBashMessages() {
        if (this._pendingBashMessages.length === 0)
            return;
        for (const bashMessage of this._pendingBashMessages) {
            // Add to agent state
            this.agent.state.messages.push(bashMessage);
            // Save to session
            this.sessionManager.appendMessage(bashMessage);
        }
        this._pendingBashMessages = [];
    }
    // =========================================================================
    // Session Management
    // =========================================================================
    /**
     * Set a display name for the current session.
     */
    setSessionName(name) {
        this.sessionManager.appendSessionInfo(name);
        this._emit({ type: "session_info_changed", name: this.sessionManager.getSessionName() });
    }
    // =========================================================================
    // Tree Navigation
    // =========================================================================
    /**
     * Navigate to a different node in the session tree.
     * Unlike fork() which creates a new session file, this stays in the same file.
     *
     * @param targetId The entry ID to navigate to
     * @param options.summarize Whether user wants to summarize abandoned branch
     * @param options.customInstructions Custom instructions for summarizer
     * @param options.replaceInstructions If true, customInstructions replaces the default prompt
     * @param options.label Label to attach to the branch summary entry
     * @returns Result with editorText (if user message) and cancelled status
     */
    async navigateTree(targetId, options = {}) {
        // Block rollback while agent is actively streaming
        if (this.isStreaming) {
            return { cancelled: true, reason: "Cannot rollback while agent is streaming" };
        }
        const oldLeafId = this.sessionManager.getLeafId();
        // No-op if already at target
        if (targetId === oldLeafId) {
            return { cancelled: false };
        }
        // Model required for summarization
        if (options.summarize && !this.model) {
            throw new Error("No model available for summarization");
        }
        const targetEntry = this.sessionManager.getEntry(targetId);
        if (!targetEntry) {
            throw new Error(`Entry ${targetId} not found`);
        }
        // Collect entries to summarize (from old leaf to common ancestor)
        const { entries: entriesToSummarize, commonAncestorId } = collectEntriesForBranchSummary(this.sessionManager, oldLeafId, targetId);
        // Prepare event data - mutable so extensions can override
        let customInstructions = options.customInstructions;
        let replaceInstructions = options.replaceInstructions;
        let label = options.label;
        const preparation = {
            targetId,
            oldLeafId,
            commonAncestorId,
            entriesToSummarize,
            userWantsSummary: options.summarize ?? false,
            customInstructions,
            replaceInstructions,
            label,
            skipFiles: options.skipFiles,
        };
        // Set up abort controller for summarization
        this._branchSummaryAbortController = new AbortController();
        try {
            let extensionSummary;
            let fromExtension = false;
            // Emit session_before_tree event
            if (this._extensionRunner.hasHandlers("session_before_tree")) {
                const result = (await this._extensionRunner.emit({
                    type: "session_before_tree",
                    preparation,
                    signal: this._branchSummaryAbortController.signal,
                }));
                if (result?.cancel) {
                    return { cancelled: true };
                }
                if (result?.summary && options.summarize) {
                    extensionSummary = result.summary;
                    fromExtension = true;
                }
                // Allow extensions to override instructions and label
                if (result?.customInstructions !== undefined) {
                    customInstructions = result.customInstructions;
                }
                if (result?.replaceInstructions !== undefined) {
                    replaceInstructions = result.replaceInstructions;
                }
                if (result?.label !== undefined) {
                    label = result.label;
                }
            }
            // Run default summarizer if needed
            let summaryText;
            let summaryDetails;
            if (options.summarize && entriesToSummarize.length > 0 && !extensionSummary) {
                const model = this.model;
                const { apiKey, headers } = await this._getRequiredRequestAuth(model);
                const branchSummarySettings = this.settingsManager.getBranchSummarySettings();
                const result = await generateBranchSummary(entriesToSummarize, {
                    model,
                    apiKey,
                    headers,
                    signal: this._branchSummaryAbortController.signal,
                    customInstructions,
                    replaceInstructions,
                    reserveTokens: branchSummarySettings.reserveTokens,
                });
                if (result.aborted) {
                    return { cancelled: true, aborted: true };
                }
                if (result.error) {
                    throw new Error(result.error);
                }
                summaryText = result.summary;
                summaryDetails = {
                    readFiles: result.readFiles || [],
                    modifiedFiles: result.modifiedFiles || [],
                };
            }
            else if (extensionSummary) {
                summaryText = extensionSummary.summary;
                summaryDetails = extensionSummary.details;
            }
            // Determine the new leaf position based on target type
            let newLeafId;
            let editorText;
            if (targetEntry.type === "message" && targetEntry.message.role === "user") {
                // User message: skip custom ancestors (e.g. memory_prefetch) then leaf = first non-custom ancestor
                newLeafId = this.sessionManager.findBranchPointAbove(targetId);
                editorText = this._extractUserMessageText(targetEntry.message.content);
            }
            else if (targetEntry.type === "custom_message") {
                // Custom message: skip custom ancestors then leaf = first non-custom ancestor
                newLeafId = this.sessionManager.findBranchPointAbove(targetId);
                editorText =
                    typeof targetEntry.content === "string"
                        ? targetEntry.content
                        : targetEntry.content
                            .filter((c) => c.type === "text")
                            .map((c) => c.text)
                            .join("");
            }
            else {
                // Non-user message: leaf = selected node
                newLeafId = targetId;
            }
            // Safety guard removed: the tree is always preserved on disk, so navigateTree
            // never destroys data. Users can always navigateTree back to any node.
            // The previous guard blocked legitimate rollback-to-root operations.
            // Switch leaf (with or without summary)
            // Summary is attached at the navigation target position (newLeafId), not the old branch
            let summaryEntry;
            if (summaryText) {
                // Create summary at target position (can be null for root)
                const summaryId = this.sessionManager.branchWithSummary(newLeafId, summaryText, summaryDetails, fromExtension);
                summaryEntry = this.sessionManager.getEntry(summaryId);
                // Attach label to the summary entry
                if (label) {
                    this.sessionManager.appendLabelChange(summaryId, label);
                }
            }
            else if (newLeafId === null) {
                // No summary, navigating to root - reset leaf
                await this.sessionManager.resetLeaf();
            }
            else {
                // No summary, navigating to non-root
                await this.sessionManager.branch(newLeafId);
            }
            // Attach label to target entry when not summarizing (no summary entry to label)
            if (label && !summaryText) {
                this.sessionManager.appendLabelChange(targetId, label);
            }
            // Update agent state
            const sessionContext = this.sessionManager.buildSessionContext();
            this.agent.state.messages = sessionContext.messages;
            // Emit session_tree event
            await this._extensionRunner.emit({
                type: "session_tree",
                newLeafId: this.sessionManager.getLeafId(),
                oldLeafId,
                summaryEntry,
                fromExtension: summaryText ? fromExtension : undefined,
                skipFiles: options.skipFiles,
            });
            // Emit to custom tools
            return { editorText, cancelled: false, summaryEntry };
        }
        finally {
            this._branchSummaryAbortController = undefined;
        }
    }
    /**
     * Get all user messages from session for fork selector.
     */
    getUserMessagesForForking() {
        const entries = this.sessionManager.getEntries();
        const result = [];
        for (const entry of entries) {
            if (entry.type !== "message")
                continue;
            if (entry.message.role !== "user")
                continue;
            const text = this._extractUserMessageText(entry.message.content);
            if (text) {
                result.push({ entryId: entry.id, text });
            }
        }
        return result;
    }
    _extractUserMessageText(content) {
        if (typeof content === "string")
            return content;
        if (Array.isArray(content)) {
            return content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("");
        }
        return "";
    }
    /**
     * Get session statistics.
     */
    getSessionStats() {
        const state = this.state;
        const userMessages = state.messages.filter((m) => m.role === "user").length;
        const assistantMessages = state.messages.filter((m) => m.role === "assistant").length;
        const toolResults = state.messages.filter((m) => m.role === "toolResult").length;
        let toolCalls = 0;
        let totalInput = 0;
        let totalOutput = 0;
        let totalCacheRead = 0;
        let totalCacheWrite = 0;
        let totalCost = 0;
        for (const message of state.messages) {
            if (message.role === "assistant") {
                const assistantMsg = message;
                toolCalls += assistantMsg.content.filter((c) => c.type === "toolCall").length;
                totalInput += assistantMsg.usage.input;
                totalOutput += assistantMsg.usage.output;
                totalCacheRead += assistantMsg.usage.cacheRead;
                totalCacheWrite += assistantMsg.usage.cacheWrite;
                totalCost += assistantMsg.usage.cost.total;
            }
        }
        return {
            sessionFile: this.sessionFile,
            sessionId: this.sessionId,
            userMessages,
            assistantMessages,
            toolCalls,
            toolResults,
            totalMessages: state.messages.length,
            tokens: {
                input: totalInput,
                output: totalOutput,
                cacheRead: totalCacheRead,
                cacheWrite: totalCacheWrite,
                total: totalInput + totalOutput + totalCacheRead + totalCacheWrite,
            },
            cost: totalCost,
            contextUsage: this.getContextUsage(),
        };
    }
    getContextUsage() {
        const model = this.model;
        if (!model)
            return undefined;
        const contextWindow = model.contextWindow ?? 0;
        if (contextWindow <= 0)
            return undefined;
        // After compaction, the last assistant usage reflects pre-compaction context size.
        // We can only trust usage from an assistant that responded after the latest compaction.
        // If no such assistant exists, context token count is unknown until the next LLM response.
        const branchEntries = this.sessionManager.getBranch();
        const latestCompaction = getLatestCompactionEntry(branchEntries);
        if (latestCompaction) {
            // Check if there's a valid assistant usage after the compaction boundary
            const compactionIndex = branchEntries.lastIndexOf(latestCompaction);
            let hasPostCompactionUsage = false;
            for (let i = branchEntries.length - 1; i > compactionIndex; i--) {
                const entry = branchEntries[i];
                if (entry.type === "message" && entry.message.role === "assistant") {
                    const assistant = entry.message;
                    if (assistant.stopReason !== "aborted" && assistant.stopReason !== "error") {
                        const contextTokens = calculateContextTokens(assistant.usage);
                        if (contextTokens > 0) {
                            hasPostCompactionUsage = true;
                        }
                        break;
                    }
                }
            }
            if (!hasPostCompactionUsage) {
                return { tokens: null, contextWindow, percent: null };
            }
        }
        const estimate = estimateContextTokens(this.messages);
        const percent = (estimate.tokens / contextWindow) * 100;
        return {
            tokens: estimate.tokens,
            contextWindow,
            percent,
        };
    }
    /**
     * Export session to HTML.
     * @param outputPath Optional output path (defaults to session directory)
     * @returns Path to exported file
     */
    async exportToHtml(outputPath) {
        const themeName = this.settingsManager.getTheme();
        // Create tool renderer if we have an extension runner (for custom tool HTML rendering)
        const toolRenderer = createToolHtmlRenderer({
            getToolDefinition: (name) => this.getToolDefinition(name),
            theme,
            cwd: this.sessionManager.getCwd(),
        });
        return await exportSessionToHtml(this.sessionManager, this.state, {
            outputPath,
            themeName,
            toolRenderer,
        });
    }
    /**
     * Export the current session branch to a JSONL file.
     * Writes the session header followed by all entries on the current branch path.
     * @param outputPath Target file path. If omitted, generates a timestamped file in cwd.
     * @returns The resolved output file path.
     */
    exportToJsonl(outputPath) {
        const filePath = resolve(outputPath ?? `session-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
        const dir = dirname(filePath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const header = {
            type: "session",
            version: CURRENT_SESSION_VERSION,
            id: this.sessionManager.getSessionId(),
            timestamp: new Date().toISOString(),
            cwd: this.sessionManager.getCwd(),
        };
        const branchEntries = this.sessionManager.getBranch();
        const lines = [JSON.stringify(header)];
        // Re-chain parentIds to form a linear sequence
        let prevId = null;
        for (const entry of branchEntries) {
            const linear = { ...entry, parentId: prevId };
            lines.push(JSON.stringify(linear));
            prevId = entry.id;
        }
        writeFileSync(filePath, `${lines.join("\n")}\n`);
        return filePath;
    }
    // =========================================================================
    // Utilities
    // =========================================================================
    /**
     * Get text content of last assistant message.
     * Useful for /copy command.
     * @returns Text content, or undefined if no assistant message exists
     */
    getLastAssistantText() {
        const lastAssistant = this.messages
            .slice()
            .reverse()
            .find((m) => {
            if (m.role !== "assistant")
                return false;
            const msg = m;
            // Skip aborted messages with no content
            if (msg.stopReason === "aborted" && msg.content.length === 0)
                return false;
            return true;
        });
        if (!lastAssistant)
            return undefined;
        let text = "";
        for (const content of lastAssistant.content) {
            if (content.type === "text") {
                text += content.text;
            }
        }
        return text.trim() || undefined;
    }
    // =========================================================================
    // Extension System
    // =========================================================================
    createReplacedSessionContext() {
        const context = Object.defineProperties({}, Object.getOwnPropertyDescriptors(this._extensionRunner.createCommandContext()));
        context.sendMessage = (message, options) => this.sendCustomMessage(message, options);
        context.sendUserMessage = (content, options) => this.sendUserMessage(content, options);
        return context;
    }
    /**
     * Check if extensions have handlers for a specific event type.
     */
    hasExtensionHandlers(eventType) {
        return this._extensionRunner.hasHandlers(eventType);
    }
    /**
     * Get the extension runner (for setting UI context and error handlers).
     */
    get extensionRunner() {
        return this._extensionRunner;
    }
    async _resolveOptionalModel(modelSpec) {
        if (modelSpec) {
            const aliasResolved = resolveModelAlias(modelSpec, this._tierModels);
            const resolved = aliasResolved ?? modelSpec;
            const available = await this._modelRegistry.getAvailable();
            const found = available.find((m) => m.id === resolved || `${m.provider}/${m.id}` === resolved);
            return found ?? this.model;
        }
        return this.model;
    }
    async callLLM(options) {
        const model = await this._resolveOptionalModel(options.model);
        if (!model)
            throw new Error("No model selected");
        const auth = await this._modelRegistry.getApiKeyAndHeaders(model);
        if (!auth?.ok) {
            throw new Error(auth?.error ?? `No API key configured for ${model.provider}`);
        }
        if (!auth.apiKey) {
            throw new Error(`No API key configured for ${model.provider}`);
        }
        if (options.signal?.aborted) {
            throw new Error("Aborted");
        }
        const messages = options.messages.map((m) => ({
            role: m.role,
            content: [{ type: "text", text: m.content }],
            timestamp: Date.now(),
        }));
        if (!options.tools || options.tools.length === 0) {
            const context = {
                systemPrompt: options.systemPrompt,
                messages,
            };
            const providerRetry = this.settingsManager.getProviderRetrySettings();
            const completeOpts = {
                apiKey: auth.apiKey,
                headers: auth.headers,
                maxTokens: options.maxTokens,
                signal: options.signal,
                timeoutMs: options.timeoutMs ?? providerRetry.timeoutMs ?? 60_000,
                maxRetries: providerRetry.maxRetries ?? 2,
            };
            const doCall = () => complete(model, context, completeOpts);
            let response;
            let retryAttempt = 0;
            try {
                response = options.retry
                    ? await withRetry(doCall, {
                        maxRetries: options.retry.maxRetries,
                        baseDelayMs: options.retry.baseDelayMs ?? 5000,
                        signal: options.signal,
                        onRetry: (info) => {
                            retryAttempt = info.attempt;
                            this._emit({
                                type: "auto_retry_start",
                                attempt: info.attempt,
                                maxAttempts: info.maxAttempts,
                                delayMs: info.delayMs,
                                errorMessage: info.error instanceof Error ? info.error.message : String(info.error),
                            });
                        },
                    })
                    : await doCall();
            }
            catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                if (isRetryableError(err)) {
                    this._emit({ type: "extension_llm_error", error: errMsg });
                }
                if (options.retry) {
                    this._emit({ type: "auto_retry_end", success: false, attempt: retryAttempt, finalError: errMsg });
                }
                throw err;
            }
            return response.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n");
        }
        const toolInstances = options.tools
            .map((name) => {
            try {
                const registered = this._toolRegistry.get(name);
                if (registered)
                    return registered;
                return createTool(name, this._cwd);
            }
            catch {
                return undefined;
            }
        })
            .filter((t) => t !== undefined);
        if (toolInstances.length === 0) {
            const context = {
                systemPrompt: options.systemPrompt,
                messages,
            };
            const providerRetry = this.settingsManager.getProviderRetrySettings();
            const completeOpts = {
                apiKey: auth.apiKey,
                headers: auth.headers,
                maxTokens: options.maxTokens,
                signal: options.signal,
                timeoutMs: options.timeoutMs ?? providerRetry.timeoutMs ?? 60_000,
                maxRetries: providerRetry.maxRetries ?? 2,
            };
            const doCall = () => complete(model, context, completeOpts);
            let response;
            let retryAttempt = 0;
            try {
                response = options.retry
                    ? await withRetry(doCall, {
                        maxRetries: options.retry.maxRetries,
                        baseDelayMs: options.retry.baseDelayMs ?? 5000,
                        signal: options.signal,
                        onRetry: (info) => {
                            retryAttempt = info.attempt;
                            this._emit({
                                type: "auto_retry_start",
                                attempt: info.attempt,
                                maxAttempts: info.maxAttempts,
                                delayMs: info.delayMs,
                                errorMessage: info.error instanceof Error ? info.error.message : String(info.error),
                            });
                        },
                    })
                    : await doCall();
            }
            catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                if (isRetryableError(err)) {
                    this._emit({ type: "extension_llm_error", error: errMsg });
                }
                if (options.retry) {
                    this._emit({ type: "auto_retry_end", success: false, attempt: retryAttempt, finalError: errMsg });
                }
                throw err;
            }
            return response.content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n");
        }
        const agent = new Agent({
            getApiKey: () => auth.apiKey,
            initialState: {
                systemPrompt: options.systemPrompt ?? "",
                model,
                thinkingLevel: "off",
                tools: toolInstances,
                messages: [],
            },
        });
        if (options.signal?.aborted) {
            throw new Error("Aborted");
        }
        let resultText = "";
        const unsub = agent.subscribe((event) => {
            if (event.type === "message_end" && "message" in event) {
                const msg = event.message;
                if (msg.role === "assistant") {
                    const content = msg.content;
                    if (Array.isArray(content)) {
                        resultText = content
                            .filter((c) => c.type === "text")
                            .map((c) => c.text)
                            .join("\n");
                    }
                }
            }
        });
        try {
            await agent.prompt({
                role: "user",
                content: [{ type: "text", text: options.messages[0]?.content ?? "" }],
                timestamp: Date.now(),
            });
        }
        finally {
            unsub();
        }
        return resultText;
    }
    async callLLMStructured(options) {
        const maxRetries = options.maxRetries ?? 0;
        let lastError;
        const schemaJson = JSON.stringify(options.schema);
        const structuredSystemPrompt = (options.systemPrompt ?? "") +
            `\n\nRespond with valid JSON matching this schema:\n${schemaJson}\n\nRespond with JSON only, no markdown.`;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            const messages = attempt === 0
                ? options.messages
                : [
                    ...options.messages,
                    { role: "assistant", content: lastError?.raw ?? "" },
                    {
                        role: "user",
                        content: `Your previous response was invalid: ${lastError?.message}. Please respond with valid JSON matching the schema.`,
                    },
                ];
            const raw = await this.callLLM({
                ...options,
                systemPrompt: structuredSystemPrompt,
                messages,
            });
            try {
                const cleaned = stripMarkdownCodeBlock(raw);
                const parsed = JSON.parse(cleaned);
                const check = Compile(options.schema);
                const coerced = Value.Convert(options.schema, parsed);
                if (!check.Check(coerced)) {
                    const errors = check
                        .Errors(coerced)
                        .map((e) => `${e.instancePath}: ${e.message}`)
                        .join("; ");
                    const err = new Error(`Schema validation failed: ${errors}`);
                    err.raw = raw;
                    err.reason = "schema_validation";
                    lastError = err;
                    if (attempt >= maxRetries)
                        throw err;
                    continue;
                }
                return coerced;
            }
            catch (e) {
                if (e instanceof SyntaxError) {
                    const err = new Error(`JSON parse failed: ${e.message}`);
                    err.raw = raw;
                    err.reason = "json_parse";
                    lastError = err;
                    if (attempt >= maxRetries)
                        throw err;
                    continue;
                }
                if (e.reason) {
                    lastError = e;
                    if (attempt >= maxRetries)
                        throw lastError;
                    continue;
                }
                throw e;
            }
        }
        throw lastError ?? new Error("callLLMStructured failed");
    }
    async forkAgent(promptText, options) {
        const model = await this._resolveOptionalModel(options?.model);
        if (!model)
            throw new Error("No model selected");
        const auth = await this._modelRegistry.getApiKeyAndHeaders(model);
        if (!auth?.ok) {
            throw new Error("error" in auth ? auth.error : `No API key configured for ${model.provider}`);
        }
        if (!auth.apiKey) {
            throw new Error(`No API key configured for ${model.provider}`);
        }
        if (options?.signal?.aborted)
            throw new Error("Aborted");
        const opts = options ?? {};
        // Determine effective paths: use provided paths or inherit from parent
        let effectivePaths = opts.paths ?? {};
        if (!opts.paths) {
            // Inherit parent's paths
            const parentPathsJson = this.currentAgentVariables["paths"];
            if (parentPathsJson) {
                try {
                    effectivePaths = JSON.parse(parentPathsJson);
                }
                catch (e) {
                    // If parsing fails, use empty paths
                    effectivePaths = {};
                }
            }
        }
        let toolNames = opts.tools ?? ["read", "grep", "find", "ls"];
        if (opts.bash === "deny") {
            toolNames = toolNames.filter((t) => t !== "bash");
        }
        const toolInstancesResults = await Promise.all(toolNames.map(async (name) => {
            try {
                const registered = this._toolRegistry.get(name);
                if (registered)
                    return registered;
                const tool = createTool(name, this._cwd);
                // Wrap tool with path checking if paths are configured
                if (effectivePaths.write || effectivePaths.read) {
                    return wrapToolWithPathChecking(tool, effectivePaths);
                }
                return tool;
            }
            catch {
                return undefined;
            }
        }));
        const toolInstances = toolInstancesResults.filter((t) => t !== undefined);
        const effectiveSystemPrompt = opts.inheritSystemPrompt
            ? (this.agent.state.systemPrompt ?? opts.systemPrompt ?? "")
            : (opts.systemPrompt ?? "");
        const messages = opts.shareContext ? [...this.agent.state.messages] : [];
        const maxTurns = opts.maxTurns ?? 5;
        let turnCount = 0;
        const forkedAgent = new Agent({
            getApiKey: () => auth.apiKey,
            initialState: {
                systemPrompt: effectiveSystemPrompt,
                model,
                thinkingLevel: "off",
                tools: toolInstances,
                messages,
            },
            sessionId: opts.shareContext ? this.agent.sessionId : undefined,
        });
        let resultText = "";
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
        const abortHandler = opts.signal ? () => forkedAgent.abort() : undefined;
        if (abortHandler && opts.signal) {
            opts.signal.addEventListener("abort", abortHandler, { once: true });
        }
        const unsub = forkedAgent.subscribe((event) => {
            if (event.type === "turn_end") {
                turnCount++;
                if (turnCount >= maxTurns) {
                    forkedAgent.abort();
                }
            }
            if (event.type === "message_end") {
                const msg = event.message;
                if (msg.role === "assistant") {
                    const asst = msg;
                    const content = asst.content;
                    if (Array.isArray(content)) {
                        resultText = content
                            .filter((c) => c.type === "text")
                            .map((c) => c.text)
                            .join("\n");
                    }
                    if (asst.usage) {
                        usage.input = asst.usage.input ?? 0;
                        usage.output = asst.usage.output ?? 0;
                        usage.cacheRead = asst.usage.cacheRead ?? 0;
                        usage.cacheWrite = asst.usage.cacheWrite ?? 0;
                        if (model.cost) {
                            usage.cost =
                                (usage.input * model.cost.input +
                                    usage.output * model.cost.output +
                                    usage.cacheRead * model.cost.cacheRead +
                                    usage.cacheWrite * model.cost.cacheWrite) /
                                    1_000_000;
                        }
                    }
                }
            }
        });
        try {
            await forkedAgent.prompt({
                role: "user",
                content: [{ type: "text", text: promptText }],
                timestamp: Date.now(),
            });
        }
        finally {
            unsub();
            if (abortHandler && opts.signal) {
                opts.signal.removeEventListener("abort", abortHandler);
            }
        }
        return { text: resultText, usage };
    }
    background(fn) {
        const controller = new AbortController();
        const promise = fn(controller.signal);
        const task = {
            id: randomUUID(),
            signal: controller.signal,
            promise: promise,
            cancel: () => controller.abort(),
        };
        this._backgroundTasks.add(task);
        promise.finally(() => this._backgroundTasks.delete(task));
        return task;
    }
    async previewRollback(targetId) {
        const oldLeafId = this.sessionManager.getLeafId();
        let newLeafId;
        const targetEntry = this.sessionManager.getEntry(targetId);
        if (!targetEntry) {
            throw new Error(`Entry ${targetId} not found`);
        }
        if (targetEntry.type === "message" && targetEntry.message.role === "user") {
            newLeafId = targetEntry.parentId;
        }
        else if (targetEntry.type === "custom_message") {
            newLeafId = targetEntry.parentId;
        }
        else {
            newLeafId = targetId;
        }
        const result = await this._extensionRunner.emit({
            type: "session_tree",
            newLeafId,
            oldLeafId,
            preview: true,
        });
        return result ?? { restored: [], deleted: [] };
    }
}
//# sourceMappingURL=agent-session.js.map