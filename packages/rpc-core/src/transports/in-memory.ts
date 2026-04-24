import type { Transport, MessageHandler, ErrorHandler } from '../core/transport';
import type { RPCLogger } from '../core/types';

export interface InMemoryTransportOptions {
  logger?: RPCLogger;
}

export class InMemoryTransport implements Transport {
  private peer: InMemoryTransport | null = null;
  private messageHandlers: Set<MessageHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private _isConnected: boolean = false;

  constructor(_options?: InMemoryTransportOptions) {
    // options reserved for future use (e.g. logger)
  }

  static createPair(options?: InMemoryTransportOptions): { client: InMemoryTransport; server: InMemoryTransport } {
    const client = new InMemoryTransport(options);
    const server = new InMemoryTransport(options);

    client.peer = server;
    server.peer = client;
    client._isConnected = true;
    server._isConnected = true;

    return { client, server };
  }

  async send(message: unknown): Promise<void> {
    if (!this._isConnected) {
      throw new Error('Transport is not connected');
    }

    if (!this.peer) {
      throw new Error('No peer connected');
    }

    for (const handler of this.peer.messageHandlers) {
      handler(message);
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
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
    this._isConnected = false;
    if (this.peer) {
      this.peer._isConnected = false;
      this.peer = null;
    }
    this.messageHandlers.clear();
    this.errorHandlers.clear();
  }

  simulateError(error: Error): void {
    for (const handler of this.errorHandlers) {
      handler(error);
    }
  }
}
