export interface RPCLogger {
  debug: (message: string, ...args: unknown[]) => void;
  info: (message: string, ...args: unknown[]) => void;
  error: (message: string, ...args: unknown[]) => void;
}

export interface RPCMessage {
  id: string;
  type: 'request' | 'response' | 'event' | 'subscribe' | 'unsubscribe';
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
  eventType?: string;
  filter?: SubscriptionFilter;
  subscriptionId?: string;
  payload?: unknown;
  sessionId?: string;
  source?: string;
  timestamp?: number;
}

export interface RPCRequest {
  id: string;
  type: 'request';
  method: string;
  params: unknown;
}

export interface RPCResponse {
  id: string;
  type: 'response';
  result?: unknown;
  error?: { code: number; message: string };
}

// ============================================
// 事件工具类型
// ============================================

/**
 * 定义必需 metadata 的事件
 */
export type EventWithMetadata<P, M> = { payload: P; metadata: M };

/**
 * 定义可选 metadata 的事件
 */
export type EventWithOptionalMetadata<P, M> = { payload: P; metadata?: M };

/**
 * 定义无 metadata 的事件
 */
export type EventWithoutMetadata<P> = { payload: P };

/**
 * 从事件定义中提取 payload 类型
 * 支持两种格式：
 * 1. 结构化定义 { payload: P; metadata?: M }
 * 2. 直接 payload 定义（向后兼容）
 */
export type EventPayload<E> = E extends { payload: infer P } ? P : E;

/**
 * 从事件定义中提取 metadata 类型
 * 支持两种格式：
 * 1. 结构化定义 { payload: P; metadata?: M }
 * 2. 直接 payload 定义（返回 undefined）
 */
export type EventMetadata<E> = E extends { metadata: infer M }
  ? M
  : E extends { metadata?: infer M }
    ? M | undefined
    : undefined;

// ============================================
// 默认事件元数据
// ============================================

export interface DefaultEventMetadata {
  sessionId?: string;
  source?: string;
}

// ============================================
// RPC 事件接口
// ============================================

export interface RPCEvent<Metadata = DefaultEventMetadata> {
  id: string;
  type: 'event';
  eventType: string;
  payload: unknown;
  metadata?: Metadata;
  timestamp: number;
}

export type SubscriptionFilter<Metadata = DefaultEventMetadata> = Partial<Metadata>;

export type RPCHandler = (params: unknown) => Promise<unknown>;

export interface EventHandler {
  (event: RPCEvent): void;
}

export interface StreamPayload {
  action: 'text_delta' | 'text_end' | 'tool_call' | 'done' | 'error';
  delta?: string;
  content?: string;
  error?: string;
}
