import { RPCClient, RPCServer, type Transport, type RPCHandler, type RPCEvent } from './index';
import type { EventPayload, EventMetadata } from './core/types';

type MethodParams<M, K extends keyof M> = M[K] extends { params: infer P } ? P : never;
type MethodResult<M, K extends keyof M> = M[K] extends { result: infer R } ? R : never;

type EventPayloadType<Events, K extends keyof Events> = EventPayload<Events[K]>;
type EventMetadataType<Events, K extends keyof Events> = EventMetadata<Events[K]>;

export interface TypedServer<Methods, Events> {
  handle: <K extends keyof Methods>(
    method: K,
    handler: (params: MethodParams<Methods, K>) => Promise<MethodResult<Methods, K>>
  ) => void;
  
  emit: <K extends keyof Events>(
    event: K,
    payload: EventPayloadType<Events, K>,
    metadata?: EventMetadataType<Events, K>
  ) => Promise<void>;

  clearAllSubscriptions: () => void;

  close: () => void;
}

export function createTypedServer<Methods, Events>(
  transport: Transport
): TypedServer<Methods, Events> {
  const server = new RPCServer(transport);

  return {
    handle: (method, handler) => {
      server.register(method as string, handler as RPCHandler);
    },

    emit: (event, payload, metadata) => {
      return server.emitEvent(event as string, payload, metadata);
    },

    clearAllSubscriptions: () => server.clearAllSubscriptions(),

    close: () => server.close(),
  };
}

export interface TypedClient<Methods, Events> {
  call: <K extends keyof Methods>(
    method: K,
    params: MethodParams<Methods, K>
  ) => Promise<MethodResult<Methods, K>>;
  
  subscribe: <K extends keyof Events>(
    event: K,
    handler: (payload: EventPayloadType<Events, K>, metadata: EventMetadataType<Events, K>) => void,
    filter?: Record<string, unknown>
  ) => string;
  
  unsubscribe: (subscriptionId: string) => void;

  close: () => void;
}

export function createTypedClient<Methods, Events>(
  transport: Transport,
  options?: { timeout?: number; onError?: (error: Error, context: string) => void }
): TypedClient<Methods, Events> {
  const client = new RPCClient({ transport, ...options });

  return {
    call: <K extends keyof Methods>(method: K, params: MethodParams<Methods, K>) => {
      return client.call<MethodResult<Methods, K>>(method as string, params);
    },

    subscribe: <K extends keyof Events>(
      event: K,
      handler: (payload: EventPayloadType<Events, K>, metadata: EventMetadataType<Events, K>) => void,
      filter: Record<string, unknown> = {}
    ): string => {
      return client.subscribe(event as string, filter, (e: RPCEvent) => {
        handler(e.payload as EventPayloadType<Events, K>, e.metadata as EventMetadataType<Events, K>);
      });
    },

    unsubscribe: (subscriptionId) => {
      client.unsubscribe(subscriptionId);
    },

    close: () => client.close(),
  };
}

export type { MethodParams, MethodResult };

export type AnyMethods = Record<string, { params: unknown; result: unknown }>;
export type AnyEvents = Record<string, unknown>;

type ExtractMethodImpl<T extends (...args: never[]) => unknown> = {
  params: Parameters<T>[0];
  result: Awaited<ReturnType<T>>;
};

export type ExtractMethods<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => Promise<unknown> ? K : never]: 
    T[K] extends (...args: never[]) => Promise<unknown> 
      ? ExtractMethodImpl<T[K]> 
      : never;
};

export type FnsToMethods<T> = {
  [K in keyof T as T[K] extends (...args: never[]) => Promise<unknown> ? K : never]: 
    T[K] extends (...args: never[]) => Promise<unknown> 
      ? ExtractMethodImpl<T[K]> 
      : never;
};

export interface RPCServerAPI {
  handle(method: string, handler: (params: unknown) => Promise<unknown>): void;
  emit(event: string, payload: unknown, metadata?: unknown): Promise<void>;
  close(): void;
}

export interface RPCClientAPI {
  call(method: string, params: unknown): Promise<unknown>;
  subscribe(event: string, handler: (payload: unknown, metadata: unknown) => void, filter?: Record<string, unknown>): string;
  unsubscribe(subscriptionId: string): void;
  close(): void;
}

export interface RPCModule<Methods extends AnyMethods = AnyMethods, Events extends AnyEvents = AnyEvents> {
  methods: Methods;
  events: Events;
  handlers: Record<string, (params: unknown) => Promise<unknown>>;
}

export interface RPCBuilder {
  method<P, R>(name: string, handler: (params: P) => Promise<R>): RPCBuilder;
  event<E>(name: string, sample: E): RPCBuilder;
  merge(module: RPCModule): RPCBuilder;
  toModule(): RPCModule;
  createServer(transport: Transport): RPCServerAPI;
  createClient(transport: Transport, options?: { timeout?: number }): RPCClientAPI;
}

class RPCBuilderImpl implements RPCBuilder {
  private methods: AnyMethods = {};
  private events: AnyEvents = {};
  private handlers: Record<string, (params: unknown) => Promise<unknown>> = {};

  method<P, R>(name: string, handler: (params: P) => Promise<R>): RPCBuilder {
    this.methods[name] = { params: {} as P, result: {} as R };
    this.handlers[name] = handler as (params: unknown) => Promise<unknown>;
    return this;
  }

  event<E>(name: string, sample: E): RPCBuilder {
    this.events[name] = sample;
    return this;
  }

  merge(module: RPCModule): RPCBuilder {
    this.methods = { ...this.methods, ...module.methods };
    this.events = { ...this.events, ...module.events };
    this.handlers = { ...this.handlers, ...module.handlers };
    return this;
  }

  toModule(): RPCModule {
    return {
      methods: this.methods,
      events: this.events,
      handlers: this.handlers,
    };
  }

  createServer(transport: Transport): RPCServerAPI {
    const server = new RPCServer(transport);
    
    for (const [method, handler] of Object.entries(this.handlers)) {
      if (handler) {
        server.register(method, handler);
      }
    }
    
    return {
      handle: (method, handler) => {
        server.register(method, handler);
      },
      emit: (event, payload, metadata) => {
        return server.emitEvent(event, payload, metadata);
      },
      close: () => server.close(),
    };
  }

  createClient(transport: Transport, options?: { timeout?: number }): RPCClientAPI {
    const client = new RPCClient({ transport, ...options });
    
    return {
      call: (method, params) => {
        return client.call(method, params);
      },
      subscribe: (event, handler, filter = {}) => {
        return client.subscribe(event, filter, (e: RPCEvent) => {
          handler(e.payload, e.metadata);
        });
      },
      unsubscribe: (subscriptionId) => {
        client.unsubscribe(subscriptionId);
      },
      close: () => client.close(),
    };
  }
}

export function defineRPC(): RPCBuilder {
  return new RPCBuilderImpl();
}

export function defineModule(builderFn: (rpc: RPCBuilder) => RPCBuilder): RPCModule {
  return builderFn(defineRPC()).toModule();
}
