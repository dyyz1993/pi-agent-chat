/**
 * 桌面端自动更新接口
 *
 * 使用 setter 模式（同 native-clipboard.ts），
 * 桌面端（src/bun/index.ts）设置具体实现，
 * updater handler 通过此模块调用。
 */

export type CheckForUpdateFn = () => Promise<{
  version: string;
  hash: string;
  updateAvailable: boolean;
  updateReady: boolean;
  error: string;
}>;

export type DownloadUpdateFn = () => Promise<{ ok: boolean; error?: string }>;

export type ApplyUpdateFn = () => Promise<{ ok: boolean; error?: string }>;

export type GetUpdateStatusFn = () => Promise<{
  entries: Array<{
    status: string;
    message: string;
    timestamp: number;
    details?: Record<string, unknown>;
  }>;
}>;

let _checkForUpdate: CheckForUpdateFn | null = null;
let _downloadUpdate: DownloadUpdateFn | null = null;
let _applyUpdate: ApplyUpdateFn | null = null;
let _getUpdateStatus: GetUpdateStatusFn | null = null;

export function setCheckForUpdateFn(fn: CheckForUpdateFn): void {
  _checkForUpdate = fn;
}

export function setDownloadUpdateFn(fn: DownloadUpdateFn): void {
  _downloadUpdate = fn;
}

export function setApplyUpdateFn(fn: ApplyUpdateFn): void {
  _applyUpdate = fn;
}

export function setGetUpdateStatusFn(fn: GetUpdateStatusFn): void {
  _getUpdateStatus = fn;
}

export async function checkForUpdate(): Promise<{
  version: string;
  hash: string;
  updateAvailable: boolean;
  updateReady: boolean;
  error: string;
}> {
  if (!_checkForUpdate) {
    return { version: "", hash: "", updateAvailable: false, updateReady: false, error: "not available on this platform" };
  }
  return _checkForUpdate();
}

export async function downloadUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!_downloadUpdate) {
    return { ok: false, error: "not available on this platform" };
  }
  return _downloadUpdate();
}

export async function applyUpdate(): Promise<{ ok: boolean; error?: string }> {
  if (!_applyUpdate) {
    return { ok: false, error: "not available on this platform" };
  }
  return _applyUpdate();
}

export async function getUpdateStatus(): Promise<{
  entries: Array<{
    status: string;
    message: string;
    timestamp: number;
    details?: Record<string, unknown>;
  }>;
}> {
  if (!_getUpdateStatus) {
    return { entries: [] };
  }
  return _getUpdateStatus();
}
