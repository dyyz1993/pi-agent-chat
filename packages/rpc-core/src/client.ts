import type { Transport } from './core/transport';
import type { RPCMessage, RPCEvent, EventHandler } from './core/types';
import { generateId } from './core/utils';

export interface RPCClientOptions {
  transport: Transport;
  timeout?: number;
  onError?: (error: Error, context: string) => void;
}

export class RPCClient {
  private transport: Transport;
  private timeout: number;
  private pendingRequests: Map<string, {
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
  }> = new Map();
  private subscriptions: Map<string, { eventType: string; filter: Record<string, unknown>; handler: EventHandler }> = new Map();
  private subscriptionKeys: Map<string, string> = new Map();
  private onError?: (error: Error, context: string) => void;

  constructor(options: RPCClientOptions) {
    this.transport = options.transport;
    this.timeout = options.timeout || 30000;
    this.onError = options.onError;
    this.setupTransport();
  }

  private setupTransport(): void {
    console.log('[RPCClient] setupTransport called, registering message handler');
    this.transport.onMessage((message) => {
      const msg = message as RPCMessage;
      console.log('[RPCClient] Received message in handler:', msg.type, 'id:', msg.id);
      this.handleMessage(msg);
    });
  }

  private handleMessage(message: RPCMessage): void {
    switch (message.type) {
      case 'response':
        this.handleResponse(message);
        break;
      case 'event':
        this.handleEvent(message as RPCEvent);
        break;
    }
  }

  private handleResponse(message: RPCMessage): void {
    const pending = this.pendingRequests.get(message.id);
    
    if (!pending) return;

    this.pendingRequests.delete(message.id);

    if (message.error) {
      pending.reject(new Error(message.error.message));
    } else {
      pending.resolve(message.result);
    }
  }

  private handleEvent(event: RPCEvent): void {
    console.log('[RPCClient] handleEvent:', event.eventType, 'metadata:', event.metadata, 'subscriptions:', this.subscriptions.size);
    for (const [subId, sub] of this.subscriptions) {
      console.log('[RPCClient] Checking subscription:', subId, 'eventType:', sub.eventType, 'filter:', sub.filter);
      if (sub.eventType !== event.eventType) continue;
      if (this.matchFilter(event, sub.filter)) {
        console.log('[RPCClient] Matched! Calling handler for:', subId);
        sub.handler(event);
      } else {
        console.log('[RPCClient] Filter not matched');
      }
    }
  }

  private matchFilter(event: RPCEvent, filter: Record<string, unknown>): boolean {
    if (!filter || Object.keys(filter).length === 0) {
      return true;
    }

    if (!event.metadata) {
      return false;
    }

    for (const key in filter) {
      const filterValue = filter[key];
      const eventValue = (event.metadata as Record<string, unknown>)[key];
      
      if (filterValue !== undefined && eventValue !== filterValue) {
        return false;
      }
    }

    return true;
  }

  async call<T = unknown>(method: string, params: unknown): Promise<T> {
    const id = generateId();
    const message: RPCMessage = {
      id,
      type: 'request',
      method,
      params,
    };
    
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request timeout: ${method}`));
      }, this.timeout);

      this.pendingRequests.set(id, {
        resolve: (value) => {
          clearTimeout(timeoutId);
          resolve(value as T);
        },
        reject: (error) => {
          clearTimeout(timeoutId);
          reject(error);
        },
      });

      this.transport.send(message).catch(error => {
        this.pendingRequests.delete(id);
        clearTimeout(timeoutId);
        reject(error);
      });
    });
  }

  private generateSubscriptionKey(eventType: string, filter: Record<string, unknown>): string {
    const filterStr = Object.keys(filter).length > 0 
      ? JSON.stringify(Object.entries(filter).sort(([a], [b]) => a.localeCompare(b)))
      : '';
    return `${eventType}:${filterStr}`;
  }

  subscribe(eventType: string, filter: Record<string, unknown>, handler: EventHandler): string {
    const subscriptionKey = this.generateSubscriptionKey(eventType, filter);
    
    const existingSubId = this.subscriptionKeys.get(subscriptionKey);
    if (existingSubId) {
      console.log('[RPCClient] Reusing existing subscription:', existingSubId, 'for key:', subscriptionKey);
      const existing = this.subscriptions.get(existingSubId);
      if (existing) {
        this.subscriptions.set(existingSubId, { ...existing, handler });
        return existingSubId;
      }
    }

    const subscriptionId = generateId();

    this.subscriptions.set(subscriptionId, { eventType, filter, handler });
    this.subscriptionKeys.set(subscriptionKey, subscriptionId);

    const message: RPCMessage = {
      id: subscriptionId,
      type: 'subscribe',
      eventType,
      filter,
    };

    console.log('[RPCClient] Sending subscribe message:', message, 'key:', subscriptionKey);
    this.transport.send(message).catch(error => {
      console.error('[RPCClient] Subscribe error:', error);
      this.onError?.(error, 'subscribe');
    });

    return subscriptionId;
  }

  unsubscribe(subscriptionId: string): void {
    const sub = this.subscriptions.get(subscriptionId);
    if (sub) {
      const key = this.generateSubscriptionKey(sub.eventType, sub.filter);
      this.subscriptionKeys.delete(key);
    }
    this.subscriptions.delete(subscriptionId);

    const message: RPCMessage = {
      id: generateId(),
      type: 'unsubscribe',
      subscriptionId,
    };

    this.transport.send(message).catch(error => {
      this.onError?.(error, 'unsubscribe');
    });
  }

  close(): void {
    this.pendingRequests.clear();
    this.subscriptions.clear();
    this.subscriptionKeys.clear();
    this.transport.close();
  }

  isConnected(): boolean {
    return this.transport.isConnected();
  }
}
