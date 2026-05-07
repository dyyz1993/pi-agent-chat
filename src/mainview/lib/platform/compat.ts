/**
 * 向后兼容层
 *
 * 逐步替换现有代码中的平台硬编码，减少迁移风险。
 * 所有兼容函数内部使用 Platform Bridge。
 */

import { getPlatform, isNative, isDesktop } from './index';

/**
 * 替代 api-client.ts 中的 detectEnvironment()
 * 新增对 android / ios 平台的识别
 */
export function detectEnvironment(): 'electrobun' | 'android' | 'ios' | 'browser' {
  const platform = getPlatform();
  if (platform === 'desktop') return 'electrobun';
  if (platform === 'android') return 'android';
  if (platform === 'ios') return 'ios';
  return 'browser';
}

/** 替代各处 typeof Notification 检测 */
export function canUseNotificationAPI(): boolean {
  if (isNative()) return false;
  return typeof Notification !== 'undefined';
}

/** 替代 use-explorer-store.ts 中的 file:// 判断 */
export function useFileProtocol(): boolean {
  return isDesktop();
}
