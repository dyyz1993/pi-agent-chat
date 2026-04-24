/**
 * System 模块 — 基础连通性 & 调试
 */
export interface SystemMethods {
  "system.ping": { params: {}; result: { pong: boolean; timestamp: number; platform: string } };
  "system.hello": { params: { name?: string }; result: { message: string; timestamp: number } };
  "system.echo": { params: unknown; result: unknown };
}
