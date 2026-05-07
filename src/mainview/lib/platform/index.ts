/**
 * Platform Bridge — 平台中间层入口
 *
 * 核心原则：
 * - Web 版本 100% 独立可用，不依赖任何原生能力
 * - App 版本自动增强原生能力
 * - 业务代码只调用 Bridge API，不感知平台
 * - 渐进增强：原生能力不可用时自动降级为 Web 实现
 */

export type Platform = 'web' | 'android' | 'ios' | 'desktop';

let _platform: Platform | null = null;

/**
 * 获取当前运行平台（延迟计算，只算一次）
 *
 * 检测优先级：
 * 1. Electrobun 桌面端 — window.__electrobunBunBridge
 * 2. Capacitor 原生 App — window.Capacitor
 * 3. 纯 Web 浏览器 — 兜底
 */
export function getPlatform(): Platform {
  if (_platform) return _platform;

  if (typeof window !== 'undefined') {
    // Electrobun 桌面端
    if ((window as any).__electrobunBunBridge) {
      _platform = 'desktop';
      return _platform;
    }

    // Capacitor 原生 App
    const cap = (window as any).Capacitor;
    if (cap?.isNativePlatform?.()) {
      const raw = cap.getPlatform();
      _platform = raw === 'ios' ? 'ios' : 'android';
      return _platform;
    }
  }

  // 纯 Web 浏览器
  _platform = 'web';
  return _platform;
}

/** 当前是否为原生平台（Android / iOS） */
export function isNative(): boolean {
  const p = getPlatform();
  return p === 'android' || p === 'ios';
}

/** 当前是否为桌面端（Electrobun） */
export function isDesktop(): boolean {
  return getPlatform() === 'desktop';
}

/** 当前是否为纯 Web 浏览器 */
export function isWeb(): boolean {
  return getPlatform() === 'web';
}

export { platformBridge } from './bridge';
