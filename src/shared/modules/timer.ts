/**
 * Timer 模块 — 定时器 & 事件推送
 */
export interface TimerMethods {
  "timer.start": { params: {}; result: { started?: boolean; alreadyRunning?: boolean } };
  "timer.stop": { params: {}; result: { stopped: boolean } };
}

export interface TimerEvents {
  "timer.tick": { count: number; timestamp: number };
}
