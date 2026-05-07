import { isNative } from '../index';
import type { IStorageProvider } from './types';

/**
 * Web 降级实现 — 使用 localStorage
 */
class WebStorageProvider implements IStorageProvider {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }

  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }

  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }

  async clear(): Promise<void> {
    localStorage.clear();
  }
}

/**
 * 原生增强实现 — 使用 Capacitor Preferences 插件
 * 原生端存储到 SharedPreferences (Android) / UserDefaults (iOS)
 */
class NativeStorageProvider implements IStorageProvider {
  async get(key: string): Promise<string | null> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      const result = await Preferences.get({ key });
      return result.value;
    } catch {
      return localStorage.getItem(key);
    }
  }

  async set(key: string, value: string): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.set({ key, value });
    } catch {
      localStorage.setItem(key, value);
    }
  }

  async remove(key: string): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.remove({ key });
    } catch {
      localStorage.removeItem(key);
    }
  }

  async clear(): Promise<void> {
    try {
      const { Preferences } = await import('@capacitor/preferences');
      await Preferences.clear();
    } catch {
      localStorage.clear();
    }
  }
}

export function createStorageProvider(): IStorageProvider {
  return isNative() ? new NativeStorageProvider() : new WebStorageProvider();
}
