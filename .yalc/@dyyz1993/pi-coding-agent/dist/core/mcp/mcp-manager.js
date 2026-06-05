import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { McpConnectionError, McpError, McpTimeoutError, McpToolCallError } from "./errors.js";
import { McpLogger } from "./logger.js";
export class McpManager {
    connections = new Map();
    toolMap = new Map();
    logger;
    events;
    connectTimeoutMs;
    callTimeoutMs;
    maxReconnectAttempts;
    callSemaphore;
    reconnectTimers = new Map();
    baseReconnectDelay = 1000;
    maxReconnectDelay = 30000;
    cleanupHandler;
    constructor(optionsOrEvents) {
        const hasOptions = optionsOrEvents &&
            ("logLevel" in optionsOrEvents ||
                "connectTimeoutMs" in optionsOrEvents ||
                "callTimeoutMs" in optionsOrEvents ||
                "maxReconnectAttempts" in optionsOrEvents ||
                "maxConcurrentCalls" in optionsOrEvents);
        const opts = hasOptions ? optionsOrEvents : undefined;
        const eventsCallback = optionsOrEvents?.onConnectionChange;
        this.events = eventsCallback ? { onConnectionChange: eventsCallback } : {};
        this.logger = new McpLogger(opts?.logLevel ?? "info");
        this.connectTimeoutMs = opts?.connectTimeoutMs ?? 30_000;
        this.callTimeoutMs = opts?.callTimeoutMs ?? 60_000;
        this.maxReconnectAttempts = opts?.maxReconnectAttempts ?? 3;
        if (opts?.maxConcurrentCalls) {
            this.callSemaphore = { current: 0, max: opts.maxConcurrentCalls, queue: [] };
        }
        this.registerCleanup();
    }
    registerCleanup() {
        this.cleanupHandler = () => {
            this.disconnectAll().catch(() => { });
        };
        process.on("beforeExit", this.cleanupHandler);
        process.on("SIGTERM", this.cleanupHandler);
        process.on("SIGINT", this.cleanupHandler);
    }
    dispose() {
        if (this.cleanupHandler) {
            process.off("beforeExit", this.cleanupHandler);
            process.off("SIGTERM", this.cleanupHandler);
            process.off("SIGINT", this.cleanupHandler);
            this.cleanupHandler = undefined;
        }
        for (const timer of this.reconnectTimers.values())
            clearTimeout(timer);
        this.reconnectTimers.clear();
        return this.disconnectAll();
    }
    notifyChange(conn) {
        this.events.onConnectionChange?.(conn);
    }
    async connectAll(servers) {
        const entries = Object.entries(servers).filter(([, c]) => !c.disabled);
        if (entries.length === 0)
            return;
        const results = await Promise.allSettled(entries.map(([name, config]) => this.connectServer(name, config)));
        const succeeded = results.filter((r) => r.status === "fulfilled").length;
        const failed = results.filter((r) => r.status === "rejected").length;
        this.logger.info("*", `${succeeded} server(s) connected${failed > 0 ? `, ${failed} failed` : ""}`);
    }
    async connectServer(name, config) {
        const existing = this.connections.get(name);
        if (existing?.client) {
            try {
                await existing.client.close();
            }
            catch { }
        }
        const entry = { name, config, status: "connecting", tools: [] };
        this.connections.set(name, entry);
        this.notifyChange(entry);
        try {
            await this.doConnectWithTimeout(name, config);
        }
        catch (e) {
            entry.status = "error";
            entry.error = e instanceof Error ? e.message : String(e);
            this.logger.error(name, `Connection failed: ${entry.error}`);
            this.notifyChange(entry);
            throw e instanceof McpError ? e : new McpConnectionError(name, entry.error);
        }
    }
    async doConnectWithTimeout(name, config, timeoutMs = this.connectTimeoutMs) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            await this.doConnectServer(name, config, controller.signal);
        }
        catch (e) {
            if (controller.signal.aborted) {
                throw new McpTimeoutError("connect", name, timeoutMs);
            }
            throw e;
        }
        finally {
            clearTimeout(timer);
        }
    }
    async doConnectServer(name, config, signal) {
        const entry = this.connections.get(name);
        if (!entry)
            return;
        const transport = await this.createTransport(config);
        const client = new Client({ name: "pi-mcp", version: "1.0.0" }, { capabilities: {} });
        await client.connect(transport, { signal });
        const { tools } = await client.listTools();
        entry.client = client;
        entry.status = "connected";
        entry.error = undefined;
        // Remove old tool mappings for this server
        for (const oldKey of [...this.toolMap.keys()]) {
            if (this.toolMap.get(oldKey)?.serverName === name) {
                this.toolMap.delete(oldKey);
            }
        }
        entry.tools = (tools ?? []).map((tool) => {
            const fullName = `mcp__${name}__${tool.name}`;
            this.toolMap.set(fullName, { serverName: name, toolName: tool.name });
            return {
                serverName: name,
                originalName: tool.name,
                fullName,
                description: tool.description ?? "",
                inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
            };
        });
        this.logger.info(name, `${entry.tools.length} tool(s) discovered`);
        this.notifyChange(entry);
        client.onclose = () => {
            const conn = this.connections.get(name);
            if (!conn || conn.status === "disconnected")
                return;
            conn.status = "error";
            conn.error = "Connection closed unexpectedly";
            this.logger.warn(name, "Connection closed unexpectedly");
            this.notifyChange(conn);
            this.scheduleReconnect(name, 0);
        };
        client.onerror = (err) => {
            const conn = this.connections.get(name);
            if (!conn)
                return;
            conn.status = "error";
            conn.error = err.message;
            this.logger.error(name, `Client error: ${err.message}`);
            this.notifyChange(conn);
        };
    }
    scheduleReconnect(name, attempt) {
        if (attempt >= this.maxReconnectAttempts) {
            this.logger.warn(name, `Max reconnect attempts (${this.maxReconnectAttempts}) reached`);
            return;
        }
        const existing = this.reconnectTimers.get(name);
        if (existing)
            clearTimeout(existing);
        const delay = Math.min(this.baseReconnectDelay * 2 ** attempt, this.maxReconnectDelay);
        this.logger.info(name, `Reconnecting in ${delay}ms (attempt ${attempt + 1}/${this.maxReconnectAttempts})`);
        const timer = setTimeout(() => {
            this.reconnectTimers.delete(name);
            this.reconnectServer(name, attempt + 1);
        }, delay);
        this.reconnectTimers.set(name, timer);
    }
    async reconnectServer(name, attempt) {
        const conn = this.connections.get(name);
        if (!conn || conn.config.disabled)
            return;
        conn.status = "connecting";
        conn.error = undefined;
        this.notifyChange(conn);
        try {
            if (conn.client) {
                try {
                    await conn.client.close();
                }
                catch { }
                conn.client = undefined;
            }
            await this.doConnectServer(name, conn.config, AbortSignal.timeout(30000));
            this.logger.info(name, "Reconnected successfully");
        }
        catch (e) {
            conn.status = "error";
            conn.error = e instanceof Error ? e.message : String(e);
            this.notifyChange(conn);
            this.scheduleReconnect(name, attempt);
        }
    }
    async addServer(name, config) {
        await this.connectServer(name, config);
    }
    async restartServer(name) {
        const conn = this.connections.get(name);
        if (!conn)
            throw new Error(`MCP server "${name}" not found`);
        if (conn.config.disabled)
            throw new Error(`MCP server "${name}" is disabled, enable it first`);
        const timer = this.reconnectTimers.get(name);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(name);
        }
        if (conn.client) {
            try {
                await conn.client.close();
            }
            catch { }
            conn.client = undefined;
        }
        conn.status = "connecting";
        conn.error = undefined;
        this.notifyChange(conn);
        try {
            await this.doConnectWithTimeout(name, conn.config);
        }
        catch (e) {
            conn.status = "error";
            conn.error = e instanceof Error ? e.message : String(e);
            this.notifyChange(conn);
            throw e;
        }
    }
    async removeServer(name) {
        const timer = this.reconnectTimers.get(name);
        if (timer) {
            clearTimeout(timer);
            this.reconnectTimers.delete(name);
        }
        const conn = this.connections.get(name);
        if (conn?.client) {
            try {
                await conn.client.close();
            }
            catch { }
        }
        for (const oldKey of [...this.toolMap.keys()]) {
            if (this.toolMap.get(oldKey)?.serverName === name) {
                this.toolMap.delete(oldKey);
            }
        }
        if (conn) {
            conn.status = "disconnected";
            conn.tools = [];
            this.notifyChange(conn);
        }
        this.connections.delete(name);
    }
    async setServerEnabled(name, enabled) {
        const conn = this.connections.get(name);
        if (!conn)
            return;
        conn.config = { ...conn.config, disabled: !enabled };
        if (!enabled) {
            const timer = this.reconnectTimers.get(name);
            if (timer) {
                clearTimeout(timer);
                this.reconnectTimers.delete(name);
            }
            if (conn.client) {
                try {
                    await conn.client.close();
                }
                catch { }
                conn.client = undefined;
            }
            conn.status = "disconnected";
            this.notifyChange(conn);
        }
        else {
            await this.connectServer(name, conn.config);
        }
    }
    async refreshTools(serverName) {
        if (serverName) {
            const conn = this.connections.get(serverName);
            if (!conn?.client)
                return [];
            try {
                const { tools } = await conn.client.listTools();
                for (const oldKey of [...this.toolMap.keys()]) {
                    if (this.toolMap.get(oldKey)?.serverName === serverName) {
                        this.toolMap.delete(oldKey);
                    }
                }
                conn.tools = (tools ?? []).map((tool) => {
                    const fullName = `mcp__${serverName}__${tool.name}`;
                    this.toolMap.set(fullName, { serverName, toolName: tool.name });
                    return {
                        serverName,
                        originalName: tool.name,
                        fullName,
                        description: tool.description ?? "",
                        inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
                    };
                });
                this.logger.info(serverName, `Refreshed: ${conn.tools.length} tool(s)`);
                this.notifyChange(conn);
            }
            catch (e) {
                this.logger.error(serverName, `Refresh failed: ${e instanceof Error ? e.message : String(e)}`);
            }
            return conn.tools;
        }
        // Refresh all servers
        const allTools = [];
        for (const [name, conn] of this.connections) {
            if (conn.client && conn.status === "connected") {
                try {
                    const { tools } = await conn.client.listTools();
                    for (const oldKey of [...this.toolMap.keys()]) {
                        if (this.toolMap.get(oldKey)?.serverName === name) {
                            this.toolMap.delete(oldKey);
                        }
                    }
                    conn.tools = (tools ?? []).map((tool) => {
                        const fullName = `mcp__${name}__${tool.name}`;
                        this.toolMap.set(fullName, { serverName: name, toolName: tool.name });
                        return {
                            serverName: name,
                            originalName: tool.name,
                            fullName,
                            description: tool.description ?? "",
                            inputSchema: tool.inputSchema ?? { type: "object", properties: {} },
                        };
                    });
                    allTools.push(...conn.tools);
                    this.notifyChange(conn);
                }
                catch (e) {
                    this.logger.error(name, `Refresh failed: ${e instanceof Error ? e.message : String(e)}`);
                }
            }
        }
        return allTools;
    }
    getConnections() {
        return [...this.connections.values()];
    }
    getConnection(name) {
        return this.connections.get(name);
    }
    getToolsByServer(serverName) {
        return this.connections.get(serverName)?.tools ?? [];
    }
    async callTool(fullName, args, timeoutMs) {
        const slotPromise = this.acquireCallSlot();
        if (slotPromise)
            await slotPromise;
        try {
            const mapping = this.toolMap.get(fullName);
            if (!mapping)
                throw new McpToolCallError("", fullName, `Unknown MCP tool: ${fullName}`);
            const connection = this.connections.get(mapping.serverName);
            if (!connection?.client)
                throw new McpToolCallError(mapping.serverName, mapping.toolName, `MCP server "${mapping.serverName}" not connected`);
            const effectiveTimeout = timeoutMs ?? this.callTimeoutMs;
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), effectiveTimeout);
            try {
                return await connection.client.callTool({ name: mapping.toolName, arguments: args }, undefined, { signal: controller.signal });
            }
            catch (e) {
                if (controller.signal.aborted) {
                    throw new McpTimeoutError(`callTool(${fullName})`, mapping.serverName, effectiveTimeout);
                }
                throw new McpToolCallError(mapping.serverName, mapping.toolName, e instanceof Error ? e.message : String(e));
            }
            finally {
                clearTimeout(timer);
            }
        }
        finally {
            this.releaseCallSlot();
        }
    }
    acquireCallSlot() {
        if (!this.callSemaphore)
            return undefined;
        if (this.callSemaphore.current < this.callSemaphore.max) {
            this.callSemaphore.current++;
            return undefined;
        }
        return new Promise((resolve) => {
            this.callSemaphore.queue.push(() => {
                this.callSemaphore.current++;
                resolve();
            });
        });
    }
    releaseCallSlot() {
        if (!this.callSemaphore)
            return;
        this.callSemaphore.current--;
        const next = this.callSemaphore.queue.shift();
        if (next)
            next();
    }
    getAllTools() {
        const tools = [];
        for (const connection of this.connections.values()) {
            if (connection.status === "connected")
                tools.push(...connection.tools);
        }
        return tools;
    }
    async disconnectAll() {
        for (const timer of this.reconnectTimers.values())
            clearTimeout(timer);
        this.reconnectTimers.clear();
        for (const connection of this.connections.values()) {
            try {
                if (connection.client)
                    await connection.client.close();
                connection.status = "disconnected";
            }
            catch { }
        }
        this.connections.clear();
        this.toolMap.clear();
    }
    async createTransport(config) {
        if (this.isStdioConfig(config)) {
            return new StdioClientTransport({
                command: config.command,
                args: config.args,
                env: config.env
                    ? Object.fromEntries(Object.entries({ ...process.env, ...config.env }).filter(([, v]) => v !== undefined))
                    : undefined,
                stderr: "pipe",
            });
        }
        if (config.type === "sse") {
            const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
            return new SSEClientTransport(new URL(config.url), config.headers ? { requestInit: { headers: config.headers } } : undefined);
        }
        if (config.type === "streamable-http") {
            const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
            return new StreamableHTTPClientTransport(new URL(config.url), config.headers ? { requestInit: { headers: config.headers } } : undefined);
        }
        throw new Error(`Unknown MCP transport type: ${config.type}`);
    }
    isStdioConfig(config) {
        return "command" in config;
    }
}
//# sourceMappingURL=mcp-manager.js.map