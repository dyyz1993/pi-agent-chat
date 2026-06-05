/**
 * RPC Client for programmatic access to the coding agent.
 *
 * Spawns the agent in RPC mode and provides a typed API for all operations.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { attachJsonlLineReader, serializeJsonLine } from "./jsonl.js";
// ============================================================================
// RPC Client
// ============================================================================
export class RpcClient {
    process = null;
    stopReadingStdout = null;
    eventListeners = [];
    pendingRequests = new Map();
    channelHandlers = new Map();
    readyResolve = null;
    readyReject = null;
    requestId = 0;
    stderr = "";
    exitError = null;
    options;
    constructor(options = {}) {
        this.options = options;
    }
    /**
     * Start the RPC agent process.
     */
    async start() {
        if (this.process) {
            throw new Error("Client already started");
        }
        this.exitError = null;
        const cliPath = this.options.cliPath ?? "dist/cli.js";
        const args = ["--mode", "rpc"];
        if (this.options.provider) {
            args.push("--provider", this.options.provider);
        }
        if (this.options.model) {
            args.push("--model", this.options.model);
        }
        if (this.options.args) {
            args.push(...this.options.args);
        }
        const childProcess = spawn("node", [cliPath, ...args], {
            cwd: this.options.cwd,
            env: { ...process.env, ...this.options.env },
            stdio: ["pipe", "pipe", "pipe"],
        });
        this.process = childProcess;
        // Collect stderr for debugging
        childProcess.stderr?.on("data", (data) => {
            this.stderr += data.toString();
            process.stderr.write(data);
        });
        childProcess.once("exit", (code, signal) => {
            if (this.process !== childProcess)
                return;
            const error = this.createProcessExitError(code, signal);
            this.exitError = error;
            this.rejectReady(error);
            this.rejectPendingRequests(error);
        });
        childProcess.once("error", (error) => {
            if (this.process !== childProcess)
                return;
            const processError = new Error(`Agent process error: ${error.message}. Stderr: ${this.stderr}`);
            this.exitError = processError;
            this.rejectReady(processError);
            this.rejectPendingRequests(processError);
        });
        childProcess.stdin?.on("error", (error) => {
            if (this.process !== childProcess)
                return;
            const stdinError = this.exitError ?? new Error(`Agent process stdin error: ${error.message}. Stderr: ${this.stderr}`);
            this.exitError = stdinError;
            this.rejectReady(stdinError);
            this.rejectPendingRequests(stdinError);
        });
        // Set up strict JSONL reader for stdout.
        this.stopReadingStdout = attachJsonlLineReader(childProcess.stdout, (line) => {
            this.handleLine(line);
        });
        await this.waitForReady();
        if (this.process.exitCode !== null) {
            const error = this.exitError ?? this.createProcessExitError(this.process.exitCode, this.process.signalCode);
            this.exitError = error;
            throw error;
        }
    }
    /**
     * Stop the RPC agent process.
     */
    async stop() {
        if (!this.process)
            return;
        this.stopReadingStdout?.();
        this.stopReadingStdout = null;
        this.process.kill("SIGTERM");
        // Wait for process to exit
        await new Promise((resolve) => {
            const timeout = setTimeout(() => {
                this.process?.kill("SIGKILL");
                resolve();
            }, 1000);
            this.process?.on("exit", () => {
                clearTimeout(timeout);
                resolve();
            });
        });
        this.process = null;
        this.pendingRequests.clear();
    }
    /**
     * Subscribe to agent events.
     */
    onEvent(listener) {
        this.eventListeners.push(listener);
        return () => {
            const index = this.eventListeners.indexOf(listener);
            if (index !== -1) {
                this.eventListeners.splice(index, 1);
            }
        };
    }
    /**
     * Get collected stderr output (useful for debugging).
     */
    getStderr() {
        return this.stderr;
    }
    // =========================================================================
    // Command Methods
    // =========================================================================
    /**
     * Send a prompt to the agent.
     * Returns immediately after sending; use onEvent() to receive streaming events.
     * Use waitForIdle() to wait for completion.
     */
    async prompt(message, images) {
        await this.send({ type: "prompt", message, images });
    }
    /**
     * Queue a steering message to interrupt the agent mid-run.
     */
    async steer(message, images) {
        await this.send({ type: "steer", message, images });
    }
    /**
     * Queue a follow-up message to be processed after the agent finishes.
     */
    async followUp(message, images) {
        await this.send({ type: "follow_up", message, images });
    }
    /**
     * Abort current operation.
     */
    async abort() {
        await this.send({ type: "abort" });
    }
    /**
     * Start a new session, optionally with parent tracking.
     * @param parentSession - Optional parent session path for lineage tracking
     * @returns Object with `cancelled: true` if an extension cancelled the new session
     */
    async newSession(parentSession) {
        const response = await this.send({ type: "new_session", parentSession });
        return this.getData(response);
    }
    /**
     * Get current session state.
     */
    async getState() {
        const response = await this.send({ type: "get_state" });
        return this.getData(response);
    }
    /**
     * Set model by provider and ID.
     */
    async setModel(provider, modelId) {
        const response = await this.send({ type: "set_model", provider, modelId });
        return this.getData(response);
    }
    /**
     * Cycle to next model.
     */
    async cycleModel() {
        const response = await this.send({ type: "cycle_model" });
        return this.getData(response);
    }
    /**
     * Get list of available models.
     */
    async getAvailableModels() {
        const response = await this.send({ type: "get_available_models" });
        return this.getData(response).models;
    }
    async getTierModels() {
        const response = await this.send({ type: "get_tier_models" });
        return this.getData(response).models;
    }
    async setTierModels(models) {
        await this.send({ type: "set_tier_models", models });
    }
    /**
     * Set thinking level.
     */
    async setThinkingLevel(level) {
        await this.send({ type: "set_thinking_level", level });
    }
    /**
     * Cycle thinking level.
     */
    async cycleThinkingLevel() {
        const response = await this.send({ type: "cycle_thinking_level" });
        return this.getData(response);
    }
    /**
     * Set steering mode.
     */
    async setSteeringMode(mode) {
        await this.send({ type: "set_steering_mode", mode });
    }
    /**
     * Set follow-up mode.
     */
    async setFollowUpMode(mode) {
        await this.send({ type: "set_follow_up_mode", mode });
    }
    /**
     * Compact session context.
     */
    async compact(customInstructions) {
        const response = await this.send({ type: "compact", customInstructions });
        return this.getData(response);
    }
    /**
     * Set auto-compaction enabled/disabled.
     */
    async setAutoCompaction(enabled) {
        await this.send({ type: "set_auto_compaction", enabled });
    }
    /**
     * Set auto-retry enabled/disabled.
     */
    async setAutoRetry(enabled) {
        await this.send({ type: "set_auto_retry", enabled });
    }
    /**
     * Abort in-progress retry.
     */
    async abortRetry() {
        await this.send({ type: "abort_retry" });
    }
    /**
     * Execute a bash command.
     */
    async bash(command) {
        const response = await this.send({ type: "bash", command });
        return this.getData(response);
    }
    /**
     * Abort running bash command.
     */
    async abortBash() {
        await this.send({ type: "abort_bash" });
    }
    /**
     * Get session statistics.
     */
    async getSessionStats() {
        const response = await this.send({ type: "get_session_stats" });
        return this.getData(response);
    }
    /**
     * Export session to HTML.
     */
    async exportHtml(outputPath) {
        const response = await this.send({ type: "export_html", outputPath });
        return this.getData(response);
    }
    /**
     * Switch to a different session file.
     * @returns Object with `cancelled: true` if an extension cancelled the switch
     */
    async switchSession(sessionPath) {
        const response = await this.send({ type: "switch_session", sessionPath });
        return this.getData(response);
    }
    /**
     * Fork from a specific message.
     * @returns Object with `text` (the message text) and `cancelled` (if extension cancelled)
     */
    async fork(entryId, options) {
        const response = await this.send({ type: "fork", entryId, position: options?.position });
        return this.getData(response);
    }
    async navigateTree(targetId, options) {
        const response = await this.send({
            type: "navigate_tree",
            targetId,
            summarize: options?.summarize,
            customInstructions: options?.customInstructions,
            replaceInstructions: options?.replaceInstructions,
            label: options?.label,
            skipFiles: options?.skipFiles,
        });
        return this.getData(response);
    }
    async previewRollback(targetId) {
        const response = await this.send({ type: "rollback_preview", targetId });
        return this.getData(response);
    }
    async deleteEntries(targetIds) {
        const response = await this.send({ type: "delete_entries", targetIds });
        return this.getData(response);
    }
    async summarizeEntries(targetIds, options) {
        const response = await this.send({
            type: "summarize_entries",
            targetIds,
            summary: options?.summary,
            model: options?.model,
        });
        return this.getData(response);
    }
    /**
     * Clone the current active branch into a new session.
     * @returns Object with `cancelled: true` if an extension cancelled the clone
     */
    async clone() {
        const response = await this.send({ type: "clone" });
        return this.getData(response);
    }
    /**
     * Get messages available for forking.
     */
    async getForkMessages() {
        const response = await this.send({ type: "get_fork_messages" });
        return this.getData(response).messages;
    }
    /**
     * Get text of last assistant message.
     */
    async getLastAssistantText() {
        const response = await this.send({ type: "get_last_assistant_text" });
        return this.getData(response).text;
    }
    /**
     * Set the session display name.
     */
    async setSessionName(name) {
        await this.send({ type: "set_session_name", name });
    }
    /**
     * Get all messages in the session.
     */
    async getMessages() {
        const response = await this.send({ type: "get_messages" });
        return this.getData(response).messages;
    }
    async getFullMessages(options) {
        const response = await this.send({
            type: "get_full_messages",
            afterEntryId: options?.afterEntryId,
            limit: options?.limit,
        });
        return this.getData(response);
    }
    async getTree() {
        const response = await this.send({ type: "get_tree" });
        return this.getData(response);
    }
    async getTreeWithLeaf() {
        const response = await this.send({ type: "get_tree_with_leaf" });
        return this.getData(response);
    }
    async getModifiedFiles(options) {
        const response = await this.send({
            type: "get_modified_files",
            fromEntryId: options?.fromEntryId,
            toEntryId: options?.toEntryId,
            toTurnIndex: options?.toTurnIndex,
            fromTurnIndex: options?.fromTurnIndex,
            toUserMsgEntryId: options?.toUserMsgEntryId,
        });
        return this.getData(response);
    }
    async getFileDiff(options) {
        const response = await this.send({
            type: "get_file_diff",
            filePath: options.filePath,
            fromEntryId: options.fromEntryId,
            toEntryId: options.toEntryId,
            useBaselineHash: options.useBaselineHash,
        });
        return this.getData(response);
    }
    async getBatchDiffs(options) {
        const response = await this.send({
            type: "get_batch_diffs",
            fromEntryId: options?.fromEntryId,
            toEntryId: options?.toEntryId,
        });
        return this.getData(response);
    }
    async getFileHistory(options) {
        const response = await this.send({
            type: "get_file_history",
            filePath: options.filePath,
        });
        return this.getData(response);
    }
    /**
     * Get available commands (extension commands, prompt templates, skills).
     */
    async getCommands() {
        const response = await this.send({ type: "get_commands" });
        return this.getData(response).commands;
    }
    async getSkills() {
        const response = await this.send({ type: "get_skills" });
        return this.getData(response).skills;
    }
    async getExtensions() {
        const response = await this.send({ type: "get_extensions" });
        return this.getData(response).extensions;
    }
    async getTools() {
        const response = await this.send({ type: "get_tools" });
        return this.getData(response).tools;
    }
    async getSettings(scope) {
        const response = await this.send({ type: "get_settings", scope });
        return this.getData(response);
    }
    async setSettings(settings, scope) {
        await this.send({ type: "set_settings", settings, scope });
    }
    async getContextUsage() {
        const response = await this.send({ type: "get_context_usage" });
        return this.getData(response);
    }
    async getSystemPrompt() {
        const response = await this.send({ type: "get_system_prompt" });
        return this.getData(response);
    }
    async getActiveTools() {
        const response = await this.send({ type: "get_active_tools" });
        return this.getData(response).toolNames;
    }
    async setActiveTools(toolNames) {
        await this.send({ type: "set_active_tools", toolNames });
    }
    async getQueue() {
        const response = await this.send({ type: "get_queue" });
        return this.getData(response);
    }
    async clearQueue() {
        const response = await this.send({ type: "clear_queue" });
        return this.getData(response);
    }
    async getFlags() {
        const response = await this.send({ type: "get_flags" });
        return this.getData(response).flags;
    }
    async getFlagValues() {
        const response = await this.send({ type: "get_flag_values" });
        return this.getData(response).values;
    }
    async setFlag(name, value) {
        await this.send({ type: "set_flag", name, value });
    }
    async reload() {
        await this.send({ type: "reload" });
    }
    async setCwd(cwd) {
        const response = await this.send({ type: "set_cwd", cwd });
        return this.getData(response);
    }
    async getAgentsFiles() {
        const response = await this.send({ type: "get_agents_files" });
        return this.getData(response).agentsFiles;
    }
    async getAgents() {
        const response = await this.send({ type: "get_agents" });
        return this.getData(response).agents;
    }
    async switchAgent(agentName) {
        const response = await this.send({ type: "switch_agent", agentName });
        return this.getData(response);
    }
    async getCurrentAgent() {
        const response = await this.send({ type: "get_current_agent" });
        return this.getData(response);
    }
    async getLatestAgentChange() {
        const response = await this.send({ type: "get_latest_agent_change" });
        return this.getData(response);
    }
    async getAgentDetail(agentName) {
        const response = await this.send({ type: "get_agent_detail", agentName });
        return this.getData(response).agent;
    }
    async getAllTools() {
        const response = await this.send({ type: "get_all_tools" });
        return this.getData(response).tools;
    }
    async setPermissionMode(mode) {
        const response = await this.send({ type: "set_permission_mode", mode });
        return this.getData(response);
    }
    // =========================================================================
    // Helpers
    // =========================================================================
    /**
     * Wait for agent to become idle (no streaming).
     * Resolves when agent_end event is received.
     */
    waitForIdle(timeout = 60000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                unsubscribe();
                reject(new Error(`Timeout waiting for agent to become idle. Stderr: ${this.stderr}`));
            }, timeout);
            const unsubscribe = this.onEvent((event) => {
                if (event.type === "agent_end") {
                    clearTimeout(timer);
                    unsubscribe();
                    resolve();
                }
            });
        });
    }
    /**
     * Collect events until agent becomes idle.
     */
    collectEvents(timeout = 60000) {
        return new Promise((resolve, reject) => {
            const events = [];
            const timer = setTimeout(() => {
                unsubscribe();
                reject(new Error(`Timeout collecting events. Stderr: ${this.stderr}`));
            }, timeout);
            const unsubscribe = this.onEvent((event) => {
                events.push(event);
                if (event.type === "agent_end") {
                    clearTimeout(timer);
                    unsubscribe();
                    resolve(events);
                }
            });
        });
    }
    /**
     * Send prompt and wait for completion, returning all events.
     */
    async promptAndWait(message, images, timeout = 60000) {
        const eventsPromise = this.collectEvents(timeout);
        await this.prompt(message, images);
        return eventsPromise;
    }
    channel(name) {
        const invokeImpl = (data, timeoutMs = 30_000) => {
            return new Promise((resolve, reject) => {
                const invokeId = `inv_${randomUUID().slice(0, 8)}`;
                let timer;
                const handler = (responseData) => {
                    const payload = responseData;
                    if (payload?.invokeId !== invokeId)
                        return;
                    clearTimeout(timer);
                    const handlers = this.channelHandlers.get(name);
                    handlers?.delete(handler);
                    if (handlers?.size === 0)
                        this.channelHandlers.delete(name);
                    resolve(responseData);
                };
                timer = setTimeout(() => {
                    const handlers = this.channelHandlers.get(name);
                    handlers?.delete(handler);
                    if (handlers?.size === 0)
                        this.channelHandlers.delete(name);
                    reject(new Error(`Channel invoke "${name}" timed out after ${timeoutMs}ms`));
                }, timeoutMs);
                let handlers = this.channelHandlers.get(name);
                if (!handlers) {
                    handlers = new Set();
                    this.channelHandlers.set(name, handlers);
                }
                handlers.add(handler);
                this.writeLine({
                    type: "channel_data",
                    name,
                    data: { ...(data ?? {}), invokeId },
                });
            });
        };
        return {
            name,
            send: (data) => {
                this.writeLine({ type: "channel_data", name, data });
            },
            onReceive: (handler) => {
                let handlers = this.channelHandlers.get(name);
                if (!handlers) {
                    handlers = new Set();
                    this.channelHandlers.set(name, handlers);
                }
                handlers.add(handler);
                return () => {
                    handlers.delete(handler);
                    if (handlers.size === 0)
                        this.channelHandlers.delete(name);
                };
            },
            invoke: invokeImpl,
            call: (method, params, timeoutMs) => {
                return invokeImpl({ ...params, __call: method }, timeoutMs);
            },
        };
    }
    // =========================================================================
    // Internal
    // =========================================================================
    handleLine(line) {
        try {
            const data = JSON.parse(line);
            if (data.type === "ready") {
                this.resolveReady();
                return;
            }
            // Check if it's a response to a pending request
            if (data.type === "response" && data.id && this.pendingRequests.has(data.id)) {
                const pending = this.pendingRequests.get(data.id);
                this.pendingRequests.delete(data.id);
                pending.resolve(data);
                return;
            }
            if (data.type === "channel_data" && data.name) {
                const handlers = this.channelHandlers.get(data.name);
                if (handlers) {
                    for (const handler of handlers) {
                        const payload = data.data;
                        const invokeId = payload?.invokeId;
                        const result = handler(data.data);
                        if (invokeId && result !== undefined) {
                            const responseData = result && typeof result === "object" ? result : { value: result };
                            this.writeLine({
                                type: "channel_data",
                                name: data.name,
                                data: { ...responseData, invokeId },
                            });
                        }
                    }
                }
                return;
            }
            // Otherwise it's an event
            for (const listener of this.eventListeners) {
                listener(data);
            }
        }
        catch {
            // Ignore non-JSON lines
        }
    }
    createProcessExitError(code, signal) {
        return new Error(`Agent process exited (code=${code} signal=${signal}). Stderr: ${this.stderr}`);
    }
    waitForReady() {
        return new Promise((resolve, reject) => {
            if (this.exitError) {
                reject(this.exitError);
                return;
            }
            if (this.process && this.process.exitCode !== null) {
                const error = this.createProcessExitError(this.process.exitCode, this.process.signalCode);
                this.exitError = error;
                reject(error);
                return;
            }
            const timeout = setTimeout(() => {
                this.readyResolve = null;
                this.readyReject = null;
                reject(new Error(`Agent process did not become ready. Stderr: ${this.stderr}`));
            }, 15000);
            this.readyResolve = () => {
                clearTimeout(timeout);
                this.readyResolve = null;
                this.readyReject = null;
                resolve();
            };
            this.readyReject = (error) => {
                clearTimeout(timeout);
                this.readyResolve = null;
                this.readyReject = null;
                reject(error);
            };
        });
    }
    resolveReady() {
        this.readyResolve?.();
    }
    rejectReady(error) {
        this.readyReject?.(error);
    }
    rejectPendingRequests(error) {
        for (const pending of this.pendingRequests.values()) {
            pending.reject(error);
        }
        this.pendingRequests.clear();
    }
    async send(command) {
        const childProcess = this.process;
        const stdin = childProcess?.stdin;
        if (!childProcess || !stdin) {
            throw new Error("Client not started");
        }
        if (this.exitError) {
            throw this.exitError;
        }
        if (childProcess.exitCode !== null) {
            const error = this.createProcessExitError(childProcess.exitCode, childProcess.signalCode);
            this.exitError = error;
            throw error;
        }
        if (stdin.destroyed || !stdin.writable) {
            const error = new Error(`Agent process stdin is not writable. Stderr: ${this.stderr}`);
            this.exitError = error;
            throw error;
        }
        const id = `req_${++this.requestId}`;
        const fullCommand = { ...command, id };
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.pendingRequests.delete(id);
                reject(new Error(`Timeout waiting for response to ${command.type}. Stderr: ${this.stderr}`));
            }, 30000);
            this.pendingRequests.set(id, {
                resolve: (response) => {
                    clearTimeout(timeout);
                    resolve(response);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            });
            try {
                this.writeLine(fullCommand);
            }
            catch (error) {
                const writeError = error instanceof Error ? error : new Error(String(error));
                const pending = this.pendingRequests.get(id);
                this.pendingRequests.delete(id);
                pending?.reject(writeError);
            }
        });
    }
    writeLine(obj) {
        const stdin = this.process?.stdin;
        if (!stdin) {
            throw new Error("Client not started");
        }
        stdin.write(serializeJsonLine(obj));
    }
    getData(response) {
        if (!response.success) {
            const errorResponse = response;
            throw new Error(errorResponse.error);
        }
        // Type assertion: we trust response.data matches T based on the command sent.
        // This is safe because each public method specifies the correct T for its command.
        const successResponse = response;
        return successResponse.data;
    }
    /**
     * Respond to a pending extension UI request.
     * Sends an extension_ui_response message to the CLI process.
     * First response wins; subsequent calls are silently ignored by the agent.
     */
    respondUI(requestId, response) {
        const childProcess = this.process;
        const stdin = childProcess?.stdin;
        if (!childProcess || !stdin || stdin.destroyed || !stdin.writable)
            return;
        const msg = JSON.stringify({ type: "extension_ui_response", id: requestId, ...response });
        stdin.write(`${msg}\n`);
    }
    async getMcpServers() {
        const response = await this.send({ type: "get_mcp_servers" });
        return this.getData(response).servers;
    }
    async toggleMcpServer(name, enabled) {
        await this.send({ type: "mcp_toggle_server", name, enabled });
    }
    async restartMcpServer(name) {
        await this.send({ type: "mcp_restart_server", name });
    }
    onRemoteToolCall(handler) {
        const wrapped = (event) => {
            const raw = event;
            if (raw.type === "remote_tool_call") {
                handler(raw);
            }
        };
        return this.onEvent(wrapped);
    }
    sendRemoteToolResult(toolCallId, result) {
        const childProcess = this.process;
        const stdin = childProcess?.stdin;
        if (!childProcess || !stdin || stdin.destroyed || !stdin.writable)
            return;
        const msg = JSON.stringify({ type: "remote_tool_result", toolCallId, result });
        stdin.write(`${msg}\n`);
    }
}
//# sourceMappingURL=rpc-client.js.map