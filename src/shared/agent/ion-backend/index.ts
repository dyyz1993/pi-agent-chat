/**
 * ion 后端入口 —— PI_BACKEND=ion 时启用（见 docs/plans/2026-09-25-ion-backend-adoption-plan.md）。
 * extension-first 铁律：app 侧只做传输适配 + 声明式映射 + 能力开关，不做业务 shim。
 */

export { IonRpcClient, asRpcClientAPI } from "./ion-rpc-client";
export type { IonRpcClientOptions } from "./ion-rpc-client";
export { IonSocketTransport, resolveIonSocketPath, ionQuickCall } from "./ion-socket-transport";
export { IonSubscribePump } from "./ion-subscribe-pump";
export { createEventMapper } from "./ion-event-map";
export { flattenIonMessages, flattenIonMessage } from "./ion-flatten";
export { fetchIonSessionStatuses } from "./ion-session-status";
export type { IonSessionRuntimeStatus } from "./ion-session-status";
export { ION_CHANNEL_MAP, lookupIonChannel } from "./channel-map";
export type { IonChannelTarget, IonChannelMapping, IonExtensionMapping } from "./channel-map";

/** PI_BACKEND=ion（大小写不敏感）即启用 ion 后端；默认 pi */
export function isIonBackendEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.PI_BACKEND ?? "").toLowerCase() === "ion";
}
