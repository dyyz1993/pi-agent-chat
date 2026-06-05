export declare class McpError extends Error {
    readonly code: string;
    readonly serverName?: string;
    readonly toolName?: string;
    constructor(code: string, message: string, serverName?: string, toolName?: string);
}
export declare class McpConnectionError extends McpError {
    constructor(serverName: string, message: string);
}
export declare class McpToolCallError extends McpError {
    constructor(serverName: string, toolName: string, message: string);
}
export declare class McpTimeoutError extends McpError {
    constructor(operation: string, serverName: string, timeoutMs: number);
}
//# sourceMappingURL=errors.d.ts.map