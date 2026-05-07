import { getPlatform, isNative } from './index';
import type { Platform } from './index';
import type { IFileProvider } from './providers/types';
import type { INotifyProvider } from './providers/types';
import type { IWebViewProvider } from './providers/types';
import type { IVoiceProvider } from './providers/types';
import type { IStorageProvider } from './providers/types';
import type { IDeepLinkProvider } from './providers/types';
import {
  createFileProvider,
  createNotifyProvider,
  createWebViewProvider,
  createVoiceProvider,
  createStorageProvider,
  createDeepLinkProvider,
} from './providers';

/**
 * PlatformBridge — 统一平台能力入口
 *
 * 所有业务代码通过 platformBridge.xxx 访问平台能力。
 * Provider 内部根据平台自动选择 Web 实现 or 原生实现。
 *
 * 用法：
 *   import { platformBridge } from '@/lib/platform';
 *   const images = await platformBridge.file.pickImage();
 *   await platformBridge.notify.sendLocalNotification({ title, body });
 */
class PlatformBridge {
  readonly platform: Platform;
  readonly file: IFileProvider;
  readonly notify: INotifyProvider;
  readonly webview: IWebViewProvider;
  readonly voice: IVoiceProvider;
  readonly storage: IStorageProvider;
  readonly deeplink: IDeepLinkProvider;

  constructor() {
    this.platform = getPlatform();
    this.file = createFileProvider();
    this.notify = createNotifyProvider();
    this.webview = createWebViewProvider();
    this.voice = createVoiceProvider();
    this.storage = createStorageProvider();
    this.deeplink = createDeepLinkProvider();
  }

  get isNative(): boolean {
    return isNative();
  }

  get isWeb(): boolean {
    return this.platform === 'web';
  }

  get isDesktop(): boolean {
    return this.platform === 'desktop';
  }
}

export const platformBridge = new PlatformBridge();
