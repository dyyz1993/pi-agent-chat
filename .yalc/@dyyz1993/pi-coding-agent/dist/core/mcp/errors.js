export class McpError extends Error {
    code;
    serverName;
    toolName;
    constructor(code, message, serverName, toolName) {
        super(message);
        this.code = code;
        this.serverName = serverName;
        this.toolName = toolName;
        this.name = "McpError";
    }
}
export class McpConnectionError extends McpError {
    constructor(serverName, message) {
        super("CONNECTION_ERROR", message, serverName);
        this.name = "McpConnectionError";
    }
}
export class McpToolCallError extends McpError {
    constructor(serverName, toolName, message) {
        super("TOOL_CALL_ERROR", message, serverName, toolName);
        this.name = "McpToolCallError";
    }
}
export class McpTimeoutError extends McpError {
    constructor(operation, serverName, timeoutMs) {
        super("TIMEOUT", `${operation} timed out after ${timeoutMs}ms`, serverName);
        this.name = "McpTimeoutError";
    }
}
//# sourceMappingURL=errors.js.map