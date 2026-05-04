import { createTypedClient, WebSocketTransport, IPCTransport } from "@dyyz1993/rpc-core";
import type { TypedClient, MethodParams, MethodResult, EventPayload, EventMetadata } from "@dyyz1993/rpc-core";
import type { RPCMethods, RPCEvents } from "../../shared/rpc-schema";
import { useRpcDebugStore } from "../stores/use-rpc-debug-store";
import { useAppStore } from "../stores/use-app-store";

/**
 * Token 来源优先级：
 * 1. URL query ?token=xxx（部署时注入）
 * 2. localStorage "rpc-auth-token"
 * 3. 空字符串（连接将被服务端 401 拒绝，需通过上述方式提供有效 token）
 */
function resolveAuthToken(): string {
  if (typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("token");
    if (fromQuery) return fromQuery;
    const fromStorage = localStorage.getItem("rpc-auth-token");
    if (fromStorage) return fromStorage;
  }
  return "";
}

const AUTH_TOKEN = resolveAuthToken();

class APIClientImpl {
  private client: TypedClient<RPCMethods, RPCEvents> | null = null;
  private initPromise: Promise<void> | null = null;
  private _transport: "ipc" | "websocket" = "websocket";
  private _baseUrl: string | null = null;
  private wsTransport: WebSocketTransport | null = null;
  private _reconnectCallback: (() => void) | null = null;
  private _reconnectDetected: boolean = false;
  private _connectionStatus: "connected" | "disconnected" = "connected";
  private _connectionListeners: Set<(status: "connected" | "disconnected") => void> = new Set();

  onConnectionChange(listener: (status: "connected" | "disconnected") => void): () => void {
    this._connectionListeners.add(listener);
    return () => { this._connectionListeners.delete(listener); };
  }

  getConnectionStatus(): "connected" | "disconnected" {
    return this._connectionStatus;
  }

  private setConnectionStatus(status: "connected" | "disconnected"): void {
    if (this._connectionStatus === status) return;
    this._connectionStatus = status;
    this._connectionListeners.forEach((fn) => fn(status));
  }

  initSyncForDesktop(): void {
    if (this.client) return;

    const ipcTransport = new IPCTransport();
    this._transport = "ipc";
    this._baseUrl = null;
    this.client = createTypedClient<RPCMethods, RPCEvents>(ipcTransport);
    this.setupElectrobunBridge(ipcTransport);
    useAppStore.getState().addLog("[APIClient] Desktop (IPC) initialized synchronously");
  }

  onReconnect(callback: () => void): void {
    this._reconnectCallback = callback;
  }

  async initialize(): Promise<void> {
    if (this.client && (this._transport === "ipc" || this.wsTransport?.isConnected())) {
      return;
    }

    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      const env = this.detectEnvironment();

      if (env === "electrobun") {
        this.initSyncForDesktop();
      } else {
        this._transport = "websocket";
        const wsUrl = this.getWebSocketUrl();
        this.wsTransport = new WebSocketTransport(wsUrl);
        await this.wsTransport.connect();
        this.client = createTypedClient<RPCMethods, RPCEvents>(this.wsTransport);
        this._reconnectDetected = false;
        this.setupReconnectDetection();

        const wsUrlObj = new URL(wsUrl);
        const httpProto = wsUrlObj.protocol === "wss:" ? "https:" : "http:";
        this._baseUrl = `${httpProto}//${wsUrlObj.host}`;
      }
    })();

    return this.initPromise;
  }

  private setupReconnectDetection(): void {
    if (!this.wsTransport) return;

    const transport = this.wsTransport;
    let wasConnected = transport.isConnected();

    const checkInterval = setInterval(() => {
      if (!this.wsTransport || this.wsTransport !== transport) {
        clearInterval(checkInterval);
        return;
      }

      const connected = transport.isConnected();

      if (wasConnected && !connected) {
        this._reconnectDetected = true;
        this.setConnectionStatus("disconnected");
      }

      if (!wasConnected && connected && this._reconnectDetected) {
        this._reconnectDetected = false;
        this.client = createTypedClient<RPCMethods, RPCEvents>(transport);
        this.initPromise = null;
        this.setConnectionStatus("connected");
        this._reconnectCallback?.();
      }

      wasConnected = connected;
    }, 500);
  }

  private detectEnvironment(): "electrobun" | "browser" {
    if (typeof window === "undefined") return "browser";
    if (window.__electrobunBunBridge) return "electrobun";
    return "browser";
  }

  private getWebSocketUrl(): string {
    if (typeof window === "undefined") return `ws://localhost:3100/ws?token=${AUTH_TOKEN}`;
    const customUrl = (
      new URLSearchParams(window.location.search).get("ws") ??
      localStorage.getItem("rpc-websocket-url")
    );
    if (customUrl) return customUrl.includes("token=") ? customUrl : `${customUrl}?token=${AUTH_TOKEN}`;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws?token=${AUTH_TOKEN}`;
  }

  /**
   * 桌面端 IPC 桥接：
   * - Bun → Browser: 通过 executeJavascript 调用 window.__piAgentIPC()
   * - Browser → Bun: 通过 __electrobunBunBridge.postMessage 发送 Electrobun 消息格式
   */
  private setupElectrobunBridge(ipcTransport: IPCTransport): void {
    if (typeof window === "undefined") return;

    const win = window;

    // 1. 注册接收函数：Bun 通过 executeJavascript 调用此函数发送消息到 Browser
    win.__piAgentIPC = (msg: unknown) => {
      ipcTransport.simulateMessage(msg);
    };

    // 2. 覆写 send：将 RPC-core 消息包装成 Electrobun 消息格式，通过原生桥接发送
    const bridge = win.__electrobunBunBridge;

    if (bridge) {
      ipcTransport.send = async (message: unknown) => {
        // 包装成 Electrobun message packet，bun 端 defineRPC 注册了 "rpc-message" handler
        const electrobunPacket = {
          type: "message",
          id: "rpc-message",
          payload: JSON.stringify(message),
        };
        bridge.postMessage(JSON.stringify(electrobunPacket));
      };
    }
  }

  getTransport(): "ipc" | "websocket" {
    return this._transport;
  }

  /** Web 端 HTTP 基础 URL（如 http://localhost:3100），桌面端返回 null */
  getBaseUrl(): string | null {
    return this._baseUrl;
  }

  /** 获取当前 auth token（用于需要直接调 HTTP 的场景） */
  getAuthToken(): string {
    return AUTH_TOKEN;
  }

  async call<K extends keyof RPCMethods>(
    method: K,
    params: MethodParams<RPCMethods, K>
  ): Promise<MethodResult<RPCMethods, K>> {
    await this.initialize();
    this.debugLog("call", method as string, params);
    try {
      if (!this.client) throw new Error("Client not initialized");
      const result = await this.client.call(method, params);
      this.debugLog("response", method as string, result);
      return result;
    } catch (err) {
      this.debugLog("response", method as string, { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  async subscribe<K extends keyof RPCEvents>(
    eventType: K,
    handler: (payload: EventPayload<RPCEvents[K]>, metadata: EventMetadata<RPCEvents[K]>) => void,
    filter?: Record<string, unknown>
  ): Promise<string> {
    await this.initialize();
    const wrappedHandler = (payload: EventPayload<RPCEvents[K]>, metadata: EventMetadata<RPCEvents[K]>) => {
      this.debugLog("event", eventType as string, payload);
      handler(payload, metadata);
    };
    if (!this.client) throw new Error("Client not initialized");
    return this.client.subscribe(eventType, wrappedHandler, filter);
  }

  private _debugEnabled = true;

  setDebugEnabled(enabled: boolean) {
    this._debugEnabled = enabled;
  }

  private debugLog(direction: "call" | "event" | "response", method: string, payload: unknown): void {
    if (!this._debugEnabled) return;
    try {
      useRpcDebugStore.getState().addEntry({
        direction,
        method: direction !== "event" ? method : undefined,
        eventType: direction === "event" ? method : undefined,
        payload,
      });
    } catch {}
  }

  unsubscribe(subscriptionId: string): void {
    this.client?.unsubscribe(subscriptionId);
  }

  isConnected(): boolean {
    return this.client !== null;
  }

  close(): void {
    this.client?.close();
  }
}

export const apiClient = new APIClientImpl();
export type { APIClientImpl, RPCMethods, RPCEvents };
