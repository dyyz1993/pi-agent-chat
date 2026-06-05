export type LogLevel = "debug" | "info" | "warn" | "error";
export declare class McpLogger {
    private minLevel;
    private readonly levels;
    constructor(minLevel?: LogLevel);
    debug(server: string, msg: string, ...args: unknown[]): void;
    info(server: string, msg: string, ...args: unknown[]): void;
    warn(server: string, msg: string, ...args: unknown[]): void;
    error(server: string, msg: string, ...args: unknown[]): void;
    private log;
}
//# sourceMappingURL=logger.d.ts.map