import { createTypedClient, WebSocketTransport, IPCTransport } from "@dyyz1993/rpc-core";
import type {
  TypedClient,
  MethodParams,
  MethodResult,
  EventPayload,
  EventMetadata,
} from "@dyyz1993/rpc-core";
import type { RPCMethods, RPCEvents } from "../../shared/rpc-schema";
import { useRpcDebugStore } from "../stores/use-rpc-debug-store";
import { useAppStore } from "../stores/use-app-store";

/**
 * Token 来源优先级：
 * 1. URL query ?token=xxx（部署时注入）
 * 2. localStorage "rpc-auth-token"
 * 3. 空字符串（连接将被服务端 401 拒绝，需通过上述方式提供有效 token）
 */
export function resolveAuthToken(): string {
  if (typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("token");
    if (fromQuery) return fromQuery;
    const fromStorage = localStorage.getItem("rpc-auth-token");
    if (fromStorage) return fromStorage;
  }
  return "";
}

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
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _reconnectAttempts: number = 0;
  private _maxReconnectAttempts: number = 10;
  private _baseReconnectDelay: number = 3000;
  private _stopped: boolean = false;
  private _reconnectCheckInterval: ReturnType<typeof setInterval> | null = null;

  onConnectionChange(listener: (status: "connected" | "disconnected") => void): () => void {
    this._connectionListeners.add(listener);
    return () => {
      this._connectionListeners.delete(listener);
    };
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
        this.wsTransport = new WebSocketTransport({ url: wsUrl, reconnect: false });
        const WS_CONNECT_TIMEOUT_MS = 15_000;
        await Promise.race([
          this.wsTransport.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("WebSocket connect timed out (15s)")),
              WS_CONNECT_TIMEOUT_MS,
            ),
          ),
        ]);
        this.client = createTypedClient<RPCMethods, RPCEvents>(this.wsTransport);
        this._reconnectDetected = false;
        this._reconnectAttempts = 0;
        this.setupReconnectDetection();

        const wsUrlObj = new URL(wsUrl);
        const httpProto = wsUrlObj.protocol === "wss:" ? "https:" : "http:";
        this._baseUrl = `${httpProto}//${wsUrlObj.host}`;

        // 启动时自动检测代理：后端有 PROXY_API_URL → 开启，否则关闭
        import("./proxy").then(({ tryEnable }) => tryEnable(wsUrlObj.host));
      }
    })();

    return this.initPromise;
  }

  private setupReconnectDetection(): void {
    if (!this.wsTransport) return;

    const transport = this.wsTransport;
    let wasConnected = transport.isConnected();

    if (this._reconnectCheckInterval) {
      clearInterval(this._reconnectCheckInterval);
    }

    this._reconnectCheckInterval = setInterval(() => {
      if (!this.wsTransport || this.wsTransport !== transport) {
        clearInterval(this._reconnectCheckInterval as ReturnType<typeof setInterval>);
        this._reconnectCheckInterval = null;
        return;
      }

      const connected = transport.isConnected();

      if (wasConnected && !connected) {
        this._reconnectDetected = true;
        this.setConnectionStatus("disconnected");
        this._scheduleReconnect();
      }

      if (!wasConnected && connected && this._reconnectDetected) {
        this._reconnectDetected = false;
        this.client = createTypedClient<RPCMethods, RPCEvents>(transport);
        this.initPromise = null;
        this._reconnectAttempts = 0;
        this.setConnectionStatus("connected");
        this._reconnectCallback?.();
      }

      wasConnected = connected;
    }, 2000);
  }

  private _scheduleReconnect(): void {
    if (this._stopped) return;
    if (this._reconnectTimer) return;

    const token = resolveAuthToken();
    if (!token && this._reconnectAttempts >= 3) {
      this.setConnectionStatus("disconnected");
      return;
    }
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this.setConnectionStatus("disconnected");
      return;
    }

    const delay = Math.min(this._baseReconnectDelay * Math.pow(2, this._reconnectAttempts), 30000);

    this._reconnectTimer = setTimeout(async () => {
      this._reconnectTimer = null;
      this._reconnectAttempts++;

      try {
        const freshUrl = this.getWebSocketUrl();
        const freshToken = resolveAuthToken();

        if (!freshToken) {
          this.setConnectionStatus("disconnected");
          return;
        }

        if (this.wsTransport) {
          try {
            this.wsTransport.close();
          } catch {
            /* ignore */
          }
        }

        this.wsTransport = new WebSocketTransport({ url: freshUrl, reconnect: false });
        const WS_RECONNECT_TIMEOUT_MS = 15_000;
        await Promise.race([
          this.wsTransport.connect(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("WebSocket reconnect timed out (15s)")),
              WS_RECONNECT_TIMEOUT_MS,
            ),
          ),
        ]);

        this._reconnectAttempts = 0;
        this.client = createTypedClient<RPCMethods, RPCEvents>(this.wsTransport);
        this.initPromise = null;
        this.setConnectionStatus("connected");
        this.setupReconnectDetection();
        this._reconnectCallback?.();
      } catch {
        this._scheduleReconnect();
      }
    }, delay);
  }

  private detectEnvironment(): "electrobun" | "browser" {
    if (typeof window === "undefined") return "browser";
    if (window.__electrobunBunBridge) return "electrobun";
    return "browser";
  }

  private getWebSocketUrl(): string {
    const token = resolveAuthToken();

    if (typeof window === "undefined") {
      return `ws://localhost:3100/ws?token=${token}`;
    }

    const customUrl =
      new URLSearchParams(window.location.search).get("ws") ??
      localStorage.getItem("rpc-websocket-url");
    if (customUrl) {
      return customUrl.includes("token=") ? customUrl : `${customUrl}?token=${token}`;
    }

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.host}/ws?token=${token}`;
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
    return resolveAuthToken();
  }

  async call<K extends keyof RPCMethods>(
    method: K,
    params: MethodParams<RPCMethods, K>,
  ): Promise<MethodResult<RPCMethods, K>> {
    await this.initialize();
    this.debugLog("call", method as string, params);
    try {
      if (!this.client) throw new Error("Client not initialized");
      const result = await this.client.call(method, params);
      this.debugLog("response", method as string, result);
      return result;
    } catch (err) {
      this.debugLog("response", method as string, {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async subscribe<K extends keyof RPCEvents>(
    eventType: K,
    handler: (payload: EventPayload<RPCEvents[K]>, metadata: EventMetadata<RPCEvents[K]>) => void,
    filter?: Record<string, unknown>,
  ): Promise<string> {
    await this.initialize();
    const wrappedHandler = (
      payload: EventPayload<RPCEvents[K]>,
      metadata: EventMetadata<RPCEvents[K]>,
    ) => {
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

  private debugLog(
    direction: "call" | "event" | "response",
    method: string,
    payload: unknown,
  ): void {
    if (!this._debugEnabled) return;
    try {
      useRpcDebugStore.getState().addEntry({
        direction,
        method: direction !== "event" ? method : undefined,
        eventType: direction === "event" ? method : undefined,
        payload,
      });
    } catch (err) {
      console.warn("[api-client] emit failed:", err);
    }
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

  destroy(): void {
    this._stopped = true;
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
    if (this._reconnectCheckInterval) {
      clearInterval(this._reconnectCheckInterval);
      this._reconnectCheckInterval = null;
    }
    if (this.wsTransport) {
      try {
        this.wsTransport.close();
      } catch {
        /* ignore */
      }
      this.wsTransport = null;
    }
  }
}

export const apiClient = new APIClientImpl();
export type { APIClientImpl, RPCMethods, RPCEvents };
