import { isNative } from '../index';
import type { IFileProvider, ImageResult, FileResult, UploadResult } from './types';

/**
 * Web 降级实现 — 使用浏览器原生 <input type="file"> 和 Clipboard API
 */
class WebFileProvider implements IFileProvider {
  async pickImage(options?: { multiple?: boolean; quality?: number }): Promise<ImageResult[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = options?.multiple ?? false;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        const results: ImageResult[] = await Promise.all(
          files.map(async (file) => ({
            uri: URL.createObjectURL(file),
            blob: file,
            name: file.name,
            size: file.size,
          })),
        );
        resolve(results);
      };
      input.click();
    });
  }

  async pickFile(options?: { multiple?: boolean; accept?: string[] }): Promise<FileResult[]> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = options?.multiple ?? false;
      if (options?.accept) input.accept = options.accept.join(',');
      input.onchange = () => {
        const files = Array.from(input.files || []);
        resolve(
          files.map((file) => ({
            uri: URL.createObjectURL(file),
            name: file.name,
            size: file.size,
            type: file.type,
            file,
          })),
        );
      };
      input.click();
    });
  }

  async upload(
    file: File | Blob,
    options: { path: string; token: string; baseUrl: string },
  ): Promise<UploadResult> {
    const resp = await fetch(
      `${options.baseUrl}/file/upload?path=${encodeURIComponent(options.path)}&token=${options.token}`,
      { method: 'POST', body: file },
    );
    return resp.json();
  }

  async pasteFromClipboard(): Promise<ImageResult | null> {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imageType = item.types.find((t) => t.startsWith('image/'));
        if (imageType) {
          const blob = await item.getType(imageType);
          return {
            uri: URL.createObjectURL(blob),
            blob,
            name: `paste-${Date.now()}.${imageType.split('/')[1] || 'png'}`,
            size: blob.size,
          };
        }
      }
    } catch {
      // Clipboard API 不可用，静默降级
    }
    return null;
  }
}

/**
 * 原生增强实现 — 使用 Capacitor Camera 插件
 * 覆盖 pickImage，其余复用 Web 实现
 */
class NativeFileProvider extends WebFileProvider {
  override async pickImage(options?: { multiple?: boolean; quality?: number }): Promise<ImageResult[]> {
    try {
      const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
      const photo = await Camera.getPhoto({
        quality: options?.quality ?? 80,
        resultType: CameraResultType.DataUrl,
        source: CameraSource.Prompt,
      });
      const blob = await fetch(photo.dataUrl!).then((r) => r.blob());
      return [
        {
          uri: photo.dataUrl!,
          blob,
          name: `photo-${Date.now()}.jpeg`,
          size: blob.size,
        },
      ];
    } catch {
      // Capacitor Camera 不可用时降级为 Web 实现
      return super.pickImage(options);
    }
  }
}

/** 工厂函数：根据平台返回对应的 Provider 实例 */
export function createFileProvider(): IFileProvider {
  return isNative() ? new NativeFileProvider() : new WebFileProvider();
}
