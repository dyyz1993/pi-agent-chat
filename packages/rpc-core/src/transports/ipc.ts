import type { Transport, MessageHandler, ErrorHandler } from '../core/transport';
import type { RPCLogger } from '../core/types';

export interface IPCTransportOptions {
  logger?: RPCLogger;
}

export class IPCTransport implements Transport {
  private messageHandlers: Set<MessageHandler> = new Set();
  private errorHandlers: Set<ErrorHandler> = new Set();
  private logger?: IPCTransportOptions['logger'];

  constructor(options?: IPCTransportOptions) {
    this.logger = options?.logger;
  }

  async send(message: unknown): Promise<void> {
    this.logger?.debug?.('IPC send', message);
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
    return true;
  }

  close(): void {
    this.messageHandlers.clear();
    this.errorHandlers.clear();
  }

  simulateMessage(message: unknown): void {
    for (const handler of this.messageHandlers) {
      handler(message);
    }
  }
}
