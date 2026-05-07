import { isNative } from '../index';
import type { IWebViewProvider, WebViewHandle } from './types';

/**
 * Web 降级实现 — 使用 <iframe>
 */
class WebWebViewProvider implements IWebViewProvider {
  render(options: { src: string; sandbox?: string; className?: string }): WebViewHandle {
    const iframe = document.createElement('iframe');
    iframe.src = options.src;
    iframe.style.border = 'none';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    if (options.sandbox) iframe.sandbox.add(options.sandbox);
    if (options.className) iframe.className = options.className;

    return {
      destroy() {
        iframe.remove();
      },
      getElement() {
        return iframe;
      },
    };
  }

  async openInNewWindow(options: { src: string; title?: string }): Promise<void> {
    window.open(options.src, '_blank', 'noopener,noreferrer');
  }
}

/**
 * 原生增强实现 — 使用 Capacitor Browser 插件打开新窗口
 * render 方法暂仍用 iframe（后续可替换为原生 WebView 面板）
 */
class NativeWebViewProvider extends WebWebViewProvider {
  override async openInNewWindow(options: { src: string; title?: string }): Promise<void> {
    try {
      const { Browser } = await import('@capacitor/browser');
      await Browser.open({ url: options.src });
    } catch {
      await super.openInNewWindow(options);
    }
  }

  enableRemoteDebug(): void {
    if (typeof window !== 'undefined') {
      console.log('[PlatformBridge] WebView remote debug enabled');
      // Android 可通过 chrome://inspect 调试
    }
  }
}

export function createWebViewProvider(): IWebViewProvider {
  return isNative() ? new NativeWebViewProvider() : new WebWebViewProvider();
}
