import type { DiscoveredTool, McpConnection, McpManagerEvents, McpManagerOptions, McpServerConfig } from "./types.ts";
export declare class McpManager {
    private connections;
    private toolMap;
    private readonly logger;
    private readonly events;
    private readonly connectTimeoutMs;
    private readonly callTimeoutMs;
    private readonly maxReconnectAttempts;
    private callSemaphore;
    private reconnectTimers;
    private baseReconnectDelay;
    private maxReconnectDelay;
    private cleanupHandler;
    constructor(optionsOrEvents?: McpManagerEvents | (McpManagerOptions & {
        onConnectionChange?: McpManagerEvents["onConnectionChange"];
    }));
    private registerCleanup;
    dispose(): Promise<void>;
    private notifyChange;
    connectAll(servers: Record<string, McpServerConfig>): Promise<void>;
    connectServer(name: string, config: McpServerConfig): Promise<void>;
    private doConnectWithTimeout;
    private doConnectServer;
    private scheduleReconnect;
    private reconnectServer;
    addServer(name: string, config: McpServerConfig): Promise<void>;
    restartServer(name: string): Promise<void>;
    removeServer(name: string): Promise<void>;
    setServerEnabled(name: string, enabled: boolean): Promise<void>;
    refreshTools(serverName?: string): Promise<DiscoveredTool[]>;
    getConnections(): McpConnection[];
    getConnection(name: string): McpConnection | undefined;
    getToolsByServer(serverName: string): DiscoveredTool[];
    callTool(fullName: string, args: Record<string, unknown>, timeoutMs?: number): Promise<unknown>;
    private acquireCallSlot;
    private releaseCallSlot;
    getAllTools(): DiscoveredTool[];
    disconnectAll(): Promise<void>;
    private createTransport;
    private isStdioConfig;
}
//# sourceMappingURL=mcp-manager.d.ts.map