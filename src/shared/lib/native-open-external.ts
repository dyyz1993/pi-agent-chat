/** 用系统默认浏览器打开 URL（桌面端通过 setXxxFn 注入，Web 端 fallback 到 window.open） */
export type OpenExternalFn = (url: string) => Promise<boolean> | boolean;

let _openExternal: OpenExternalFn | null = null;

export function setOpenExternalFn(fn: OpenExternalFn): void {
  _openExternal = fn;
}

export async function openExternal(url: string): Promise<boolean> {
  if (_openExternal) return await _openExternal(url);
  // Web 端 fallback
  try {
    window.open(url, "_blank", "noopener,noreferrer");
    return true;
  } catch {
    return false;
  }
}
