/**
 * ion 后端公共类型。
 *
 * ion host 协议（Unix socket JSONL）实测契约见
 * docs/plans/ion-backend/contract-matrix.md。两种响应信封：
 *  - worker 转发：{ id, command, data, success, type: "response" }
 *  - host 直答：  { id, data, session, success }（无 command/type）
 * soft-error：success:true 但 data.error 为 string —— 客户端必须当失败处理。
 */

export interface IonRpcEnvelope {
  id?: string;
  command?: string;
  method?: string;
  data?: unknown;
  error?: string;
  success?: boolean;
  type?: string;
  session?: string;
}

/** subscribe 泵收到的帧（instance_event 的内层 event 另见 IonInstanceEvent） */
export interface IonStreamFrame {
  type?: string;
  session?: string;
  epoch?: number;
  currentEpoch?: number;
  snapshot?: boolean;
  replayed?: boolean;
  event?: IonInstanceEvent;
}

export interface IonInstanceEvent {
  type?: string;
  sessionId?: string;
  timestamp?: number;
  // text_delta
  delta?: string;
  // tool_call_delta
  toolName?: string;
  // tool_execution_*
  toolCallId?: string;
  args?: unknown;
  partialResult?: unknown;
  result?: unknown;
  isError?: boolean;
  durationMs?: number;
  // message_start/end（形状防御式读取）
  message?: unknown;
  usage?: unknown;
  model?: string;
  provider?: string;
  // extension_event
  extension?: string;
  customType?: string;
  data?: unknown;
}

/** ion get_messages 系列的 Rust 枚举消息形态 */
export interface IonEnumMessage {
  id?: string;
  message?: Record<string, IonEnumMessageBody | undefined>;
  [variant: string]: unknown;
}

export interface IonEnumMessageBody {
  role?: string;
  content?: unknown;
  timestamp?: number;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  model?: string;
  provider?: string;
  usage?: unknown;
  stopReason?: string;
}
