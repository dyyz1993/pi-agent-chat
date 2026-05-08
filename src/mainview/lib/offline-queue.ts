import { createLogger } from "../../shared/lib/logger";

const logger = createLogger("offline-queue");

/**
 * 离线消息队列
 *
 * 当 WebSocket 断线时，用户发送的消息暂存在队列中。
 * 连接恢复后自动 flush 发送。
 *
 * 使用 localStorage 持久化，页面刷新不丢失。
 */

const QUEUE_KEY = "pi-agent-offline-queue";

interface QueuedMessage {
  id: string;
  sessionId: string;
  content: string;
  attachments?: string[];
  timestamp: number;
}

class OfflineQueue {
  private queue: QueuedMessage[] = [];
  private loaded = false;

  private load(): void {
    if (this.loaded) return;
    try {
      const raw = localStorage.getItem(QUEUE_KEY);
      this.queue = raw ? (JSON.parse(raw) as QueuedMessage[]) : [];
    } catch {
      this.queue = [];
    }
    this.loaded = true;
  }

  private save(): void {
    try {
      localStorage.setItem(QUEUE_KEY, JSON.stringify(this.queue));
    } catch {
      // localStorage 满了或不可用，静默失败
    }
  }

  /** 入队一条消息 */
  enqueue(message: Omit<QueuedMessage, "id" | "timestamp">): QueuedMessage {
    this.load();
    const item: QueuedMessage = {
      ...message,
      id: `offline-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    };
    this.queue.push(item);
    this.save();
    logger.debug("消息已入队", { id: item.id, length: this.queue.length });
    return item;
  }

  /** 获取所有待发送消息 */
  peekAll(): QueuedMessage[] {
    this.load();
    return [...this.queue];
  }

  /** 队列长度 */
  size(): number {
    this.load();
    return this.queue.length;
  }

  /** 是否有待发送消息 */
  hasPending(): boolean {
    return this.size() > 0;
  }

  /**
   * Flush: 逐条发送队列中的消息
   *
   * @param sendFn 实际发送函数（调用 RPC 发消息）
   * @returns 发送成功的数量
   */
  async flush(sendFn: (msg: QueuedMessage) => Promise<boolean>): Promise<number> {
    this.load();
    if (this.queue.length === 0) return 0;

    logger.info("开始 flush", { length: this.queue.length });
    let sent = 0;

    while (this.queue.length > 0) {
      const item = this.queue[0];
      try {
        const success = await sendFn(item);
        if (success) {
          this.queue.shift();
          sent++;
        } else {
          break;
        }
      } catch (err) {
        logger.warn("flush 发送失败", { error: err });
        break;
      }
    }

    this.save();
    logger.info("flush 完成", { sent, remaining: this.queue.length });
    return sent;
  }

  /** 清空队列 */
  clear(): void {
    this.queue = [];
    this.save();
  }
}

export const offlineQueue = new OfflineQueue();
