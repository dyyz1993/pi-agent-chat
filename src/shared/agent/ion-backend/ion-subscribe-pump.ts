/**
 * ion subscribe 泵 —— 会话事件长连接。
 *
 * 实测协议（contract-matrix.md §3）：
 *  - 建连 → （可选 hello，不消费连接）→ subscribe {session, replay} →
 *    ack{epoch} → snapshot 帧（.snapshot=true）→ replay 帧（replayed=true）→ 实时增量；
 *  - worker 重派：旧订阅收 stale_route 后被断开 —— 立即跳过退避重订；
 *  - 订阅 600s 空闲会被 host 断开 —— 断线自动重连（2s→30s 退避）；
 *  - instance_event 帧内层 event 交给 mapper 归一化为 AgentEvent。
 */

import net from "node:net";
import type { IonStreamFrame } from "./ion-types";
import { createEventMapper } from "./ion-event-map";
import { createLogger } from "../../lib/logger";

const log = createLogger("ion-subscribe");

export interface SubscribePumpOptions {
  socketPath: string;
  sessionId: string;
  replay?: number;
  onEvent: (event: unknown) => void;
  onReconnect?: (info: { reason: string; epoch?: number }) => void;
}

interface PumpState {
  running: boolean;
  epoch: number | null;
  hostId: string | null;
  attempt: number;
}

export class IonSubscribePump {
  private state: PumpState = { running: false, epoch: null, hostId: null, attempt: 0 };
  private socket: net.Socket | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;

  constructor(private options: SubscribePumpOptions) {}

  start(): void {
    if (this.state.running) return;
    this.state.running = true;
    void this.connectLoop();
  }

  stop(): void {
    this.state.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.socket?.destroy();
    this.socket = null;
  }

  private async connectLoop(): Promise<void> {
    while (this.state.running) {
      const outcome = await this.runOneConnection();
      if (!this.state.running) return;
      if (outcome.kind === "stale_route") {
        // epoch 栅栏：跳过退避立即重订
        this.options.onReconnect?.({ reason: "stale_route", epoch: outcome.epoch });
        continue;
      }
      this.state.attempt += 1;
      const delay = Math.min(30_000, 2_000 * Math.pow(1.6, Math.min(this.state.attempt, 8)));
      this.options.onReconnect?.({
        reason: outcome.kind,
        epoch: this.state.epoch ?? undefined,
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  private runOneConnection(): Promise<{ kind: string; epoch?: number }> {
    return new Promise((resolve) => {
      const mapper = createEventMapper(this.options.onEvent);
      const socket = net.createConnection(this.options.socketPath);
      this.socket = socket;
      let buffer = "";
      let settledKind: string | null = null;

      const settle = (kind: string, epoch?: number) => {
        if (settledKind) return;
        settledKind = kind;
        socket.destroy();
        this.socket = null;
        resolve({ kind, epoch });
      };

      socket.on("connect", () => {
        // 先 hello 记录 hostId（不消费连接），再 subscribe。
        // 实测协议：session/replay 是请求顶层字段（与 method 平级），不是 params。
        socket.write(`${JSON.stringify({ id: "pump-hello", method: "hello", params: {} })}\n`);
        socket.write(
          `${JSON.stringify({
            id: "pump-sub",
            method: "subscribe",
            session: this.options.sessionId,
            replay: this.options.replay ?? 0,
          })}\n`,
        );
      });

      socket.on("data", (chunk: Buffer) => {
        buffer += chunk.toString("utf-8");
        let idx: number;
        while ((idx = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, idx).trim();
          buffer = buffer.slice(idx + 1);
          if (!line) continue;
          let frame: IonStreamFrame;
          try {
            frame = JSON.parse(line) as IonStreamFrame;
          } catch {
            continue;
          }
          this.handleFrame(frame, mapper, settle);
        }
      });

      socket.on("error", () => settle("socket_error"));
      socket.on("close", () => settle("socket_closed"));
    });
  }

  private handleFrame(
    frame: IonStreamFrame,
    mapper: ReturnType<typeof createEventMapper>,
    settle: (kind: string, epoch?: number) => void,
  ): void {
    // 响应行（hello/subscribe 回包）：记录 hostId/epoch，不外发
    if (frame.type === "response" || (frame as { success?: boolean }).success !== undefined) {
      const params = frame as unknown as { hostId?: string; epoch?: number };
      if (typeof params.hostId === "string" && params.hostId !== this.state.hostId) {
        if (this.state.hostId !== null) {
          log.info("ion host restarted (hostId changed)", { session: this.options.sessionId });
        }
        this.state.hostId = params.hostId;
      }
      if (typeof params.epoch === "number") this.state.epoch = params.epoch;
      return;
    }
    if (frame.type === "stale_route") {
      settle("stale_route", frame.currentEpoch);
      return;
    }
    if (frame.type === "subscribed" || frame.snapshot === true) {
      if (typeof frame.epoch === "number") this.state.epoch = frame.epoch;
      return; // ack/snapshot 只记录
    }
    if (frame.type === "instance_event" && frame.event) {
      if (typeof frame.epoch === "number") this.state.epoch = frame.epoch;
      mapper(frame.event);
      this.state.attempt = 0; // 收到增量说明链路健康
      return;
    }
    // 兜底：params 形态误订阅时的 customType 信封帧（data.event 嵌套或 data 平铺）。
    // 正确的顶层 session 订阅不会走到这里，但保留防御避免静默丢事件。
    const custom = frame as unknown as { customType?: string; data?: unknown; extension?: string };
    if (typeof custom.customType === "string" && custom.data) {
      const data = custom.data as { event?: IonStreamFrame["event"]; type?: string };
      const inner = data.event ?? (data.type ? (data as IonStreamFrame["event"]) : undefined);
      if (inner && typeof inner.type === "string") {
        mapper(inner);
        this.state.attempt = 0;
      }
    }
  }
}
