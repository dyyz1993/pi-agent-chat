import type { Transport, MessageHandler, ErrorHandler } from '../core/transport';
import type { RPCLogger } from '../core/types';

export interface WebSocketTransportOptions {
  url?: string;
  logger?: RPCLogger;
  reconnect?: boolean;
  reconnectInterval?: number;
}

export class WebSocketTransport implements Transport {
  private url: string;
  private ws: WebSocket | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private logger?: WebSocketTransportOptions['logger'];
  private reconnect: boolean;
  private reconnectInterval: number;
  private _isConnected: boolean = false;
  private _isConnecting: boolean = false;

  constructor(urlOrOptions: string | WebSocketTransportOptions) {
    if (typeof urlOrOptions === 'string') {
      this.url = urlOrOptions;
    } else {
      this.url = urlOrOptions.url || '';
    }
    this.logger = typeof urlOrOptions === 'object' ? urlOrOptions.logger : undefined;
    this.reconnect = typeof urlOrOptions === 'object' ? (urlOrOptions.reconnect ?? true) : true;
    this.reconnectInterval = typeof urlOrOptions === 'object' ? (urlOrOptions.reconnectInterval ?? 3000) : 3000;
  }

  async connect(): Promise<void> {
    if (this._isConnecting) {
      return;
    }

    this._isConnecting = true;

    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }

    return new Promise((resolve, reject) => {
      console.log('[WebSocketTransport] Creating new WebSocket to:', this.url);
      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        this._isConnected = true;
        this._isConnecting = false;
        console.log('[WebSocketTransport] Connected, messageHandlers:', this.messageHandlers.size);
        this.logger?.info?.('WebSocket connected');
        resolve();
      };

      this.ws.onmessage = (event) => {
        console.log('[WebSocketTransport] onmessage triggered, data length:', event.data?.length);
        try {
          const message = JSON.parse(event.data);
          console.log('[WebSocketTransport] Parsed message:', message.type, 'id:', message.id);
          if (this.messageHandlers.size === 0) {
            console.warn('[WebSocketTransport] WARNING: No message handlers registered!');
          }
          for (const handler of this.messageHandlers) {
            handler(message);
          }
        } catch (error) {
          console.error('[WebSocketTransport] Failed to parse message:', error);
          this.logger?.error?.('Failed to parse message', error);
        }
      };

      this.ws.onerror = (error) => {
        this._isConnecting = false;
        console.error('[WebSocketTransport] Error:', error);
        this.logger?.error?.('WebSocket error', error);
        reject(new Error('WebSocket connection failed'));
        for (const handler of this.errorHandlers) {
          handler(new Error('WebSocket error'));
        }
      };

      this.ws.onclose = () => {
        this._isConnected = false;
        this._isConnecting = false;
        console.log('[WebSocketTransport] Disconnected');
        this.logger?.info?.('WebSocket disconnected');
        
        if (this.reconnect) {
          console.log('[WebSocketTransport] Will reconnect in', this.reconnectInterval, 'ms');
          setTimeout(() => {
            console.log('[WebSocketTransport] Reconnecting...');
            this.connect().catch(e => console.error('[WebSocketTransport] Reconnect failed:', e));
          }, this.reconnectInterval);
        }
      };
    });
  }

  async send(message: unknown): Promise<void> {
    if (!this.ws || !this._isConnected) {
      throw new Error('WebSocket is not connected');
    }

    this.ws.send(JSON.stringify(message));
  }

  onMessage(handler: MessageHandler): () => void {
    console.log('[WebSocketTransport] Adding message handler, current count:', this.messageHandlers.size);
    this.messageHandlers.add(handler);
    console.log('[WebSocketTransport] After adding, count:', this.messageHandlers.size);
    return () => {
      this.messageHandlers.delete(handler);
    };
  }

  onError(handler: ErrorHandler): () => void {
    this.errorHandlers.add(handler);
    return () => {
      this.errorHandlers.delete(handler);
    };
  }

  isConnected(): boolean {
    return this._isConnected;
  }

  close(): void {
    console.log('[WebSocketTransport] Closing, messageHandlers:', this.messageHandlers.size);
    this.reconnect = false;
    if (this.ws) {
      this.ws.onopen = null;
      this.ws.onmessage = null;
      this.ws.onerror = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
    this._isConnected = false;
    this._isConnecting = false;
  }
}
