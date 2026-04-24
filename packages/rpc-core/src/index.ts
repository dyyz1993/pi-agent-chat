export { RPCClient, type RPCClientOptions } from './client';
export { RPCServer, type RPCServerOptions } from './server';
export { IPCTransport, type IPCTransportOptions } from './transports/ipc';
export { WebSocketTransport, type WebSocketTransportOptions } from './transports/websocket';
export { InMemoryTransport, type InMemoryTransportOptions } from './transports/in-memory';
export { 
  createTypedServer, 
  createTypedClient,
  defineRPC,
  defineModule,
  type TypedServer,
  type TypedClient,
  type MethodParams,
  type MethodResult,
  type AnyMethods,
  type AnyEvents,
  type RPCServerAPI,
  type RPCClientAPI,
  type RPCModule,
  type ExtractMethods,
  type FnsToMethods,
} from './typed';
export type { Transport, MessageHandler, ErrorHandler, DisconnectHandler } from './core/transport';
export type { 
  RPCMessage, 
  RPCRequest, 
  RPCResponse, 
  RPCEvent, 
  SubscriptionFilter, 
  EventHandler,
  StreamPayload,
  RPCHandler,
  RPCLogger,
  DefaultEventMetadata,
  EventWithMetadata,
  EventWithOptionalMetadata,
  EventWithoutMetadata,
  EventPayload,
  EventMetadata
} from './core/types';
