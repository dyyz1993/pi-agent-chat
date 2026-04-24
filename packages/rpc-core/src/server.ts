import type { Transport } from './core/transport';
import type { RPCMessage, RPCHandler, RPCEvent, RPCLogger, DefaultEventMetadata } from './core/types';
import { generateId } from './core/utils';

export interface RPCServerOptions {
  logger?: RPCLogger;
}

export class RPCServer {
  private transport: Transport;
  private handlers: Map<string, RPCHandler> = new Map();
  private subscriptions: Map<string, { eventType: string; filter: Record<string, unknown> }> = new Map();
  private logger?: RPCServerOptions['logger'];
  private disconnectCleanup: (() => void) | null = null;

  constructor(transport: Transport, options?: RPCServerOptions) {
    this.transport = transport;
    this.logger = options?.logger;
    this.setupTransport();
    this.setupDisconnectHandler();
  }

  private setupTransport(): void {
    this.transport.onMessage((message) => {
      this.handleMessage(message as RPCMessage);
    });
  }

  private setupDisconnectHandler(): void {
    if (this.transport.onDisconnect) {
      this.disconnectCleanup = this.transport.onDisconnect(() => {
        console.log('[RPCServer] Client disconnected, clearing all subscriptions');
        this.logger?.debug?.('Client disconnected, clearing subscriptions');
        this.subscriptions.clear();
      });
    }
  }

  private async handleMessage(message: RPCMessage): Promise<void> {
    switch (message.type) {
      case 'request':
        await this.handleRequest(message);
        break;
      case 'subscribe':
        this.handleSubscribe(message);
        break;
      case 'unsubscribe':
        this.handleUnsubscribe(message);
        break;
    }
  }

  private async handleRequest(message: RPCMessage): Promise<void> {
    const handler = this.handlers.get(message.method!);
    
    if (!handler) {
      await this.transport.send({
        id: message.id,
        type: 'response',
        error: { code: 404, message: `Method not found: ${message.method}` },
      });
      return;
    }

    try {
      const result = await handler(message.params);
      await this.transport.send({
        id: message.id,
        type: 'response',
        result,
      });
    } catch (error) {
      await this.transport.send({
        id: message.id,
        type: 'response',
        error: { 
          code: 500, 
          message: error instanceof Error ? error.message : 'Internal server error' 
        },
      });
    }
  }

  private handleSubscribe(message: RPCMessage): void {
    const subscriptionId = message.id;
    const eventType = message.eventType!;
    const filter = message.filter || {};

    console.log('[RPCServer] handleSubscribe:', { subscriptionId, eventType, filter });
    this.subscriptions.set(subscriptionId, { eventType, filter });
    console.log('[RPCServer] Total subscriptions:', this.subscriptions.size);
    
    this.logger?.debug?.('Subscription added', { subscriptionId, eventType, filter });
  }

  private handleUnsubscribe(message: RPCMessage): void {
    const subscriptionId = message.subscriptionId!;
    this.subscriptions.delete(subscriptionId);
    
    this.logger?.debug?.('Subscription removed', { subscriptionId });
  }

  register(method: string, handler: RPCHandler): void {
    this.handlers.set(method, handler);
  }

  unregister(method: string): void {
    this.handlers.delete(method);
  }

  async emitEvent<Metadata = DefaultEventMetadata>(
    eventType: string, 
    payload: unknown, 
    metadata?: Metadata
  ): Promise<void> {
    const event: RPCEvent<Metadata> = {
      id: generateId(),
      type: 'event',
      eventType,
      payload,
      metadata,
      timestamp: Date.now(),
    };

    console.log('[RPCServer] emitEvent:', eventType, 'metadata:', metadata, 'subscriptions:', this.subscriptions.size);

    let hasMatchingSubscription = false;
    for (const [subId, sub] of this.subscriptions) {
      console.log('[RPCServer] Checking subscription:', subId, 'eventType:', sub.eventType, 'filter:', sub.filter);
      if (sub.eventType !== eventType) continue;
      
      if (this.shouldSendEvent(event, sub.filter)) {
        hasMatchingSubscription = true;
        break;
      } else {
        console.log('[RPCServer] Filter not matched, sub.filter:', sub.filter, 'event.metadata:', event.metadata);
      }
    }

    if (hasMatchingSubscription) {
      console.log('[RPCServer] Sending event to client');
      await this.transport.send(event);
    }
  }

  private shouldSendEvent<Metadata>(event: RPCEvent<Metadata>, filter: Record<string, unknown>): boolean {
    return this.matchFilter(event, filter);
  }

  private matchFilter<Metadata>(event: RPCEvent<Metadata>, filter: Record<string, unknown>): boolean {
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

  close(): void {
    if (this.disconnectCleanup) {
      this.disconnectCleanup();
    }
    this.handlers.clear();
    this.subscriptions.clear();
    this.transport.close();
  }

  clearAllSubscriptions(): void {
    console.log('[RPCServer] Clearing all subscriptions, count:', this.subscriptions.size);
    this.subscriptions.clear();
  }
}
