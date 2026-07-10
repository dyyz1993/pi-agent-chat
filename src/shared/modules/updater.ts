/**
 * Updater 模块 — 桌面端自动更新
 * 仅 desktop 平台可用，web 端返回空/不可用
 */
export interface UpdaterMethods {
  "updater.check": {
    params: {};
    result: {
      version: string;
      hash: string;
      updateAvailable: boolean;
      updateReady: boolean;
      error: string;
    };
  };
  "updater.download": {
    params: {};
    result: { ok: boolean; error?: string };
  };
  "updater.apply": {
    params: {};
    result: { ok: boolean; error?: string };
  };
  "updater.status": {
    params: {};
    result: {
      entries: Array<{
        status: string;
        message: string;
        timestamp: number;
        details?: Record<string, unknown>;
      }>;
    };
  };
}
